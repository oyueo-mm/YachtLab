/**
 * A3 경기 종료 화면의 표시 모델 (순수 함수, UI·서버와 독립).
 *
 * 원칙: 화면에 보이는 모든 사실은 입력으로 받은 실제 경기 기록(카드·채점 순서·서버 receipt)에서만 만든다.
 * 기록이 없거나 서로 맞지 않으면 역전·하이라이트를 "판정하지 않는다". 판단 정확도·운·실수 분석은 넣지 않는다.
 * 기준 문서: docs/context/A3-MATCH-RESULT-2026-11-27.md
 */
import { bonus, categories, names, total, upper, type Card, type Category } from "../engine";
import type { MatchReceipt } from "../economy/live/receipt";

export type ForfeitReason = "resign" | "timeout" | "left";
export type ResultMode = "online" | "friend" | "server-ai" | "ai" | "local" | "solo";

export type ResultSeat = {
  id: string;
  name: string;
  /** 이 화면을 보는 사람의 좌석. 로컬 2인처럼 관찰자 시점이면 아무 좌석도 표시하지 않는다. */
  you?: boolean;
  kind?: "human" | "ai" | "guest" | "member";
  /** 칭호 문구(장착 표시 전용). */
  title?: string;
  card: Card;
  /** 엔진/서버가 확정한 총점. 카드에서 다시 계산한 값과 다르면 서버 값이 우선이고 하이라이트만 보수적으로 만든다. */
  total?: number;
  forfeited?: ForfeitReason | null;
};

/** 실제 채점 순서(서버 categoryScored 이벤트 또는 오프라인 기보 프레임). 없으면 역전 판정을 하지 않는다. */
export type ScoreStep = { seat: string; category: Category; points: number; auto?: boolean };

/** 보상 표시 상태. 금액은 서버 receipt가 확정된 경우(settled)에만 표시한다. */
export type RewardState =
  | { status: "none"; reason: "guest" | "mode" | "signed-out" }
  | { status: "pending" }
  | { status: "delayed" }
  | { status: "failed" }
  | { status: "settled"; receipt: MatchReceipt };

export type ResultInput = {
  mode: ResultMode;
  seats: ResultSeat[];
  /** 엔진이 정한 승자(동점이면 여러 명). */
  winners: string[];
  steps?: ScoreStep[] | null;
  startedAt?: number | null;
  endedAt?: number | null;
  /** 개인 최고 기록. bestBefore는 이번 경기 이전의 최고점이며, source가 출처를 밝힌다. 모르면 생략한다. */
  personal?: { bestBefore: number | null; source: "device" | "account" } | null;
  /** 서버가 확인한 빠른 대전 연승(경기 후 값). 서버 값이 없으면 생략한다. */
  streak?: { current: number; best: number } | null;
  rewards?: RewardState;
};

export type OutcomeKind =
  | "win"
  | "loss"
  | "draw"
  | "forfeit-win"
  | "forfeit-loss"
  | "rank"
  | "solo-best"
  | "solo-first"
  | "solo"
  | "observer";

export type Drama = "grand-comeback" | "comeback" | "final-turn" | "close" | null;

export type Outcome = {
  kind: OutcomeKind;
  title: string;
  subtitle?: string;
  /** 다인전 순위(1부터). 공동 순위는 같은 수. */
  rank?: number;
  sharedRank?: boolean;
  tone: "win" | "lose" | "neutral";
};

export type TimelinePoint = { round: number; totals: Record<string, number> };
export type Timeline =
  | { status: "missing" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; points: TimelinePoint[]; lastStepLead: Record<string, number> };

export type ComebackFacts = {
  /** 라운드 종료(1~11) 시점마다 "나"와 나를 뺀 1위의 점수 차(양수 = 뒤짐). */
  deficits: { round: number; deficit: number }[];
  /** 전체 경기에서 가장 크게 뒤진 점수 차와 그 라운드. */
  maxDeficit: number;
  deficitRound: number | null;
  /** 내 마지막 채점 직전 1위보다 뒤져 있었는가. */
  trailingBeforeLastScore: boolean;
  margin: number;
};

export type Highlight = {
  id: "yacht" | "large" | "bonus" | "personal-best" | "first-record" | "streak" | "grand-comeback" | "comeback" | "final-turn" | "close";
  label: string;
  detail?: string;
};

