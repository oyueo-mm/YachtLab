/**
 * A3 경기 종료 화면 (독립 컴포넌트). 기존 src/ui/MatchResult.tsx와 게임 화면은 아직 바꾸지 않는다 —
 * A2.1·C3 병합 뒤 각 게임 화면에서 이 컴포넌트로 옮긴다(docs/context/A3-MATCH-RESULT-2026-11-27.md §통합).
 * 표시 전용: 정산·재대결·친구 요청은 호출한 쪽이 처리하고, 여기서는 결과를 받아 보여 주기만 한다.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Award, Check, Clock, Coins, Flame, Gem, Home, Medal, RotateCcw, Search, Share2, Sparkles, TrendingUp, Trophy, UserPlus, X, Zap } from "lucide-react";
import { QUESTS } from "../economy/live/config";
import { motionLevel, type MotionLevel } from "../settings";
import { rewardView, summarize, type Highlight, type QuestLookup, type ResultInput, type ResultSummary } from "./model";
import { playResultSounds, resultSoundPlan } from "./result-sfx";
import "./match-result-a3.css";

export type ResultActions = {
  onRematch?: () => void;
  /** 온라인 재대결처럼 상태가 있는 컨트롤은 호출한 쪽의 요소를 그대로 넣는다(onRematch 대신). */
  rematchSlot?: ReactNode;
  rematchLabel?: string;
  onReview?: () => void;
  /** 상대가 회원이고 아직 친구가 아닐 때만 넘긴다. sent=true면 "요청 보냄"으로 표시. */
  addFriend?: { name: string; onClick: () => void; sent?: boolean };
  onShare?: () => void;
  onHome?: () => void;
  homeLabel?: string;
};

export type MatchResultPanelProps = {
  input: ResultInput;
  actions: ResultActions;
  /** 좌석별 프로필 이미지(예: ProfileAvatar). 없으면 이름 첫 글자. */
  avatars?: Record<string, ReactNode>;
  /** 요트·보너스 연출이 끝날 때까지 열기를 미룬다(기존 MatchResult와 같은 의미). */
  waiting?: boolean;
  /** accent: 강조음만(기본, 승패 기본음은 게임이 이미 재생), full: 기본음 포함(미리보기), off: 무음. */
  sound?: "accent" | "full" | "off";
  /** 미리보기용 강제 모션 단계. 생략하면 설정·시스템 값. */
  motion?: MotionLevel;
  questLookup?: QuestLookup;
  /** 장착한 승리 특수 효과 등 추가 연출 슬롯(우선 표시). */
  effect?: ReactNode;
  className?: string;
};

const questFromConfig: QuestLookup = (id) => {
  const q = QUESTS.find((entry) => entry.id === id);
  return q ? { label: q.label, period: q.period, count: q.count } : undefined;
};

const HIGHLIGHT_ICON: Record<Highlight["id"], ReactNode> = {
  yacht: <Sparkles size={16} aria-hidden="true" />,
  large: <Zap size={16} aria-hidden="true" />,
  bonus: <Award size={16} aria-hidden="true" />,
  "personal-best": <Medal size={16} aria-hidden="true" />,
  "first-record": <Medal size={16} aria-hidden="true" />,
  streak: <Flame size={16} aria-hidden="true" />,
  "grand-comeback": <TrendingUp size={16} aria-hidden="true" />,
  comeback: <TrendingUp size={16} aria-hidden="true" />,
  "final-turn": <TrendingUp size={16} aria-hidden="true" />,
  close: <Trophy size={16} aria-hidden="true" />,
};

function useCountUp(target: number, enabled: boolean, ms = 900) {
  const [value, setValue] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const p = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, enabled, ms]);
  return value;
}

