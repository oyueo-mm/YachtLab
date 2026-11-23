import { useEffect, useState } from "react";
import type { Game } from "./engine";
import { Dice } from "./Dice";
import { PhysicalDice } from "./PhysicalDice";
import { diceTableModule, loadDiceTable, type DiceTableModule } from "./dice3d-loader";
import { diceRenderer, useSettings, type DiceRenderer } from "./settings";

type Props = {
  state: Pick<Game, "dice" | "order" | "rolls">;
  interactive?: boolean;
  animate?: boolean;
  rollEvent?: number;
  onToggle?: (id: number) => void;
  onOrder?: (ids: number[]) => void;
  /** Dice lab only. */
  forceRenderer?: DiceRenderer;
};

/**
 * Chooses how dice are shown:
 *  - 3D physical table (dice rest where they land, held dice on a shelf) when WebGL and motion allow;
 *  - otherwise the original DOM row with 2.5D motion (or no motion), same hold/re-roll/score rules.
 * The mode only changes between turns (before the first roll), never in the middle of one.
 */
export function DiceArea({ forceRenderer, ...props }: Props) {
  const settings = useSettings();
  const renderer = forceRenderer ?? diceRenderer(settings);
  const want3d = !!props.animate && (renderer === "3d" || renderer === "3d-high");
  const [mod, setMod] = useState<DiceTableModule | null>(diceTableModule);
  const [failed, setFailed] = useState(false);
  const [use3d, setUse3d] = useState(want3d && !!mod);
  useEffect(() => {
    if (want3d && !mod) void loadDiceTable().then((m) => m && setMod(m));
  }, [want3d, mod]);
  useEffect(() => {
    if (props.state.rolls === 0 || forceRenderer) setUse3d(want3d && !!mod);
  }, [props.state.rolls, want3d, mod, forceRenderer]);
  if (use3d && mod && !failed && (renderer === "3d" || renderer === "3d-high"))
    return <PhysicalDice key={renderer} module={mod} quality={renderer} state={props.state} interactive={!!props.interactive} rollEvent={props.rollEvent ?? 0} onToggle={props.onToggle} onOrder={props.onOrder} onFailure={() => setFailed(true)} />;
  // Fallback row: plain 2.5D (or none) — the old 3D overlay is not used in games anymore.
  return <Dice {...props} forceRenderer={renderer === "none" ? "none" : "2.5d"} />;
}