export type StandingRow = { seat: ResultSeat; total: number; rank: number; you: boolean; winner: boolean };

export type ResultSummary = {
  outcome: Outcome;
  drama: Drama;
  comeback: ComebackFacts | null;
  timeline: Timeline;
  standings: StandingRow[];
  highlights: Highlight[];
  duration: string | null;
  durationMs: number | null;
};

// ---------- 기준값 (문서와 테스트가 같은 상수를 사용) ----------
export const COMEBACK = {
  /** 대역전승: 9라운드 이후 30점 이상 뒤졌거나, 6라운드 이후 50점 이상 뒤졌다가 단독 승리. */
  grandLateRound: 9,
  grandLateDeficit: 30,
  grandMidRound: 6,
  grandMidDeficit: 50,
  /** 역전승: 6라운드 이후 20점 이상 뒤졌다가 단독 승리. */
  round: 6,
  deficit: 20,
  /** 접전 승리: 최종 점수 차 10점 이하. */
  closeMargin: 10,
} as const;
/** 경기 시간 표시 상한. 이보다 길면 시계 오류나 방치로 보고 표시하지 않는다. */
export const MAX_SHOWN_DURATION_MS = 6 * 60 * 60 * 1000;

const seatTotal = (seat: ResultSeat) => seat.total ?? total(seat.card);

/**
 * 실제 채점 순서를 처음부터 다시 쌓아 라운드별 누적 점수(상단 보너스 포함)를 만든다.
 * 다시 쌓은 카드가 최종 카드와 한 칸이라도 다르면 invalid — 그 경우 역전 판정은 하지 않는다.
 */
export function buildTimeline(seats: readonly ResultSeat[], steps: readonly ScoreStep[] | null | undefined): Timeline {
  if (!steps || steps.length === 0) return { status: "missing" };
  const cards = new Map<string, Card>(seats.map((s) => [s.id, {}]));
  const points: TimelinePoint[] = [];
  const lastStepLead: Record<string, number> = {};
  const lastIndex = new Map<string, number>();
  steps.forEach((step, i) => lastIndex.set(step.seat, i));
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const card = cards.get(step.seat);
    if (!card) return { status: "invalid", reason: `알 수 없는 좌석 ${step.seat}` };
    if (!categories.includes(step.category)) return { status: "invalid", reason: "알 수 없는 칸" };
    if (card[step.category] !== undefined) return { status: "invalid", reason: `${names[step.category]} 중복 기록` };
    if (lastIndex.get(step.seat) === i) {
      // 이 좌석의 마지막 채점 직전: 자신을 뺀 최고 점수와의 차(양수 = 앞섬).
      const mine = total(card);
      const best = Math.max(...seats.filter((s) => s.id !== step.seat).map((s) => total(cards.get(s.id)!)), -Infinity);
      lastStepLead[step.seat] = Number.isFinite(best) ? mine - best : 0;
    }
    card[step.category] = step.points;
    // 라운드 종료: 아직 기권하지 않은 모든 좌석의 기록 칸 수가 같아진 순간.
    const counts = seats.map((s) => Object.keys(cards.get(s.id)!).length);
    const round = Math.min(...counts);
    if (counts.every((n) => n === round) && round > 0 && points.at(-1)?.round !== round)
      points.push({ round, totals: Object.fromEntries(seats.map((s) => [s.id, total(cards.get(s.id)!)])) });
  }
  for (const seat of seats) {
    const rebuilt = cards.get(seat.id)!;
    for (const c of categories) if (rebuilt[c] !== seat.card[c]) return { status: "invalid", reason: `${seat.name}의 ${names[c]} 기록이 최종 카드와 달라요` };
  }
  return { status: "ok", points, lastStepLead };
}