export function MatchResultPanel({ input, actions, avatars = {}, waiting = false, sound = "accent", motion, questLookup = questFromConfig, effect, className = "" }: MatchResultPanelProps) {
  const id = useId();
  const summary = useMemo(() => summarize(input), [input]);
  const rewards = useMemo(() => rewardView(input.rewards, questLookup), [input.rewards, questLookup]);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const [shown, setShown] = useState(false);
  const level = motion ?? motionLevel();
  const played = useRef(false);

  useEffect(() => {
    if (shown || waiting) return;
    setOpened(true);
    setShown(true);
  }, [shown, waiting]);

  // 처음 열릴 때 한 번만 소리를 낸다(다시 열기에는 소리 없음).
  useEffect(() => {
    if (!shown || played.current || sound === "off") return;
    played.current = true;
    playResultSounds(resultSoundPlan(summary.outcome.kind, summary.drama, { includeBase: sound === "full", rank: summary.outcome.rank, shared: summary.outcome.sharedRank }));
  }, [shown, sound, summary]);

  useEffect(() => {
    const surface = dialog.current;
    if (!surface) return;
    if (opened && !surface.open) {
      if (typeof surface.showModal === "function") surface.showModal();
      else surface.setAttribute("open", "");
    }
    if (!opened && surface.open) {
      surface.close();
      trigger.current?.focus();
    }
  }, [opened]);

  const tone = summary.outcome.tone;
  return <>
    {shown && <button ref={trigger} type="button" className="secondary a3-result-reopen" onClick={() => setOpened(true)}>
      <Trophy size={16} aria-hidden="true" /> 경기 결과 보기
    </button>}
    <dialog ref={dialog} className={`a3-result-dialog ${className}`} aria-labelledby={id} data-tone={tone} data-drama={summary.drama ?? "none"} data-motion={level}
      onCancel={(event) => { event.preventDefault(); setOpened(false); }}>
      <section className="a3-result">
        <button type="button" className="icon-button a3-result-close" aria-label="결과 닫기" onClick={() => setOpened(false)}><X size={20} aria-hidden="true" /></button>
        {opened && level !== "none" && tone === "win" && <Burst grand={summary.drama === "grand-comeback" || summary.drama === "comeback"} lite={level === "lite"} />}
        {effect}
        <ResultHeader id={id} summary={summary} />
        <Standings summary={summary} avatars={avatars} animate={opened && level !== "none"} solo={input.seats.length === 1} />
        <Meta summary={summary} />
        {summary.highlights.length > 0 && (
          <ul className="a3-highlights" aria-label="경기 하이라이트">
            {summary.highlights.map((h) => (
              <li key={h.id} data-kind={h.id}>{HIGHLIGHT_ICON[h.id]}<b>{h.label}</b>{h.detail && <small>{h.detail}</small>}</li>
            ))}
          </ul>
        )}
        <Rewards view={rewards} />
        <div className="a3-actions">
          {actions.rematchSlot ?? (actions.onRematch && <button type="button" className="primary" onClick={actions.onRematch}><RotateCcw size={16} aria-hidden="true" /> {actions.rematchLabel ?? "재대결"}</button>)}
          {actions.onReview && <button type="button" className="secondary" onClick={actions.onReview}><Search size={16} aria-hidden="true" /> 게임 리뷰</button>}
          {actions.addFriend && (
            <button type="button" className="secondary" disabled={actions.addFriend.sent} onClick={actions.addFriend.onClick} aria-label={actions.addFriend.sent ? `${actions.addFriend.name} 님에게 친구 요청 보냄` : `${actions.addFriend.name} 님 친구 추가`}>
              {actions.addFriend.sent ? <Check size={16} aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />} {actions.addFriend.sent ? "요청 보냄" : "친구 추가"}
            </button>
          )}
          {actions.onShare && <button type="button" className="secondary" onClick={actions.onShare}><Share2 size={16} aria-hidden="true" /> 공유</button>}
          {actions.onHome && <button type="button" className="secondary" onClick={actions.onHome}><Home size={16} aria-hidden="true" /> {actions.homeLabel ?? "홈으로"}</button>}
        </div>
      </section>
    </dialog>
  </>;
}

function ResultHeader({ id, summary }: { id: string; summary: ResultSummary }) {
  const { outcome, drama } = summary;
  const icon = outcome.tone === "win" ? <Trophy size={30} aria-hidden="true" /> : outcome.kind === "rank" ? <Medal size={28} aria-hidden="true" /> : null;
  return (
    <header className="a3-result-head">
      {icon && <span className="a3-result-icon">{icon}</span>}
      {drama && drama !== "close" && <p className="a3-drama-ribbon">{drama === "grand-comeback" ? "대역전승" : drama === "comeback" ? "역전승" : "마지막 차례 역전"}</p>}
      <h2 id={id}>{outcome.title}</h2>
      {outcome.subtitle && <p className="a3-result-sub">{outcome.subtitle}</p>}
    </header>
  );
}

