import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Trophy, X } from "lucide-react";
import { useScoreFx } from "../score-fx";
import { motionLevel } from "../settings";
import "./match-result.css";

/** Presentation only. The game still owns settlement and rematch. Mount only for a finished match. */
export function MatchResult({ title, children, actions, className = "", waiting, invitation = false }: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  className?: string;
  waiting?: boolean;
  invitation?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const [shown, setShown] = useState(false);
  const fx = useScoreFx();

  useEffect(() => {
    if (shown) return;
    const motion = motionLevel() !== "none";
    if (motion && waiting) return;
    const remaining = motion && fx?.grand ? fx.at + fx.ms - performance.now() : 0;
    const timer = window.setTimeout(() => {
      setOpened(true);
      setShown(true);
    }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [fx, shown, waiting]);

  useEffect(() => {
    const surface = dialog.current;
    if (opened && !surface?.open) surface?.showModal();
    if (!opened && surface?.open) {
      surface.close();
      trigger.current?.focus();
    }
  }, [opened]);

  return <>
    {shown && <button ref={trigger} type="button" className="secondary match-result-reopen" onClick={() => setOpened(true)}>
      <Trophy size={16} /> {invitation ? "경기 결과 · 재대결 요청" : "경기 결과"}
    </button>}
    <dialog ref={dialog} className="match-result-dialog" aria-labelledby={id} onCancel={(event) => {
      event.preventDefault();
      setOpened(false);
    }}>
      <section className={"game-result " + className}>
        <button type="button" className="icon-button match-result-close" aria-label="결과 닫기" onClick={() => setOpened(false)}><X size={20} /></button>
        <Trophy size={25} aria-hidden="true" />
        <h2 id={id}>{title}</h2>
        {children}
        <div className="game-result-actions">{actions}</div>
      </section>
    </dialog>
  </>;
}