export function comebackFacts(timeline: Timeline, seats: readonly ResultSeat[], me: string): ComebackFacts | null {
  if (timeline.status !== "ok") return null;
  const others = seats.filter((s) => s.id !== me);
  if (!others.length) return null;
  const deficits = timeline.points
    .filter((point) => point.round < 12) // 최종 결과는 역전의 "뒤진 상태"가 아니다
    .map((point) => ({ round: point.round, deficit: Math.max(...others.map((s) => point.totals[s.id] ?? 0)) - (point.totals[me] ?? 0) }));
  const finals = seats.map((s) => ({ id: s.id, t: seatTotal(s) }));
  const myFinal = finals.find((f) => f.id === me)?.t ?? 0;
  const bestOther = Math.max(...finals.filter((f) => f.id !== me).map((f) => f.t));
  const worst = pickDeficit(deficits, 1);
  return { deficits, maxDeficit: worst?.deficit ?? 0, deficitRound: worst?.round ?? null, trailingBeforeLastScore: (timeline.lastStepLead[me] ?? 0) < 0, margin: myFinal - bestOther };
}
/** fromRound 이후 가장 크게 뒤진 지점(같으면 더 늦은 라운드). 뒤진 적이 없으면 null. */
function pickDeficit(deficits: readonly { round: number; deficit: number }[], fromRound: number) {
  let best: { round: number; deficit: number } | null = null;
  for (const d of deficits) if (d.round >= fromRound && d.deficit > 0 && (!best || d.deficit >= best.deficit)) best = d;
  return best;
}

/** 단독 승리에만 붙는 극적 연출 등급. 근거가 없으면 null. */
export function dramaOf(facts: ComebackFacts | null, soleWin: boolean, finalMargin: number | null): Drama {
  if (!soleWin) return null;
  if (facts) {
    const late = facts.deficits.some((d) => d.round >= COMEBACK.grandLateRound && d.deficit >= COMEBACK.grandLateDeficit);
    const deep = facts.deficits.some((d) => d.round >= COMEBACK.grandMidRound && d.deficit >= COMEBACK.grandMidDeficit);
    if (late || deep) return "grand-comeback";
    if (facts.deficits.some((d) => d.round >= COMEBACK.round && d.deficit >= COMEBACK.deficit)) return "comeback";
    if (facts.trailingBeforeLastScore) return "final-turn";
  }
  if (finalMargin !== null && finalMargin > 0 && finalMargin <= COMEBACK.closeMargin) return "close";
  return null;
}
/** 역전 문구에 쓰는 지점: 6라운드 이후 가장 크게 뒤졌던 라운드. */
export function comebackPoint(facts: ComebackFacts | null) {
  return facts ? pickDeficit(facts.deficits, COMEBACK.round) : null;
}

export function standingsOf(seats: readonly ResultSeat[], winners: readonly string[]): StandingRow[] {
  const rows = seats.map((seat) => ({ seat, total: seatTotal(seat), you: !!seat.you, winner: winners.includes(seat.id) }));
  // 기권자는 점수와 관계없이 아래로.
  const order = [...rows].sort((a, b) => Number(!!a.seat.forfeited) - Number(!!b.seat.forfeited) || b.total - a.total);
  return order.map((row) => ({ ...row, rank: 1 + order.filter((o) => (Number(!!o.seat.forfeited) < Number(!!row.seat.forfeited)) || (!!o.seat.forfeited === !!row.seat.forfeited && o.total > row.total)).length }));
}

