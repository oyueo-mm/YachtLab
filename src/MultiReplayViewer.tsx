import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Pause, Play, Save, SkipBack, SkipForward, Trash2, Upload, X } from "lucide-react";
import { Dice } from "./Dice";
import { names, type Action } from "./engine";
import { MultiScoreboard, MultiStandings } from "./MultiScoreboard";
import { createMultiGame, type MultiGame } from "./multi-engine";
import { downloadMultiReplay, parseMultiReplay, replaySeek, validateMultiReplay, type MultiReplay } from "./multi-replay";
import { deleteMultiReplay, listMultiReplays, renameMultiReplay, saveMultiReplay } from "./multi-replay-storage";

function actionDescription(action: Action | undefined, after: MultiGame, actor: number) {
  if (!action) return "경기 시작";
  if (action.type === "roll") return after.rolls + "번째 굴림";
  if (action.type === "hold") return action.ids.length + "개 주사위 고정";
  if (action.type === "order") return "주사위 순서 변경";
  return names[action.category] + " " + after.cards[actor][action.category] + "점 기록";
}
export default function MultiReplayViewer({ replay, onClose }: { replay: MultiReplay; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState(() => validateMultiReplay(replay));
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState<MultiReplay[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState(view.metadata.name);
  const [busy, setBusy] = useState(false);
  const seek = useMemo(() => replaySeek(view), [view]);
  const state = seek(index);
  const previous = index === 0 ? createMultiGame(view.metadata.players.length, view.seed) : seek(index - 1);
  const action = view.actions[index - 1];
  const labels = view.metadata.players.map((p) => p.name);
  const actor = previous.player;
  const go = (next: number) => { setPlaying(false); setIndex(Math.min(view.actions.length, Math.max(0, next))); };

  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); prior?.focus(); };
  }, []);
  useEffect(() => {
    if (!playing || document.hidden) return;
    if (index >= view.actions.length) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setIndex((i) => Math.min(view.actions.length, i + 1)), 350);
    return () => window.clearTimeout(timer);
  }, [playing, index, view]);
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const refresh = async () => setSaved(await listMultiReplays());
  const choose = (r: MultiReplay) => {
    const checked = validateMultiReplay(r);
    setView(checked); setTitle(checked.metadata.name); setIndex(0); setPlaying(false); setMessage("기보를 열었습니다. 진행 중 대국은 변경되지 않습니다.");
  };
  const upload = (file?: File) => {
    if (!file) return;
    void perform(async () => {
      if (file.size > 4 * 1024 * 1024) throw Error("기보 파일은 4MiB 이하여야 합니다.");
      choose(parseMultiReplay(await file.text()));
      setMessage("기보를 불러왔습니다.");
    });
  };
  return (
    <dialog ref={dialog} className="replay-modal multi-replay-modal" aria-label="기보 보기" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="replay-heading">
        <h2>기보 보기 · {view.metadata.players.length}인전</h2>
        <button className="icon-button" aria-label="기보 닫기" onClick={onClose}><X size={19} /></button>
      </div>
      <div className="multi-replay-actions">
        <label className="field">기보 이름
          <input aria-label="기보 이름" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button className="secondary" disabled={busy} onClick={() => void perform(async () => {
          const renamed = { ...view, metadata: { ...view.metadata, name: title.trim().slice(0, 80) } };
          await saveMultiReplay(renamed);
          setView(renamed); await refresh(); setMessage("브라우저에 기보를 저장했습니다.");
        })}><Save size={15} /> 저장</button>
        <button className="secondary" onClick={() => {
          try { downloadMultiReplay({ ...view, metadata: { ...view.metadata, name: title.trim().slice(0, 80) } }); setError(""); } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
        }}><Download size={15} /> JSON 내보내기</button>
        <label className="secondary multi-import"><Upload size={15} /> JSON 불러오기
          <input type="file" accept=".json,application/json" aria-label="기보 JSON 불러오기" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <button className="text-button" disabled={busy} onClick={() => void perform(async () => { await refresh(); setMessage("저장된 기보를 불러왔습니다."); })}>저장된 기보</button>
      </div>
      {saved.length > 0 && (
        <div className="multi-saved-list">
          {saved.map((r) => (
            <div key={r.metadata.id} className="multi-saved-row">
              <span>{r.metadata.name} · {r.metadata.players.length}명</span>
              <button className="text-button" onClick={() => choose(r)}>열기</button>
              <button className="text-button" disabled={busy} onClick={() => void perform(async () => {
                await deleteMultiReplay(r.metadata.id); await refresh(); setMessage("기보를 삭제했습니다.");
              })}><Trash2 size={13} /> 삭제</button>
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {message && <p className="multi-replay-message" role="status">{message}</p>}
      <div className="replay-position">
        {state.round}라운드 · {labels[actor]} · {actionDescription(action, state, actor)}
        <span>{index} / {view.actions.length}수</span>
      </div>
      <div className="multi-replay-timeline">
        <input aria-label="기보 타임라인" type="range" min={0} max={view.actions.length || 1} value={index} onChange={(e) => go(Number(e.target.value))} disabled={view.actions.length === 0} />
        <div className="multi-replay-controls">
          <button className="secondary" aria-label="기보 처음" onClick={() => go(0)} disabled={index === 0}><SkipBack size={15} /></button>
          <button className="secondary" aria-label="기보 이전" onClick={() => go(index - 1)} disabled={index === 0}>이전</button>
          <button className="primary" aria-label={playing ? "기보 일시정지" : "기보 재생"} onClick={() => { if (index >= view.actions.length) setIndex(0); setPlaying((v) => !v); }} disabled={view.actions.length === 0}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
          <button className="secondary" aria-label="기보 다음" onClick={() => go(index + 1)} disabled={index === view.actions.length}>다음</button>
          <button className="secondary" aria-label="기보 마지막" onClick={() => go(view.actions.length)} disabled={index === view.actions.length}><SkipForward size={15} /></button>
        </div>
      </div>
      <div className="multi-replay-grid">
        <section className="game-board" aria-label="기보 주사위">
          <div className="board-top"><span>{labels[state.player]} · {state.done ? "종료" : "차례"}</span><span>굴림 {state.rolls} / 3</span></div>
          <Dice state={state} />
        </section>
        <MultiScoreboard state={state} labels={labels} focused={labels.length >= 9} />
      </div>
      {labels.length >= 9 && <MultiStandings state={state} labels={labels} />}
    </dialog>
  );
}
