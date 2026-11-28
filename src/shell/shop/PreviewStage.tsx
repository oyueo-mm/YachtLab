import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { DiceArea } from "../../DiceArea";
import { BoardFx, SynergyFx } from "../../play/BoardFx";
import { boardTheme } from "../../play/Looks";
import { emitFx } from "../../fx-bus";
import { announceScore } from "../../score-fx";
import { itemById, lookAt } from "../../economy/live/catalog";
import { synergyOf } from "../../economy/live/collections";
import { diceMaterial } from "../../sound-packs";
import { playSfx, surfaceOf, unlockAudio, type Sfx, type SfxOptions } from "../../sound";
import { diceRenderer, motionLevel, useSettings, type DiceRenderer } from "../../settings";

/**
 * Shop / inventory dice × board stage (UI-2) — an ADAPTER with exactly the props and handle of FX-1's
 * `FxPreview` (branch claude/epic-cannon-2h7dfr, src/fx-preview, D-104). Shop code only talks to this
 * interface: roll, moment(yacht | straight | win), scoreFx, playSound, reset.
 *
 * Until FX-1 is merged this is a local implementation on the same match pieces (DiceArea, BoardFx,
 * SynergyFx, score-fx). After the merge the whole file becomes:
 *
 *   export { FxPreview as PreviewStage, type FxPreviewHandle as PreviewStageHandle,
 *            type FxMoment as PreviewMoment, type FxPreviewSound as PreviewSound } from "../../fx-preview";
 *
 * (see docs/context/UI-2-SHOP-INVENTORY.md §6). It never equips, saves, scores or reads game RNG.
 */
export type PreviewMoment = "yacht" | "straight" | "win";
export type PreviewSound = "throw" | "impact" | "clack" | "roll" | "land" | "accent" | "board" | PreviewMoment;
export type PreviewStageHandle = {
  roll: () => void;
  moment: (kind: PreviewMoment) => void;
  playSound: (kind: PreviewSound) => void;
  reset: () => void;
  scoreFx: (category: "large" | "yacht") => void;
};
export type PreviewStageProps = {
  dice?: string | null;
  diceLevel?: number;
  board?: string | null;
  boardLevel?: number;
  autoRoll?: boolean;
  renderer?: DiceRenderer;
  sound?: boolean;
  className?: string;
  label?: string;
  onRolled?: (values: number[]) => void;
  ref?: Ref<PreviewStageHandle>;
};

const randomFaces = () => Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 6));
const momentFaces = (kind: "yacht" | "straight") => {
  if (kind === "yacht") return Array(5).fill(1 + Math.floor(Math.random() * 6)) as number[];
  const start = Math.random() < 0.5 ? 1 : 2;
  return [0, 1, 2, 3, 4].map((i) => start + i).sort(() => Math.random() - 0.5);
};
export const previewLevel = (id: string | null | undefined, level = 1) => Math.max(1, Math.min(level, itemById(id ?? undefined)?.maxLevel ?? 1));

export function PreviewStage({ dice: diceId, diceLevel = 1, board: boardId, boardLevel = 1, autoRoll = true, renderer, sound = true, className = "", label = "미리보기 보드", onRolled, ref }: PreviewStageProps) {
  const settings = useSettings();
  const host = useRef<HTMLElement | null>(null);
  const [dice, setDice] = useState(() => randomFaces().map((value, id) => ({ id, value, held: false })));
  const [rolls, setRolls] = useState(0);
  const [rollEvent, setRollEvent] = useState(0);
  const diceItem = diceId ? itemById(diceId) : undefined;
  const boardItem = boardId ? itemById(boardId) : undefined;
  const dLv = previewLevel(diceId, diceLevel);
  const bLv = previewLevel(boardId, boardLevel);
  const look = diceItem ? lookAt(diceItem, dLv).dice ?? null : null;
  const material = diceMaterial(diceId ?? undefined, look ?? undefined);
  const theme = boardTheme(boardItem, bLv, motionLevel(settings) === "full");
  const synergy = synergyOf(diceId ?? undefined, boardId ?? undefined);

  const throwWith = (faces?: number[]) => {
    unlockAudio();
    setDice((prev) => {
      const next = faces ?? randomFaces();
      return prev.map((d, i) => (d.held && !faces ? d : { ...d, value: next[i], held: false }));
    });
    setRolls((r) => (r >= 3 ? 1 : r + 1));
    setRollEvent((n) => n + 1);
  };
  const handle: PreviewStageHandle = {
    roll: () => throwWith(),
    moment: (kind) => {
      if (kind === "win") {
        unlockAudio();
        emitFx({ type: "win" });
        if (sound) playSfx("win");
        return;
      }
      throwWith(momentFaces(kind));
    },
    playSound: (kind) => {
      unlockAudio();
      if (!sound) return;
      const surface = surfaceOf(boardId);
      const map: Record<PreviewSound, [Sfx, SfxOptions] | null> = {
        throw: ["throw", { material }],
        impact: ["impact", { material, surface, intensity: 1 }],
        clack: ["clack", { material, intensity: 0.8 }],
        roll: ["roll", { material, surface, intensity: 0.8 }],
        land: ["settle", { material, surface, intensity: 0.5 }],
        accent: null, // FX-1 adds the Lv.3 landing accent of the dice effect profile
        board: null,
        yacht: ["yachtHit", {}],
        straight: ["straightHit", {}],
        win: ["win", {}],
      };
      const entry = map[kind];
      if (entry) playSfx(entry[0], entry[1]);
    },
    scoreFx: (category) => {
      unlockAudio();
      const v = 1 + Math.floor(Math.random() * 6);
      const example = [0, 1, 2, 3, 4].map((id) => ({ id, value: category === "large" ? id + 1 : v, held: false }));
      setDice(example);
      setRolls(1);
      announceScore(example, category);
      emitFx({ type: category === "large" ? "straight" : "yacht" });
    },
    reset: () => {
      setDice((prev) => prev.map((d) => ({ ...d, held: false })));
      setRolls(0);
    },
  };
  useImperativeHandle(ref, () => handle);
  useEffect(() => {
    if (rollEvent) onRolled?.(dice.map((d) => d.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollEvent]);
  // Changing the dice, board or a level throws again so levels can be compared (not with reduced motion).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (autoRoll && motionLevel() === "full") throwWith();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diceId, boardId, dLv, bLv]);

  const state = { dice, order: [0, 1, 2, 3, 4], rolls: Math.max(1, rolls) };
  return (
    <section ref={host} className={"game-board throw-tray stage-board fx-preview " + className + theme.className} style={theme.style} aria-label={label} data-fx-preview="" data-dice={diceId ?? ""} data-board={boardId ?? ""}>
      <DiceArea key={(diceId ?? "") + "|" + (boardId ?? "")} state={state} forceRenderer={renderer ?? diceRenderer(settings)} colors={look} material={material} interactive animate rollEvent={rollEvent} onToggle={(id) => setDice((prev) => prev.map((d) => (d.id === id ? { ...d, held: !d.held } : d)))} />
      {boardItem && <BoardFx itemId={boardItem.id} level={bLv} host={host} />}
      {synergy && diceItem && boardItem && <SynergyFx dice={diceItem.id} board={boardItem.id} level={Math.min(dLv, bLv)} host={host} />}
    </section>
  );
}