export function outcomeOf(input: ResultInput, standings: readonly StandingRow[]): Outcome {
  const me = input.seats.find((s) => s.you);
  if (input.seats.length === 1) {
    const score = seatTotal(input.seats[0]);
    const best = input.personal?.bestBefore;
    if (input.personal && best === null) return { kind: "solo-first", title: "첫 기록 완성", subtitle: `${score}점`, tone: "win" };
    if (input.personal && best !== null && best !== undefined && score > best) return { kind: "solo-best", title: "최고 기록 갱신!", subtitle: `이전 최고 ${best}점`, tone: "win" };
    return { kind: "solo", title: "경기 종료", subtitle: best != null ? `최고 기록 ${best}점` : undefined, tone: "neutral" };
  }
  if (!me) {
    const top = standings.filter((s) => s.winner);
    return { kind: "observer", title: top.length === 1 ? `${top[0].seat.name} 승리` : top.length === input.seats.length && input.seats.length === 2 ? "무승부" : "공동 1위", tone: "neutral" };
  }
  const forfeiter = input.seats.find((s) => s.forfeited);
  if (input.seats.length === 2) {
    if (forfeiter && forfeiter.id !== me.id) return { kind: "forfeit-win", title: "승리", subtitle: `${forfeiter.name} 님이 ${forfeitText(forfeiter.forfeited!)}`, tone: "win" };
    if (forfeiter && forfeiter.id === me.id) return { kind: "forfeit-loss", title: "기권패", subtitle: forfeitSelfText(forfeiter.forfeited!), tone: "lose" };
    if (input.winners.length !== 1) return { kind: "draw", title: "무승부", tone: "neutral" };
    return input.winners[0] === me.id ? { kind: "win", title: "승리", tone: "win" } : { kind: "loss", title: "패배", tone: "lose" };
  }
  const row = standings.find((s) => s.seat.id === me.id)!;
  const shared = standings.filter((s) => s.rank === row.rank).length > 1;
  if (me.forfeited) return { kind: "forfeit-loss", title: "기권", subtitle: forfeitSelfText(me.forfeited), rank: row.rank, tone: "lose" };
  return {
    kind: "rank",
    title: row.rank === 1 ? (shared ? "공동 1위" : "1위") : `${shared ? "공동 " : ""}${row.rank}위`,
    subtitle: `${input.seats.length}명 중`,
    rank: row.rank,
    sharedRank: shared,
    tone: row.rank === 1 ? "win" : row.rank <= Math.ceil(input.seats.length / 2) ? "neutral" : "lose",
  };
}
const forfeitText = (r: ForfeitReason) => (r === "resign" ? "기권했어요" : r === "timeout" ? "시간 초과로 기권 처리됐어요" : "경기를 떠났어요");
const forfeitSelfText = (r: ForfeitReason) => (r === "resign" ? "경기를 기권했어요" : r === "timeout" ? "시간 초과로 기권 처리됐어요" : "경기를 떠나 기권 처리됐어요");

export function formatDuration(ms: number | null): string | null {
  if (ms === null || !(ms > 0) || ms > MAX_SHOWN_DURATION_MS) return null;
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return sec ? `${m}분 ${sec}초` : `${m}분`;
  return `${sec}초`;
}

/** 라운드 번호(그 좌석이 이 칸을 몇 번째로 채웠는지). 채점 순서가 유효할 때만. */
function roundOf(steps: readonly ScoreStep[] | null | undefined, timeline: Timeline, seat: string, category: Category): number | null {
  if (timeline.status !== "ok" || !steps) return null;
  let n = 0;
  for (const step of steps) {
    if (step.seat !== seat) continue;
    n++;
    if (step.category === category) return n;
  }
  return null;
}

const DRAMA_TEXT: Record<Exclude<Drama, null>, string> = {
  "grand-comeback": "대역전승",
  comeback: "역전승",
  "final-turn": "마지막 차례 역전",
  close: "접전 승리",
};

export function highlightsOf(input: ResultInput, timeline: Timeline, drama: Drama, facts: ComebackFacts | null): Highlight[] {
  const me = input.seats.find((s) => s.you) ?? (input.seats.length === 1 ? input.seats[0] : null);
  const out: Highlight[] = [];
  if (drama) {
    const detail =
      drama === "close" ? `${facts?.margin ?? marginOf(input)}점 차`
      : drama === "final-turn" ? "마지막 기록으로 앞섰어요"
      : (() => {
          const point = comebackPoint(facts);
          return point ? `${point.round}라운드 ${point.deficit}점 차를 뒤집었어요` : undefined;
        })();
    out.push({ id: drama, label: DRAMA_TEXT[drama], detail });
  }
  if (!me) return out;
  const at = (category: Category) => {
    const r = roundOf(input.steps, timeline, me.id, category);
    return r ? `${r}번째 기록` : undefined;
  };
  if (me.card.yacht === 50) out.push({ id: "yacht", label: "요트", detail: at("yacht") });
  if (me.card.large === 30) out.push({ id: "large", label: "라지 스트레이트", detail: at("large") });
  if (bonus(me.card) > 0) out.push({ id: "bonus", label: "상단 보너스 +35", detail: `상단 ${upper(me.card)}점` });
  const personal = input.personal;
  if (personal && input.seats.length > 1) {
    const score = seatTotal(me);
    const where = personal.source === "account" ? "계정" : "이 기기";
    if (personal.bestBefore !== null && score > personal.bestBefore) out.push({ id: "personal-best", label: "개인 최고 기록", detail: `${where} 기준 · 이전 ${personal.bestBefore}점` });
    if (personal.bestBefore === null) out.push({ id: "first-record", label: "첫 기록", detail: `${where} 기준` });
  }
  if (input.streak && input.streak.current >= 2 && input.winners.length === 1 && input.winners[0] === me.id)
    out.push({ id: "streak", label: `${input.streak.current}연승`, detail: input.streak.best > input.streak.current ? `최고 ${input.streak.best}연승` : "최고 연승 기록" });
  return out;
}
function marginOf(input: ResultInput) {
  const me = input.seats.find((s) => s.you);
  if (!me) return 0;
  return seatTotal(me) - Math.max(...input.seats.filter((s) => s.id !== me.id).map(seatTotal));
}

