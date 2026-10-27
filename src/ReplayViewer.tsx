import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  X,
  Download,
  Save,
  Upload,
  Trash2,
  FlaskConical,
  GitBranch,
} from "lucide-react";
import { Dice } from "./Dice";
import { Scoreboard } from "./Scoreboard";
import {
  clone,
  parseReplay,
  downloadReplay,
  replayLimit,
  actionText,
  type Replay,
} from "./replay";
import {
  saveReplay,
  listReplays,
  deleteReplay,
  renameReplay,
} from "./replay-storage";
import { total, type Game } from "./engine";
import type { Choice } from "./dp";
export type AnalysisSource = {
  state: Game;
  actual?: Choice;
  label: string;
};
export default function ReplayViewer({
  replay,
  onClose,
  onBranch,
  onAnalyze,
  initialIndex = 0,
}: {
  replay: Replay;
  onClose: () => void;
  onBranch: (r: Replay, index: number) => void;
  onAnalyze: (source: AnalysisSource) => void;
  initialIndex?: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [view, setView] = useState(() => clone(replay)),
    [index, setIndex] = useState(
      Math.min(initialIndex, replay.frames.length - 1),
    ),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState("1"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [library, setLibrary] = useState<Replay[]>([]),
    [working, setWorking] = useState(false),
    [libraryOpen, setLibraryOpen] = useState(false),
    [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => {
      document.removeEventListener("visibilitychange", change);
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (!playing || !visible) return;
    if (index >= view.frames.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setIndex((i) => Math.min(view.frames.length - 1, i + 1)),
      700 / Number(speed),
    );
    return () => clearTimeout(timer);
  }, [playing, visible, index, speed, view]);
  const step = (n: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(view.frames.length - 1, n)));
  };
  const refresh = async () => {
    try {
      setLibrary(await listReplays());
      setError("");
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  const perform = async (fn: () => Promise<void>) => {
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const open = (r: Replay) => {
    setView(clone(r));
    setIndex(0);
    setPlaying(false);
    setMessage("기보를 열었습니다. 진행 중 대국은 바뀌지 않습니다.");
  };
  const frame = view.frames[index],
    state = frame.state;
  const labels = [0, 1].map((i) => {
    if (view.metadata.source && index > view.metadata.source.frameIndex)
      return view.metadata.players[i].name;
    return (
      [...view.frames.slice(0, index + 1)]
        .reverse()
        .find((f) => f.actor === i && f.actorName)?.actorName ??
      view.frames.find((f) => f.actor === i && f.actorName)?.actorName ??
      view.metadata.players[i].name
    );
  }) as [string, string];
  const canAnalyze =
    index > 0 &&
    (frame.action?.type === "score" || frame.action?.type === "hold") &&
    view.frames[index - 1].state.rolls > 0;
  return (
    <dialog
      ref={dialog}
      className="replay-modal"
      aria-label="기보 보기"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="replay-heading">
        <h2>기보 보기</h2>
        <button
          className="icon-button"
          aria-label="기보 닫기"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="replay-tools">
        <input
          aria-label="기보 이름"
          value={view.metadata.name}
          maxLength={80}
          onChange={(e) =>
            setView((r) => ({
              ...r,
              metadata: { ...r.metadata, name: e.target.value },
            }))
          }
        />
        <button
          className="secondary"
          disabled={working}
          onClick={() =>
            perform(async () => {
              await saveReplay(view);
              setMessage("브라우저에 기보를 저장했습니다.");
              await refresh();
            })
          }
        >
          <Save size={15} />
          저장
        </button>
        <button
          className="secondary"
          onClick={() => {
            try {
              downloadReplay(view);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Download size={15} />
          JSON 내보내기
        </button>
        <label className="secondary file-button">
          <Upload size={15} />
          JSON 불러오기
          <input
            type="file"
            accept="application/json,.json"
            aria-label="기보 JSON 불러오기"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                if (file.size > replayLimit)
                  throw Error("기보 파일은 8MiB 이하여야 합니다.");
                open(parseReplay(await file.text()));
                setError("");
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          />
        </label>
        <button
          className="text-button"
          onClick={() => {
            setLibraryOpen(!libraryOpen);
            void refresh();
          }}
        >
          저장된 기보
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="small-note" role="status">
          {message}
        </p>
      )}
      {libraryOpen && (
        <section className="replay-library panel" aria-label="저장된 기보">
          <p className="small-note">
            브라우저 데이터 삭제 시 사라질 수 있습니다. JSON으로도 보존할 수
            있습니다.
          </p>
          {!library.length && <p>저장된 기보가 없습니다.</p>}
          {library.map((r) => (
            <div key={r.metadata.id}>
              <input
                aria-label={`저장 이름 ${r.metadata.name}`}
                defaultValue={r.metadata.name}
                maxLength={80}
                onBlur={(e) => {
                  const name = e.target.value;
                  if (name !== r.metadata.name)
                    void perform(async () => {
                      await renameReplay(r, name);
                      await refresh();
                    });
                }}
              />
              <span>
                {r.finalState.round}라운드 · {total(r.finalState.cards[0])}:
                {total(r.finalState.cards[1])} · {r.frames.length - 1}수 ·{" "}
                {r.finalState.done ? "종료" : "진행 중"}
              </span>
              <time>
                {new Date(r.metadata.createdAt).toLocaleString("ko-KR")}
              </time>
              <button className="text-button" onClick={() => open(r)}>
                열기
              </button>
              <button
                className="icon-button"
                aria-label={`${r.metadata.name} 내보내기`}
                onClick={() => downloadReplay(r)}
              >
                <Download size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={`${r.metadata.name} 삭제`}
                onClick={() =>
                  perform(async () => {
                    await deleteReplay(r.metadata.id);
                    await refresh();
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="replay-position">
        {state.round}라운드 · {frame.actorName ?? labels[frame.actor]} ·{" "}
        {actionText(frame.action, state, frame.actor)}{" "}
        <span>
          {index} / {view.frames.length - 1}수
        </span>
      </div>
      <div className="replay-board-grid">
        <section className="game-board">
          <div className="board-top">
            <span>
              {labels[state.player]} · {state.done ? "종료" : "차례"}
            </span>
            <span>굴림 {state.rolls} / 3</span>
          </div>
          <Dice state={state} />
        </section>
        <Scoreboard state={state} labels={labels} />
      </div>
      <div className="playback panel">
        <div className="playback-buttons">
          <button
            className="icon-button"
            aria-label="기보 처음"
            onClick={() => step(0)}
          >
            <ChevronsLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="기보 이전"
            disabled={index === 0}
            onClick={() => step(index - 1)}
          >
            <SkipBack size={18} />
          </button>
          <button
            className="primary circle"
            aria-label={playing ? "기보 일시정지" : "기보 재생"}
            onClick={() => {
              if (index === view.frames.length - 1) setIndex(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button
            className="icon-button"
            aria-label="기보 다음"
            disabled={index === view.frames.length - 1}
            onClick={() => step(index + 1)}
          >
            <SkipForward size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="기보 마지막"
            onClick={() => step(view.frames.length - 1)}
          >
            <ChevronsRight size={18} />
          </button>
          <select
            aria-label="기보 재생 속도"
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
          >
            {["0.25", "0.5", "1", "2", "4", "8", "16"].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
        <input
          type="range"
          aria-label="기보 타임라인"
          min={0}
          max={view.frames.length - 1}
          value={index}
          onChange={(e) => step(Number(e.target.value))}
        />
      </div>
      <div className="replay-actions">
        {view.frames.map((f, i) => (
          <button
            key={i}
            className={i === index ? "active" : ""}
            onClick={() => step(i)}
            aria-current={i === index ? "step" : undefined}
          >
            {i} · {f.actorName ?? labels[f.actor]} ·{" "}
            {actionText(f.action, f.state, f.actor)}
          </button>
        ))}
      </div>
      <div className="replay-tools">
        <button
          className="primary"
          disabled={state.done || working}
          onClick={() =>
            perform(async () => {
              await saveReplay(view);
              onBranch(clone(view), index);
            })
          }
        >
          <GitBranch size={16} />
          AI 아레나에서 이어하기
        </button>
        <button
          className="secondary"
          disabled={!canAnalyze || working}
          onClick={() =>
            perform(async () => {
              await saveReplay(view);
              const action = frame.action!;
              onAnalyze({
                state: clone(view.frames[index - 1].state),
                actual:
                  action.type === "score"
                    ? { type: "score", category: action.category }
                    : action.type === "hold"
                      ? { type: "reroll", ids: clone(action.ids) }
                      : undefined,
                label: `${state.round}라운드 · ${frame.actorName ?? labels[frame.actor]} · ${actionText(action, state, frame.actor)}`,
              });
            })
          }
        >
          <FlaskConical size={16} />이 수를 분석하기
        </button>
      </div>
    </dialog>
  );
}
