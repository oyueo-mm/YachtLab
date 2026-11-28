import manifest from "../../dp-manifest.json";
import { dpFutureValue } from "../../dp";
import { available, categories, names, score, total, upper, type Card, type Category } from "../../engine";
import { simulate } from "../../match";
import { addDays, DAILY_RULES } from "../calendar";
import { bestKeys, EndgameWin, expectedValues, maskOf, rerollProbability, TARGET_NAMES, type Target } from "./solver";
import { KIND_NAMES, KINDS, LEVEL_NAMES, LEVELS, keepKey, scoreKey, type Objective, type Puzzle, type PuzzleBank, type PuzzleKind, type PuzzleLevel, type PuzzlePosition, type ValuedAction } from "./types";

/**
 * Offline puzzle generation pipeline (LIVE-1). Deterministic for a given seed and DP table:
 * `npx tsx scripts/daily/generate-puzzles.ts` rewrites src/daily/puzzles/bank.json, and the test
 * suite regenerates a prefix and compares (reproducibility).
 *
 *  1. positions: noisy DP-Expert solitaire games, endgames against a finished opponent, decision points
 *     from AI-vs-AI game records (src/match.ts simulate), exact single-reroll probability questions
 *  2. exact values of every legal action (solver.ts), all optimal actions kept as correct
 *  3. filters: too close to call, forced, obviously decided, duplicates (fingerprint)
 *  4. difficulty from the value gap and whether simple rules of thumb already find the answer
 *  5. schedule: three puzzles (입문·보통·고급) per KST date, kinds rotated, plus a reserve per level
 */
export const GENERATOR_VERSION = "live1-puzzles@1";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const die = (rng: Rng) => 1 + Math.floor(rng() * 6);
const fmt = (v: number, d = 2) => v.toFixed(d);
const pct = (v: number) => (v * 100).toFixed(1) + "%";

