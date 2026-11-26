import { Suspense, lazy } from "react";
import { BOARD_FX_TEXT } from "../fx-texts";

const Layer = lazy(() => import("./BoardFxLayer"));
type Props = { itemId?: string | null; level: number; host: React.RefObject<HTMLElement | null>; sound?: boolean };
/** Living board effects (Lv.2+), loaded only when an upgraded board is on screen. */
export function BoardFx(props: Props) {
  if (props.level < 2 || !BOARD_FX_TEXT[props.itemId ?? ""]) return null;
  return <Suspense fallback={null}><Layer {...props} /></Suspense>;
}
