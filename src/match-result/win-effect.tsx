/**
 * 장착한 승리 특수 효과(fx 아이템)를 결과 창의 effect 슬롯으로 (A3). 온라인 결과 화면과 같은 FxBurst를 쓰고,
 * Lv.3 아이템은 자체 효과음이 있으므로 결과 강조음을 대신한다(중복 방지).
 */
import { itemById, type PublicLook } from "../economy/live/catalog";
import { FxBurst } from "../play/FxBurst";

export function winEffect(look: PublicLook | null | undefined, seed: string | number) {
  if (!look || look.fx === "fx.none") return null;
  const fx = itemById(look.fx)?.look.fx;
  if (!fx) return null;
  const level = look.fxLv ?? 1;
  return { effect: <FxBurst fx={fx} level={level} seed={`result-${seed}`} />, effectSound: level >= 3 && !!fx.sound };
}
