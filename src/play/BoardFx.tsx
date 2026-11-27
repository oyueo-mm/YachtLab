import { Suspense, lazy, useEffect } from "react";
import { surfaceOf } from "../sound";
import { BOARD_FX_TEXT } from "../fx-texts";
import { synergyOf } from "../economy/live/collections";

const Layer = lazy(() => import("./BoardFxLayer"));
type Props = { itemId?: string | null; level: number; host: React.RefObject<HTMLElement | null>; sound?: boolean };
/** Living board effects (Lv.2+), loaded only when an upgraded board is on screen. */
export function BoardFx(props: Props) {
  // Every board (Lv.1 too) tells the dice what they land on: felt, wood, stone… (collision sounds).
  useEffect(() => {
    const el = props.host.current;
    if (!el) return;
    el.dataset.surface = surfaceOf(props.itemId);
    return () => {
      delete el.dataset.surface;
    };
  }, [props.itemId, props.host]);
  if (props.level < 2 || !BOARD_FX_TEXT[props.itemId ?? ""]) return null;
  return <Suspense fallback={null}><Layer {...props} /></Suspense>;
}

const Synergy = lazy(() => import("./SynergyFxLayer"));
type SynergyProps = { dice?: string; board?: string; level: number; host: React.RefObject<HTMLElement | null>; sound?: boolean };
/**
 * Theme synergy: a die and a board of the same collection equipped together (src/economy/live/
 * collections.ts). Loaded only then; presentation only.
 */
export function SynergyFx(props: SynergyProps) {
  if (!synergyOf(props.dice, props.board)) return null;
  return <Suspense fallback={null}><Synergy {...props} /></Suspense>;
}
