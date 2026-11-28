/**
 * 0점 확정 기록 팝업 (A3, 독립 컴포넌트). 게임 보드 위에 짧게 뜨고 스스로 사라진다.
 * - 입력을 가로막지 않는다(pointer-events: none), 스크린리더에는 polite로 한 번 읽힌다.
 * - 효과음: 기본 꺼짐. 실제 게임에서는 game-feel.ts가 채점 순간 "scoreZero"를 이미 재생하므로,
 *   통합 시 중복 재생을 피한다. 미리보기에서만 sound=true로 같은 소리를 들려준다.
 * - 저감 모션: 움직임 없이 나타났다 사라진다.
 */
import { useEffect } from "react";
import { MinusCircle } from "lucide-react";
import { playSfx } from "../sound";
import { motionLevel, type MotionLevel } from "../settings";
import type { ZeroScoreNotice } from "./zero-score";
import "./match-result-a3.css";

export const ZERO_TOAST_MS = 1600;

export function ZeroScoreToast({ notice, onDone, sound = false, motion }: { notice: ZeroScoreNotice | null; onDone: () => void; sound?: boolean; motion?: MotionLevel }) {
  useEffect(() => {
    if (!notice) return;
    if (sound) playSfx("scoreZero", { intensity: 0.8 });
    const timer = window.setTimeout(onDone, ZERO_TOAST_MS);
    return () => window.clearTimeout(timer);
    // onDone은 호출한 쪽이 매 렌더 새로 만들 수 있어 key(알림)만 따른다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.key]);
  if (!notice) return null;
  return (
    <div className="a3-zero-toast" key={notice.key} role="status" aria-live="polite" data-motion={motion ?? motionLevel()}>
      <MinusCircle size={18} aria-hidden="true" />
      <span><b>{notice.title}</b>{notice.detail && <small>{notice.detail}</small>}</span>
    </div>
  );
}
