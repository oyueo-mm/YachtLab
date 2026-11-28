import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { DiceArea } from "../DiceArea";
import { BoardFx, SynergyFx } from "../play/BoardFx";
import { boardTheme } from "../play/Looks";
import { emitFx } from "../fx-bus";
import { announceScore } from "../score-fx";
import { itemById, lookAt } from "../economy/live/catalog";
import { synergyOf } from "../economy/live/collections";
import { diceMaterial } from "../sound-packs";
import { diceFx } from "../dice3d/dice-fx";
import { playSfx, unlockAudio, type Sfx, type SfxOptions, type Surface } from "../sound";
import { diceRenderer, motionLevel, useSettings, type DiceRenderer } from "../settings";

/**
 * FX-1 preview interface (for the shop / item detail, owner 02; same pieces as the match screen, owner 01).
 *
 * One self-contained stage: the real dice table (`DiceArea` → 3D table or the 2.5D fallback), the real
 * board layers (`BoardFx` Lv.2/Lv.3, `SynergyFx`), and the real yacht / large-straight moments
 * (`YachtFlash` / `StraightFlash` inside DiceArea). Nothing here is a copy: what the preview shows is what a
 * match shows for the same items and levels. It never equips, saves or scores anything, and it does not
 * touch game RNG: preview throws pick their own faces (only `moment()` asks for specific faces).
 *
 *   const ref = useRef<FxPreviewHandle>(null);
 *   <FxPreview ref={ref} dice="dice.lava" diceLevel={3} board="board.volcano" boardLevel={2} />
 *   ref.current?.roll();            // a real throw
 *   ref.current?.moment("yacht");   // a throw that lands as a yacht → the match's yacht moment
 *   ref.current?.playSound("land"); // one sound of the current dice/board, through the live mix
 *
 * Settings are respected exactly as in a match: mute / effects volume, 효과 줄이기, 동작 줄이기,
 * 효과 품질 (adaptive tier), and the 3D / 2.5D choice. `renderer` can force "2.5d" for a comparison.
 */
export type FxMoment = "yacht" | "straight" | "win";
export type FxPreviewSound = "throw" | "impact" | "clack" | "roll" | "land" | "accent" | "board" | FxMoment;
export type FxPreviewHandle = {
  /** A real throw of the dice that are not held (random faces). */
  roll: () => void;
  /** Special moment: yacht / large straight land from a real throw; win fires the board and sound. */
  moment: (kind: FxMoment) => void;
  /** Play one sound of the current combination (same voices, buses and limiter as a match). */
  playSound: (kind: FxPreviewSound) => void;
  /** Release every held die and return to a fresh first throw. */
  reset: () => void;
  /**
   * The score celebration of a combination on the dice as they lie now (no throw): the dice spring up
   * as when the score is recorded in a match, and the board reacts (large straight / yacht).
   */
  scoreFx: (category: "large" | "yacht") => void;
};
export type FxPreviewProps = {
  dice?: string | null;
  diceLevel?: number;
  board?: string | null;
  boardLevel?: number;
  /** Throw once when the dice / board / levels change (default true; never with reduced motion). */
  autoRoll?: boolean;
  renderer?: DiceRenderer;
  sound?: boolean;
  className?: string;
  label?: string;
  onRolled?: (values: number[]) => void;
  ref?: Ref<FxPreviewHandle>;
};

const randomFaces = () => Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 6));
const MOMENT_FACES: Record<Exclude<FxMoment, "win">, () => number[]> = {
  yacht: () => Array(5).fill(1 + Math.floor(Math.random() * 6)),
  straight: () => {
    const start = Math.random() < 0.5 ? 1 : 2;
    return [0, 1, 2, 3, 4].map((i) => start + i).sort(() => Math.random() - 0.5);
  },
};

/** Clamp a level to what the item supports (Lv.1 when the item has no upgrades). */
export const previewLevel = (id: string | null | undefined, level = 1) => Math.max(1, Math.min(level, itemById(id ?? undefined)?.maxLevel ?? 1));

export function FxPreview({ dice: diceId, diceLevel = 1, board: boardId, boardLevel = 1, autoRoll = true, renderer, sound = true, className = "", label = "미리보기 보드", onRolled, ref }: FxPreviewProps) {
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
  const handle: FxPreviewHandle = {
    roll: () => throwWith(),
    moment: (kind) => {
      if (kind === "win") {
        unlockAudio();
        emitFx({ type: "win" });
        if (sound) playSfx("win");
        return;
      }
      throwWith(MOMENT_FACES[kind]());
    },
    playSound: (kind) => {
      unlockAudio();
      if (!sound) return;
      const surface = (host.current?.dataset.surface || undefined) as Surface | undefined;
      const land = look?.fxLevel === 3 ? diceFx(look.fx)?.sound ?? null : null;
      const map: Record<FxPreviewSound, [Sfx, SfxOptions] | null> = {
        throw: ["throw", { material }],
        impact: ["impact", { material, surface, intensity: 1 }],
        clack: ["clack", { material, intensity: 0.8 }],
        roll: ["roll", { material, surface, intensity: 0.8 }],
        land: ["settle", { material, surface, intensity: 0.5 }],
        accent: land ? ["diceFx", { land }] : null,
        board: ["boardFx", { land: "chime" }],
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

  // Changing the dice, board or a level throws again so levels can be compared directly (not with reduced motion).
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
      <DiceArea key={(diceId ?? "") + "|" + (boardId ?? "")} state={state} forceRenderer={renderer ?? diceRenderer(settings)} colors={look} material={material} soundEnabled={sound} interactive animate rollEvent={rollEvent} onToggle={(id) => setDice((prev) => prev.map((d) => (d.id === id ? { ...d, held: !d.held } : d)))} />
      {boardItem && <BoardFx itemId={boardItem.id} level={bLv} host={host} sound={sound} />}
      {synergy && diceItem && boardItem && <SynergyFx dice={diceItem.id} board={boardItem.id} level={Math.min(dLv, bLv)} host={host} sound={sound} />}
    </section>
  );
}