export function summarize(input: ResultInput): ResultSummary {
  const standings = standingsOf(input.seats, input.winners);
  const outcome = outcomeOf(input, standings);
  const me = input.seats.find((s) => s.you);
  const timeline = input.seats.length > 1 ? buildTimeline(input.seats, input.steps) : ({ status: "missing" } as Timeline);
  // 기권승은 경기 내용으로 이긴 것이 아니므로 역전·접전 연출을 붙이지 않는다.
  const soleWin = !!me && (outcome.kind === "win" || (outcome.kind === "rank" && outcome.rank === 1 && !outcome.sharedRank));
  const facts = me && input.seats.length > 1 ? comebackFacts(timeline, input.seats, me.id) : null;
  const drama = dramaOf(facts, soleWin, me && soleWin ? marginOf(input) : null);
  const durationMs = input.startedAt && input.endedAt ? input.endedAt - input.startedAt : null;
  return {
    outcome,
    drama,
    comeback: facts,
    timeline,
    standings,
    highlights: highlightsOf(input, timeline, drama, facts),
    duration: formatDuration(durationMs),
    durationMs: durationMs !== null && formatDuration(durationMs) ? durationMs : null,
  };
}

// ---------- 보상 표시 ----------
export type RewardView =
  | { kind: "hidden" }
  | { kind: "note"; text: string; tone: "info" | "wait" | "warn" }
  | {
      kind: "settled";
      coins: number;
      gems: number;
      balance: { coins: number; gems: number };
      quests: { id: string; label: string; period: "daily" | "weekly"; previous: number; progress: number; count: number; done: boolean }[];
      grants: { label: string; coins: number; gems: number; kind: "achievement" | "quest-bonus" }[];
    };

export type QuestLookup = (id: string) => { label: string; period: "daily" | "weekly"; count: number } | undefined;

export function rewardView(state: RewardState | undefined, quest: QuestLookup): RewardView {
  if (!state) return { kind: "hidden" };
  switch (state.status) {
    case "none":
      return state.reason === "mode" ? { kind: "hidden" } : { kind: "note", tone: "info", text: "로그인하면 온라인 경기 보상을 받을 수 있어요." };
    case "pending":
      return { kind: "note", tone: "wait", text: "보상을 확인하는 중이에요…" };
    case "delayed":
      return { kind: "note", tone: "wait", text: "보상 정산이 늦어지고 있어요. 지급되면 홈과 내역에 표시돼요." };
    case "failed":
      return { kind: "note", tone: "warn", text: "보상 정보를 불러오지 못했어요. 지급 여부는 내역에서 확인해 주세요." };
    case "settled": {
      const r = state.receipt;
      const quests = r.quests.flatMap((q) => {
        const def = quest(q.id);
        return def ? [{ id: q.id, label: def.label, period: def.period, count: def.count, previous: q.previous, progress: q.progress, done: q.done }] : [];
      });
      const grants = r.grants.flatMap((g) => (g.kind === "achievement" || g.kind === "quest-bonus" ? [{ label: g.label, coins: g.coins, gems: g.gems, kind: g.kind as "achievement" | "quest-bonus" }] : []));
      return { kind: "settled", coins: Math.max(0, r.after.coins - r.before.coins), gems: Math.max(0, r.after.gems - r.before.gems), balance: { ...r.after }, quests, grants };
    }
  }
}