/* -------------------------------------------------------------- rules of thumb -------------------------------------------------------------- */
/** "Take the biggest score now" (with the upper bonus it would complete). */
function greedyScore(card: Card, dice: number[]): Category {
  const u = upper(card);
  let best: Category = available(card)[0], bestPts = -1;
  for (const c of available(card)) {
    const i = categories.indexOf(c);
    const p = score(dice, c) + (i < 6 && u < 63 && u + score(dice, c) >= 63 ? 35 : 0);
    if (p > bestPts) [best, bestPts] = [c, p];
  }
  return best;
}
/** "Keep the most common face" (ties: the higher face). */
function keepMostCommon(dice: number[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  dice.forEach((v) => counts[v]++);
  let face = 6;
  for (let f = 6; f >= 1; f--) if (counts[f] > counts[face]) face = f;
  return Array(counts[face]).fill(face);
}
function heuristicKeys(card: Card, dice: number[], rollsLeft: number): string[] {
  const keys: string[] = [];
  const g = greedyScore(card, dice);
  if (rollsLeft === 0 || score(dice, g) >= 25) keys.push(scoreKey(g));
  if (rollsLeft > 0) {
    const kept = keepMostCommon(dice);
    keys.push(kept.length === 5 ? scoreKey(card.yacht === undefined ? "yacht" : g) : keepKey(kept));
  }
  return keys;
}

/* ------------------------------------------------------------------ helpers ------------------------------------------------------------------ */
function gapOf(values: ValuedAction[]) {
  const best = bestKeys(values);
  const rest = values.filter((v) => !best.includes(v.key));
  return { best, gap: rest.length ? values[0].value - rest[0].value : Infinity, second: rest[0] ?? null };
}
const fingerprint = (objective: Objective, p: PuzzlePosition) =>
  [objective, [...p.dice].sort().join(""), p.rollsLeft, categories.map((c) => p.card[c] ?? "-").join(","), p.opponent?.total ?? ""].join("|");

function upperNote(card: Card): string | null {
  const open = categories.slice(0, 6).filter((c) => card[c] === undefined);
  const u = upper(card);
  if (u >= 63) return "상단 보너스(+35)는 이미 확보했어요.";
  if (!open.length) return "상단 칸을 모두 채워 보너스는 받을 수 없어요.";
  return `상단 ${u}/63점 — 보너스까지 ${63 - u}점, 남은 상단 칸: ${open.map((c) => names[c]).join(", ")}.`;
}
function bestLabel(values: ValuedAction[], best: string[]) {
  return values.filter((v) => best.includes(v.key)).map((v) => v.label);
}

/* ---------------------------------------------------------------- candidates ---------------------------------------------------------------- */
type Candidate = Puzzle;

function evCandidate(card: Card, dice: number[], rollsLeft: number, kind: PuzzleKind | null, source: string, opponent?: PuzzlePosition["opponent"]): Candidate | null {
  const values = expectedValues(card, dice, rollsLeft);
  if (values.length < 3) return null;
  const { best, gap, second } = gapOf(values);
  if (!second || gap < 0.3 || gap > 15) return null;
  if (best.length > 3) return null;
  const naive = heuristicKeys(card, dice, rollsLeft);
  const naiveRight = naive.some((k) => best.includes(k));
  const level: PuzzleLevel = naiveRight ? (gap >= 2 ? "intro" : gap >= 0.6 ? "normal" : "advanced") : gap >= 1.5 ? "normal" : "advanced";
  const u = upper(card), upperOpen = categories.slice(0, 6).some((c) => card[c] === undefined);
  const bestIsScore = best[0].startsWith("s:");
  const maxImmediate = Math.max(...available(card).map((c) => score(dice, c)));
  const round = 13 - available(card).length;
  const k: PuzzleKind = kind ?? (u >= 30 && u < 63 && upperOpen && !naiveRight && (best.some((b) => categories.slice(0, 6).some((c) => b === scoreKey(c))) || naive.some((n) => n.startsWith("s:") && categories.slice(6).some((c) => n === scoreKey(c))))
    ? "bonus"
    : rollsLeft === 0 ? "category"
    : bestIsScore || maxImmediate >= 20 ? "reroll"
    : round <= 4 ? "expected"
    : "keep");
  const position: PuzzlePosition = { card: { ...card }, dice: [...dice], rollsLeft, round, ...(opponent ? { opponent } : {}) };
  const top = values[0];
  const lines = [
    `정답: ${bestLabel(values, best).join(" / ")} — 기대 최종점수 ${fmt(top.value)}점.`,
    ...(best.length > 1 ? [`최적 행동이 ${best.length}개예요. 어느 것을 골라도 정답이에요.`] : []),
    `다음으로 좋은 ${second.label}: ${fmt(second.value)}점 (−${fmt(gap)}점).`,
  ];
  const naiveWrong = naive.filter((n) => !best.includes(n)).map((n) => values.find((v) => v.key === n)).filter((v): v is ValuedAction => !!v);
  for (const v of naiveWrong) lines.push(`흔한 선택인 "${v.label}"은 기대 최종점수가 ${fmt(top.value - v.value)}점 낮아요.`);
  if (bestIsScore) {
    const c = best[0].slice(2) as Category;
    const p = score(dice, c);
    lines.push(`지금 ${p}점을 확정하고, 남은 칸들에서 기대되는 점수는 ${fmt(top.value - total(card) - p)}점(보너스 포함)이에요.`);
  } else lines.push("남은 굴림을 최선으로 이어 갔을 때의 기대 최종점수예요.");
  const note = upperNote(card);
  if (note && (k === "bonus" || upperOpen)) lines.push(note);
  const prompts: Record<string, string> = {
    keep: "어떤 주사위를 남기고 다시 굴릴까요?",
    reroll: "지금 기록할까요, 다시 굴릴까요?",
    category: "굴림을 모두 썼어요. 어느 칸에 기록할까요?",
    expected: "게임 초반이에요. 기대 최종점수를 가장 높이는 행동은?",
    bonus: "상단 보너스(63점 이상 +35)를 생각하면 최선의 행동은?",
    replay: "AI 대국 기보의 한 장면이에요. 기대 최종점수를 가장 높이는 행동은?",
  };
  return {
    id: "", level, kind: k, objective: "expected", title: `${KIND_NAMES[k]} · ${LEVEL_NAMES[level]}`,
    prompt: prompts[k] + " (기대 최종점수 기준)", position, method: "exact", source,
    key: { best, values: values.map((v) => ({ ...v, value: +v.value.toFixed(6) })), unit: "점", explanation: lines, model: "DP Expert 전체 게임 기대점수 DP (공정한 독립 주사위, 정확 계산)" },
    fingerprint: fingerprint("expected", position),
  };
}

function winCandidate(card: Card, dice: number[], rollsLeft: number, opponentTotal: number, solver: EndgameWin, source: string): Candidate | null {
  const values = solver.values(card, dice, rollsLeft);
  if (values.length < 3) return null;
  const { best, gap, second } = gapOf(values);
  if (!second || gap < 0.005 || gap > 0.5 || values[0].value > 0.999 || values[0].value < 0.002) return null;
  if (best.length > 3) return null;
  const ev = expectedValues(card, dice, rollsLeft);
  const evBest = bestKeys(ev);
  const evRight = evBest.some((k) => best.includes(k));
  const naiveRight = heuristicKeys(card, dice, rollsLeft).some((k) => best.includes(k));
  const projected = total(card) + dpFutureValue(maskOf(card), Math.min(63, upper(card)));
  const kind: PuzzleKind = evRight ? "win" : projected < opponentTotal ? "comeback" : "protect";
  const level: PuzzleLevel = !evRight ? (gap >= 0.03 ? "normal" : "advanced") : naiveRight && gap >= 0.05 ? "intro" : gap >= 0.02 ? "normal" : "advanced";
  if (kind === "win" && level === "advanced" && gap < 0.008) return null;
  const position: PuzzlePosition = { card: { ...card }, dice: [...dice], rollsLeft, round: 13 - available(card).length, opponent: { total: opponentTotal, finished: true } };
  const top = values[0];
  const lines = [
    `정답: ${bestLabel(values, best).join(" / ")} — 승리 확률 ${pct(top.value)} (무승부는 ½로 계산).`,
    ...(best.length > 1 ? [`최적 행동이 ${best.length}개예요. 어느 것을 골라도 정답이에요.`] : []),
    `다음으로 좋은 ${second.label}: ${pct(second.value)} (−${((gap) * 100).toFixed(1)}%p).`,
  ];
  if (!evRight) {
    const evTop = values.find((v) => v.key === evBest[0])!;
    lines.push(`기대점수만 보면 "${evTop.label}"이 가장 좋지만(기대 ${fmt(ev[0].value)}점), 승리 확률은 ${pct(evTop.value)}로 ${((top.value - evTop.value) * 100).toFixed(1)}%p 낮아요.`);
    lines.push(kind === "comeback" ? "뒤지고 있을 때는 평균보다 '상대 점수를 넘을 가능성'이 중요해요." : "앞설 때는 큰 점수보다 '확실히 넘는 점수'를 지키는 쪽이 유리해요.");
  } else lines.push("이 장면에서는 기대점수 최적 행동과 승리 확률 최적 행동이 같아요.");
  lines.push(`현재 ${total(card)}점, 상대는 ${opponentTotal}점으로 끝났어요. 남은 칸: ${available(card).map((c) => names[c]).join(", ")}.`);
  const note = upperNote(card);
  if (note && categories.slice(0, 6).some((c) => card[c] === undefined)) lines.push(note);
  return {
    id: "", level, kind, objective: "win", title: `${KIND_NAMES[kind]} · ${LEVEL_NAMES[level]}`,
    prompt: `상대는 ${opponentTotal}점으로 경기를 마쳤어요. 이길 확률을 가장 높이는 행동은?`, position, method: "exact", source,
    key: {
      best, values: values.map((v) => ({ ...v, value: +v.value.toFixed(6) })), unit: "%", explanation: lines,
      expected: ev.map((v) => ({ ...v, value: +v.value.toFixed(6) })), model: "끝난 상대 점수 대비 정확 승리 확률 (남은 칸 3개 이하 역진 귀납, 공정한 독립 주사위)",
    },
    fingerprint: fingerprint("win", position),
  };
}

function probabilityCandidate(rng: Rng, index: number): Candidate | null {
  const targets: Target[] = ["yacht", "four", "full", "small", "large", "fullOrFour"];
  const target = targets[Math.floor(rng() * targets.length)];
  const roll = [die(rng), die(rng), die(rng), die(rng), die(rng)].sort((a, b) => a - b);
  const keepCount = 1 + Math.floor(rng() * 4); // keep 1..4
  // keep a sensible subset: the longest run of equal faces or a straight fragment
  const kept = target === "small" || target === "large" ? [...new Set(roll)].slice(0, keepCount) : roll.filter((v) => v === roll[Math.floor(rng() * 5)]).slice(0, keepCount);
  if (!kept.length) return null;
  const [ok, all] = rerollProbability(kept, target);
  if (ok === 0 || ok === all) return null;
  const p = ok / all;
  const n = 5 - kept.length;
  const level: PuzzleLevel = n <= 2 ? "intro" : n === 3 ? "normal" : "advanced";
  // distractors: other targets / other keep sizes and two classic mistakes
  const pool = new Set<number>();
  for (const t of targets) if (t !== target) pool.add(rerollProbability(kept, t)[0] / all);
  if (n > 1) pool.add(Math.min(1, (ok / all) * n)); // "multiply by the number of dice"
  pool.add(Math.pow(1 / 6, n)); // "every die must show one exact face"
  const distractors = [...pool].filter((q) => q > 0 && q < 1 && Math.abs(q - p) >= 0.015).sort((a, b) => Math.abs(a - p) - Math.abs(b - p));
  if (distractors.length < 3) return null;
  const options = [p, ...distractors.slice(0, 3)].sort((a, b) => a - b);
  const ids = ["A", "B", "C", "D"];
  const choices = options.map((q, i) => ({ id: ids[i], label: pct(q) }));
  const answerId = ids[options.indexOf(p)];
  const values: ValuedAction[] = options.map((q, i) => ({ key: "o:" + ids[i], label: pct(q), value: q === p ? 1 : 0 })).sort((a, b) => b.value - a.value);
  const keptText = kept.join("·");
  const position: PuzzlePosition = { card: {}, dice: [...kept, ...Array(n).fill(0)], rollsLeft: 1, round: 0 };
  return {
    id: "", level, kind: "probability", objective: "probability", title: `${KIND_NAMES.probability} · ${LEVEL_NAMES[level]}`,
    prompt: `${keptText}을(를) 남기고 나머지 ${n}개를 한 번 다시 굴릴 때, ${TARGET_NAMES[target]}이(가) 나올 확률은?`,
    choices, position, method: "exact", source: `generated:probability#${index}`,
    key: {
      best: ["o:" + answerId], values, unit: "%",
      explanation: [
        `정답: ${pct(p)} — 다시 굴리는 ${n}개의 경우의 수 6^${n} = ${all}가지 중 ${ok}가지가 ${TARGET_NAMES[target]}이에요.`,
        `정확한 값은 ${ok}/${all} ≈ ${(p * 100).toFixed(3)}%예요 (모든 경우를 직접 센 정확 계산).`,
        `주사위 ${n}개 각각이 특정 눈이어야 한다고 생각하면 (1/6)^${n} = ${pct(Math.pow(1 / 6, n))}처럼 과소평가하기 쉬워요.`,
      ],
      model: "남긴 주사위 외 1회 재굴림의 완전 열거 (6^n가지)",
    },
    fingerprint: `probability|${keptText}|${target}`,
  };
}

/* ------------------------------------------------------------- position sources ------------------------------------------------------------- */
function noisySolitaire(rng: Rng, onDecision: (card: Card, dice: number[], rollsLeft: number) => void, onTurnStart?: (card: Card) => void) {
  const card: Card = {};
  while (available(card).length) {
    onTurnStart?.(card);
    let dice = [die(rng), die(rng), die(rng), die(rng), die(rng)];
    for (let rollsLeft = 2; ; rollsLeft--) {
      onDecision(card, dice, rollsLeft);
      const values = expectedValues(card, dice, rollsLeft);
      const pick = rng() < 0.72 ? values[0] : values[Math.min(values.length - 1, Math.floor(rng() * Math.min(6, values.length)))];
      if (pick.key.startsWith("s:")) {
        const c = pick.key.slice(2) as Category;
        card[c] = score(dice, c);
        break;
      }
      const kept = pick.key.slice(2).split("").filter(Boolean).map(Number);
      dice = [...kept, ...Array.from({ length: 5 - kept.length }, () => die(rng))];
    }
  }
  return card;
}

function endgames(rng: Rng, add: (c: Candidate | null) => void, games: number) {
  for (let g = 0; g < games; g++) {
    const card: Card = {};
    // play a noisy game until 1..3 categories remain
    const stopAt = 1 + Math.floor(rng() * 3);
    noisySolitairePrefix(rng, card, stopAt);
    const u = Math.min(63, upper(card));
    const projected = total(card) + dpFutureValue(maskOf(card), u);
    const opponentTotal = Math.max(60, Math.round(projected + (rng() * 60 - 30)));
    const solver = new EndgameWin(opponentTotal);
    let dice = [die(rng), die(rng), die(rng), die(rng), die(rng)];
    for (let rollsLeft = 2; rollsLeft >= 0; rollsLeft--) {
      if (rng() < 0.6 || rollsLeft === 0) add(winCandidate(card, dice, rollsLeft, opponentTotal, solver, `generated:endgame#${g}`));
      if (rollsLeft === 0) break;
      const values = solver.values(card, dice, rollsLeft);
      const pick = rng() < 0.7 ? values[0] : values[Math.floor(rng() * Math.min(5, values.length))];
      if (pick.key.startsWith("s:")) break;
      const kept = pick.key.slice(2).split("").filter(Boolean).map(Number);
      dice = [...kept, ...Array.from({ length: 5 - kept.length }, () => die(rng))];
    }
  }
}
function noisySolitairePrefix(rng: Rng, card: Card, remaining: number) {
  while (available(card).length > remaining) {
    let dice = [die(rng), die(rng), die(rng), die(rng), die(rng)];
    for (let rollsLeft = 2; ; rollsLeft--) {
      const values = expectedValues(card, dice, rollsLeft);
      const pick = rng() < 0.75 ? values[0] : values[Math.min(values.length - 1, Math.floor(rng() * Math.min(6, values.length)))];
      if (pick.key.startsWith("s:")) {
        const c = pick.key.slice(2) as Category;
        card[c] = score(dice, c);
        break;
      }
      const kept = pick.key.slice(2).split("").filter(Boolean).map(Number);
      dice = [...kept, ...Array.from({ length: 5 - kept.length }, () => die(rng))];
    }
  }
}

/** Decision points of AI-vs-AI game records (Greedy vs DP Expert, the existing match runner). */
function replayPositions(rng: Rng, add: (c: Candidate | null) => void, games: number, seed: number) {
  for (let g = 0; g < games; g++) {
    const match = simulate(["Greedy", "DP Expert"], (seed + g * 7919) >>> 0);
    for (const f of match.frames) {
      const s = f.state;
      if (s.done || !s.rolls || s.player !== 0 || rng() > 0.12) continue;
      if (!f.action || f.action.type === "hold") continue;
      const card = s.cards[0];
      if (!available(card).length) continue;
      add(evCandidate(card, s.dice.map((d) => d.value), 3 - s.rolls, "replay", `record:greedy-vs-dp#${g}`, { total: total(s.cards[1]), finished: false, card: { ...s.cards[1] } }));
    }
  }
}

/* ------------------------------------------------------------------- bank ------------------------------------------------------------------- */
export type GenerateOptions = { seed: number; epoch: string; days: number; reservePerLevel: number; solitaireGames: number; endgameGames: number; replayGames: number; probabilityQuestions: number };
export const DEFAULT_OPTIONS: GenerateOptions = { seed: 20261201, epoch: "2026-12-01", days: 84, reservePerLevel: 10, solitaireGames: 260, endgameGames: 700, replayGames: 40, probabilityQuestions: 500 };

export function collectCandidates(o: GenerateOptions) {
  const rng = mulberry32(o.seed);
  const seen = new Set<string>();
  const all: Candidate[] = [];
  const add = (c: Candidate | null) => {
    if (!c || seen.has(c.fingerprint)) return;
    seen.add(c.fingerprint);
    all.push(c);
  };
  for (let g = 0; g < o.solitaireGames; g++)
    noisySolitaire(rng, (card, dice, rollsLeft) => {
      if (rng() < 0.3) add(evCandidate(card, dice, rollsLeft, null, `generated:solitaire#${g}`));
    });
  endgames(rng, add, o.endgameGames);
  replayPositions(rng, add, o.replayGames, o.seed);
  for (let i = 0; i < o.probabilityQuestions; i++) add(probabilityCandidate(rng, i));
  return all;
}

export function buildBank(o: GenerateOptions = DEFAULT_OPTIONS): PuzzleBank {
  const candidates = collectCandidates(o);
  const rng = mulberry32(o.seed ^ 0x5bd1e995);
  // deterministic shuffle, then pools by level and kind
  const order = candidates.map((c, i) => ({ c, r: rng(), i })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c);
  const pools = new Map<string, Candidate[]>();
  for (const c of order) {
    const k = c.level + "/" + c.kind;
    if (!pools.has(k)) pools.set(k, []);
    pools.get(k)!.push(c);
  }
  const used = new Set<Candidate>();
  const take = (level: PuzzleLevel, kind: PuzzleKind): Candidate | null => {
    const exact = pools.get(level + "/" + kind)?.find((c) => !used.has(c));
    if (exact) return exact;
    // fall back to the kind of that level with the most unused candidates
    let bestPool: Candidate[] | null = null, bestCount = 0;
    for (const k of KINDS) {
      const list = (pools.get(level + "/" + k) ?? []).filter((c) => !used.has(c));
      if (list.length > bestCount) [bestPool, bestCount] = [list, list.length];
    }
    return bestPool?.[0] ?? null;
  };
  const puzzles: Record<string, Puzzle> = {};
  const schedule: Record<string, string[]> = {};
  const register = (c: Candidate, id: string) => {
    used.add(c);
    puzzles[id] = { ...c, id };
    return id;
  };
  for (let d = 0; d < o.days; d++) {
    const date = addDays(o.epoch, d);
    const kinds: PuzzleKind[] = [KINDS[(d * 3) % KINDS.length], KINDS[(d * 3 + 1) % KINDS.length], KINDS[(d * 3 + 2) % KINDS.length]];
    schedule[date] = LEVELS.map((level, i) => {
      const c = take(level, kinds[i]);
      if (!c) throw Error(`not enough ${level} puzzles for ${date}`);
      return register(c, `${date}-${level}`);
    });
  }
  const reserve = Object.fromEntries(LEVELS.map((level) => {
    const ids: string[] = [];
    for (let i = 0; i < o.reservePerLevel; i++) {
      const c = take(level, KINDS[i % KINDS.length]);
      if (!c) break;
      ids.push(register(c, `reserve-${level}-${String(i + 1).padStart(2, "0")}`));
    }
    return [level, ids];
  })) as Record<PuzzleLevel, string[]>;
  return {
    format: 1, rules: DAILY_RULES,
    generator: { version: GENERATOR_VERSION, seed: o.seed, dpSha256: manifest.sha256, generatedFrom: "scripts/daily/generate-puzzles.ts" },
    epoch: o.epoch, schedule, reserve, puzzles,
  };
}

/** Quality summary (docs/context/RESULTS.md, tests). */
export function bankStats(bank: PuzzleBank) {
  const list = Object.values(bank.puzzles);
  const byLevel: Record<string, number> = {}, byKind: Record<string, number> = {};
  let multi = 0;
  for (const p of list) {
    byLevel[p.level] = (byLevel[p.level] ?? 0) + 1;
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    if (p.key.best.length > 1) multi++;
  }
  return { puzzles: list.length, days: Object.keys(bank.schedule).length, byLevel, byKind, multipleOptimal: multi, fingerprints: new Set(list.map((p) => p.fingerprint)).size };
}