function Standings({ summary, avatars, animate, solo }: { summary: ResultSummary; avatars: Record<string, ReactNode>; animate: boolean; solo: boolean }) {
  const rows = summary.standings;
  return (
    <ol className={"a3-standings" + (solo ? " solo" : rows.length > 2 ? " field" : " duel")} aria-label={solo ? "최종 점수" : "최종 순위"}>
      {rows.map((row) => (
        <li key={row.seat.id} className={(row.you ? "you " : "") + (row.winner ? "winner" : "")}>
          {!solo && <span className="a3-rank" aria-label={`${row.rank}위`}>{row.rank}</span>}
          <span className="a3-avatar" aria-hidden="true">{avatars[row.seat.id] ?? <i>{[...row.seat.name][0] ?? "?"}</i>}</span>
          <span className="a3-name">
            <b>{row.seat.name}{row.you && <small className="a3-you"> · 나</small>}</b>
            {row.seat.title && <small className="a3-title">{row.seat.title}</small>}
            {row.seat.forfeited && <small className="a3-forfeit">기권</small>}
          </span>
          <Score value={row.total} animate={animate && row.you} />
        </li>
      ))}
    </ol>
  );
}
function Score({ value, animate }: { value: number; animate: boolean }) {
  const shown = useCountUp(value, animate);
  return <span className="a3-score"><span aria-hidden="true">{shown}</span><span className="sr-only">{value}점</span><small aria-hidden="true">점</small></span>;
}

function Meta({ summary }: { summary: ResultSummary }) {
  if (!summary.duration) return null;
  return <p className="a3-meta"><Clock size={14} aria-hidden="true" /> 경기 시간 {summary.duration}</p>;
}

function Rewards({ view }: { view: ReturnType<typeof rewardView> }) {
  if (view.kind === "hidden") return null;
  if (view.kind === "note") return <p className="a3-reward-note" data-tone={view.tone} role="status">{view.text}</p>;
  const done = view.quests.filter((q) => q.done && q.previous < q.count);
  const moving = view.quests.filter((q) => !(q.done && q.previous < q.count) && q.progress > q.previous);
  const nothing = view.coins === 0 && view.gems === 0 && !done.length && !view.grants.length && !moving.length;
  return (
    <section className="a3-rewards" aria-label="이번 경기 보상">
      {nothing ? <p className="a3-reward-note" data-tone="info">이번 경기로 지급된 보상이 없어요.</p> : (
        <>
          {(view.coins > 0 || view.gems > 0) && (
            <p className="a3-wallet">
              {view.coins > 0 && <span><Coins size={16} aria-hidden="true" /> +{view.coins.toLocaleString()}코인</span>}
              {view.gems > 0 && <span><Gem size={16} aria-hidden="true" /> +{view.gems.toLocaleString()}보석</span>}
              <small>잔액 {view.balance.coins.toLocaleString()}코인 · {view.balance.gems.toLocaleString()}보석</small>
            </p>
          )}
          {(done.length > 0 || view.grants.length > 0) && (
            <ul className="a3-done" aria-label="완료한 퀘스트와 업적">
              {done.map((q) => <li key={q.id}><Check size={14} aria-hidden="true" /> {q.period === "daily" ? "일일" : "주간"} 퀘스트 · {q.label}</li>)}
              {view.grants.map((g) => (
                <li key={g.label}><Award size={14} aria-hidden="true" /> {g.kind === "achievement" ? "업적" : "퀘스트 묶음"} · {g.label}{g.coins > 0 ? ` +${g.coins}코인` : ""}{g.gems > 0 ? ` +${g.gems}보석` : ""}</li>
              ))}
            </ul>
          )}
          {moving.length > 0 && (
            <ul className="a3-progress" aria-label="퀘스트 진행">
              {moving.map((q) => (
                <li key={q.id}>
                  <span>{q.label}</span>
                  <span className="a3-bar" role="progressbar" aria-label={q.label} aria-valuemin={0} aria-valuemax={q.count} aria-valuenow={q.progress}><i style={{ width: `${Math.min(100, (100 * q.progress) / q.count)}%` }} /></span>
                  <small>{q.progress}/{q.count}</small>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** CSS만으로 그리는 짧은 축하 조각(재생 후 사라짐). 저감 모션에서는 그리지 않는다. */
function Burst({ grand, lite }: { grand: boolean; lite: boolean }) {
  const n = lite ? 10 : grand ? 36 : 22;
  return (
    <div className={"a3-burst" + (grand ? " grand" : "")} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <i key={i} style={{ "--a": `${(360 * i) / n}deg`, "--d": `${(i % 5) * 40}ms`, "--r": `${90 + ((i * 37) % 70)}px` } as CSSProperties} />)}
    </div>
  );
}
