import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function MobileScoreButton({ onClick, rolls, canScore = true, yacht = false }: {
  onClick: () => void;
  rolls: number;
  canScore?: boolean;
  yacht?: boolean;
}) {
  const recordable = rolls > 0 && canScore;
  return (
    <button type="button" className={"mobile-score-button" + (yacht ? " yacht-ready" : "")} onClick={onClick} aria-label="점수판 열기">
      <span>{recordable ? (yacht ? "요트! 점수 기록" : "점수 기록") : "점수판 보기"}</span>
      <span aria-hidden="true">↑</span>
    </button>
  );
}

export default function MobileScoreSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const panel = ref.current;
    const prior = document.activeElement;
    panel?.showModal();
    return () => {
      panel?.close();
      if (prior instanceof HTMLElement) prior.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={ref} className="mobile-score-dialog" aria-label="점수판"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mobile-score-sheet">
        <div className="mobile-score-heading">
          <strong>점수판</strong>
          <button type="button" className="icon-button" aria-label="점수판 닫기" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="mobile-score-scroll">{children}</div>
      </div>
    </dialog>
  );
}
