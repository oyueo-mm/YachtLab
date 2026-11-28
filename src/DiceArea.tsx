import type { DiceMaterial } from "./sound-packs";
import type { DiceLook } from "./dice3d/dice-look";
import { lazy, Suspense, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { nextHoldOrder, shiftHoldOrder } from "./hold-order";
import type { Game } from "./engine";
import { Dice } from "./Dice";
import { PhysicalDice } from "./PhysicalDice";
import { diceTableModule, loadDiceTable, type DiceTableModule } from "./dice3d-loader";
import { diceRenderer, useSettings, type DiceRenderer } from "./settings";
import { useScoreFx, type ScoreFx } from "./score-fx";
import { beginDiceMotion } from "./dice-motion";
import { DieIcon } from "./Dice";
import { StraightFlash, YachtFlash } from "./yacht-moment";
import { diceMaterialSpec } from "./dice3d/dice-material";

const TABLE_TIMEOUT_MS = 12_000;

type Props = {
  material?: DiceMaterial;
  soundEnabled?: boolean;
  state: Pick<Game, "dice" | "order" | "rolls">;
  interactive?: boolean;
  focusDie?: number;
  animate?: boolean;
  rollEvent?: number;
  onToggle?: (id: number) => void;
  onOrder?: (ids: number[]) => void;
  /**
   * Held dice in the order they were selected (shelf order). Given by online play, where the server
   * decides it so both players see the same shelf; otherwise tracked here from the `held` flags.
   */
  holdOrder?: readonly number[];
  /** Explicit visual mode for the dice lab or a static tutorial placeholder. */
  forceRenderer?: DiceRenderer;
  onRendererReady?: () => void;
  /** Dice theme (online play: the player whose turn it is; the same on every screen). */
  colors?: (DiceLook & { face: string; pip: string; edge: string }) | null;
};

/**
 * Chooses how dice are shown:
 *  - 3D physical table (dice rest where they land, held dice on a shelf) when WebGL and motion allow;
 *  - otherwise the original DOM row with 2.5D motion (or no motion), same hold/re-roll/score rules.
 * The mode only changes between turns (before the first roll), never in the middle of one.
 */
const Dice25FxLayer = lazy(() => import("./dice3d/Dice25Fx"));
/** 2.5D fallback (no WebGL / lighter motion): the die's own Lv.3 collision and landing effects. */
function Dice25Fx(props: { itemId: string; soundEnabled: boolean }) {
  return <Suspense fallback={null}><Dice25FxLayer {...props} /></Suspense>;
}

export function DiceArea({ forceRenderer, onRendererReady, colors = null, material, soundEnabled = true, ...props }: Props) {
  const settings = useSettings();
  const renderer = forceRenderer ?? diceRenderer(settings);
  const want3d = !!props.animate && (renderer === "3d" || renderer === "3d-high");
  const [mod, setMod] = useState<DiceTableModule | null>(diceTableModule);
  const [failed, setFailed] = useState(false);
  const [use3d, setUse3d] = useState(want3d && !!mod);
  const [readyRenderer, setReadyRenderer] = useState<DiceRenderer | null>(null);
  const firstRoll = props.state.rolls === 0;
  useLayoutEffect(() => {
    if (!want3d || failed || readyRenderer === renderer || !firstRoll) return;
    // The game may be entered directly on a cold connection. Use the same input lock as a throw.
    const release = beginDiceMotion(TABLE_TIMEOUT_MS + 1000);
    const timeout = window.setTimeout(() => setFailed(true), TABLE_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
      release();
    };
  }, [want3d, failed, readyRenderer, renderer, firstRoll]);
  useEffect(() => {
    if (!want3d || mod || failed) return;
    let active = true;
    void loadDiceTable().then((module) => {
      if (!active) return;
      if (module) setMod(module);
      else setFailed(true);
    });
    return () => { active = false; };
  }, [want3d, mod, failed]);
  useEffect(() => {
    if (props.state.rolls === 0 || forceRenderer) setUse3d(want3d && !!mod);
  }, [props.state.rolls, want3d, mod, forceRenderer]);
  useEffect(() => {
    if (!want3d || failed) onRendererReady?.();
  }, [want3d, failed, onRendererReady]);
  const fx = useScoreFx();
  // Selection order of held dice (presentation only; the engine's values and held flags are untouched).
  const auto = useRef<number[]>([]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const holdOrder = nextHoldOrder(props.holdOrder ?? auto.current, props.state.dice);
  if (!props.holdOrder) auto.current = holdOrder;
  /** Alt + arrow on a held die moves it on the shelf (only when this screen owns the order). */
  const onShiftHold = props.holdOrder
    ? undefined
    : (id: number, step: -1 | 1) => {
        auto.current = shiftHoldOrder(auto.current, id, step);
        rerender();
      };
  const physical = use3d && mod && !failed && (renderer === "3d" || renderer === "3d-high");
  const tableReady = () => {
    setReadyRenderer(renderer);
    onRendererReady?.();
  };
  if (physical)
    return (
      <>
        <PhysicalDice key={renderer} colors={colors} material={material} soundEnabled={soundEnabled} module={mod} quality={renderer} state={props.state} holdOrder={holdOrder} adaptive={!forceRenderer && settings.diceQuality === "auto"} interactive={!!props.interactive} focusDie={props.focusDie} rollEvent={props.rollEvent ?? 0} onToggle={props.onToggle} onOrder={props.onOrder} onShiftHold={onShiftHold} onReady={tableReady} onFailure={() => setFailed(true)} />
        <ScoreFxLabel fx={fx} />
        {props.animate && <YachtFlash soundEnabled={soundEnabled} dice={props.state.dice} rolls={props.state.rolls} rollEvent={props.rollEvent ?? 0} />}
        {props.animate && <StraightFlash soundEnabled={soundEnabled} dice={props.state.dice} rolls={props.state.rolls} rollEvent={props.rollEvent ?? 0} />}
      </>
    );
  // Fallback row: plain 2.5D (or none) — the old 3D overlay is not used in games anymore.
  return (
    <>
      {colors ? (
        <div className="dice-themed" data-material={diceMaterialSpec(colors, colors.fx).class} style={{ "--die-face": colors.face, "--die-pip": colors.pip, "--die-edge": colors.edge, "--die-accent": colors.accent ?? colors.edge } as React.CSSProperties}>
          <Dice {...props} material={material} soundEnabled={soundEnabled} holdOrder={holdOrder} forceRenderer={renderer === "none" ? "none" : "2.5d"} />
        </div>
      ) : (
        <Dice {...props} material={material} soundEnabled={soundEnabled} holdOrder={holdOrder} forceRenderer={renderer === "none" ? "none" : "2.5d"} />
      )}
      <ScoreFxFallback fx={fx} reduced={renderer === "none"} />
      {renderer !== "none" && colors?.fx && (colors.fxLevel ?? 1) >= 3 && <Dice25Fx itemId={colors.fx} soundEnabled={soundEnabled} />}
      <ScoreFxLabel fx={fx} />
      {props.animate && <YachtFlash soundEnabled={soundEnabled} dice={props.state.dice} rolls={props.state.rolls} rollEvent={props.rollEvent ?? 0} />}
      {props.animate && <StraightFlash soundEnabled={soundEnabled} dice={props.state.dice} rolls={props.state.rolls} rollEvent={props.rollEvent ?? 0} />}
    </>
  );
}

/** Combination name and points, shown for scores worth celebrating (never for 0 points). */
function ScoreFxLabel({ fx }: { fx: ScoreFx | null }) {
  if (!fx || fx.ids.length === 0) return null;
  return (
    <div key={fx.key} className={"score-fx-label" + (fx.grand ? " grand" : "")} role="status" style={{ animationDuration: `${fx.ms}ms` }}>
      <strong>{fx.label}</strong>
      <b>+{fx.points}</b>
    </div>
  );
}

/**
 * Same meaning without WebGL: the dice that make the combination pop up in a strip (static for
 * reduced motion). Input stays locked for the same time as the 3D effect.
 */
function ScoreFxFallback({ fx, reduced }: { fx: ScoreFx | null; reduced: boolean }) {
  const [shown, setShown] = useState(0);
  const fresh = !!fx && fx.ids.length > 0 && performance.now() - fx.at < 500;
  const ms = reduced ? 450 : fx?.ms ?? 0;
  useEffect(() => {
    if (!fx || !fresh) return;
    setShown(fx.key);
    const done = beginDiceMotion(ms + 300);
    const timer = window.setTimeout(() => {
      setShown(0);
      done(); // the lock lasts exactly as long as the effect
    }, ms);
    return () => {
      window.clearTimeout(timer);
      done();
      setShown(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx?.key]);
  if (!fx || shown !== fx.key) return null;
  return (
    <div key={fx.key} className={"score-fx-strip" + (reduced ? " static" : "")} style={{ animationDuration: `${ms}ms` }} aria-hidden="true">
      {fx.ids.map((id) => (
        <DieIcon key={id} value={fx.values[id]} />
      ))}
    </div>
  );
}
