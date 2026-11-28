import { useEffect, useMemo, useRef, useState } from "react";
import { Award, Dices, Flame, LayoutGrid, Medal, Pin, Sparkles, Trophy, X } from "lucide-react";
import { ITEMS, itemById, type ItemCategory, type PublicLook } from "../economy/live/catalog";
import { achievementById } from "../economy/live/config";
import { SEASONS } from "../economy/live/seasons";
import { COLLECTIONS, collectionProgress } from "../economy/live/collections";
import type { Snapshot } from "../identity/economy-client";
import type { MatchRecord, Stats } from "../identity/records";
import { SOLO_BUCKETS } from "../solo/records";
import { Distribution, Trend } from "../play/SoloStats";

/**
 * Game-profile sections (2026-11-27). Every number comes from stored records or the server snapshot;
 * a figure that was never recorded is shown as "—" / an empty state, never estimated.
 */
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 1000) / 10}`);
const date = (t: number) => new Date(t).toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric" });
const outcomeText = { win: "승", loss: "패", draw: "무" } as const;

export function VersusSummary({ stats, records, server }: { stats: Stats; records: MatchRecord[]; server: boolean }) {
  const verified = records.filter((r) => r.verification === "server-verified").length;
  const distribution = useMemo(() => SOLO_BUCKETS.map((b) => ({ label: b.label, count: records.filter((r) => r.score >= b.from && r.score <= b.to).length })), [records]);
  return (
    <section className="profile-card profile-versus" aria-label="대전 전적">
      <h2><Trophy size={17} aria-hidden="true" /> 대전 전적</h2>
      {stats.games === 0 ? (
        <p className="profile-empty">아직 완료한 대전이 없어요. 온라인이나 AI 대전을 끝내면 승률과 최고 점수가 여기에 쌓여요.</p>
      ) : (
        <>
          <dl className="profile-kpis">
            <div><dt>경기</dt><dd>{stats.games}</dd></div>
            <div><dt>승 · 무 · 패</dt><dd className="wdl">{stats.wins}<small>·</small>{stats.draws}<small>·</small>{stats.losses}</dd></div>
            <div><dt>승률</dt><dd>{pct(stats.winRate)}<small>%</small></dd></div>
            <div><dt>최고 점수</dt><dd>{stats.best ?? "—"}</dd></div>
            <div><dt>평균 점수</dt><dd>{stats.average === null ? "—" : stats.average.toFixed(1)}</dd></div>
            <div><dt>요트 달성</dt><dd>{stats.yachts}<small>경기</small></dd></div>
            <div><dt>상단 보너스</dt><dd>{pct(stats.games ? stats.bonuses / stats.games : null)}<small>%</small></dd></div>
          </dl>
          <p className="profile-fine">승률은 무승부를 0.5승으로 계산해요. {server ? `서버가 기록한 온라인 경기 ${verified}개와 기기에서 기록한 경기 ${stats.games - verified}개를 합친 값이에요.` : "이 기기에서 기록한 경기예요."}</p>
          <div className="profile-split">
            <div>
              <h3>최근 점수</h3>
              <Trend points={[...records].sort((a, b) => a.endedAt - b.endedAt).slice(-30).map((r) => ({ score: r.score, at: r.endedAt }))} best={stats.best} />
            </div>
            <div>
              <h3>점수 분포</h3>
              <Distribution rows={distribution} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function RecentMatches({ records }: { records: MatchRecord[] }) {
  const recent = [...records].sort((a, b) => b.endedAt - a.endedAt).slice(0, 5);
  return (
    <section className="profile-card profile-latest" aria-label="최근 경기">
      <h2><Dices size={17} aria-hidden="true" /> 최근 경기</h2>
      {recent.length === 0 ? <p className="profile-empty">최근 경기가 없어요.</p> : (
        <ol className="profile-matches">
          {recent.map((r) => (
            <li key={r.recordId} className={"result-" + r.outcome}>
              <strong className="profile-outcome" aria-label={outcomeText[r.outcome] === "승" ? "승리" : outcomeText[r.outcome] === "패" ? "패배" : "무승부"}>{outcomeText[r.outcome]}</strong>
              <span className="profile-match-main">
                <span className="profile-score-line"><b>{r.score}</b><i>:</i><b>{r.opponent.score}</b> <small>vs {r.opponent.name}</small></span>
                <small>{r.mode === "online" ? (r.field ? `${r.field.players}인 온라인 · ${r.field.rank}위` : "온라인") : `AI${r.aiLevel ? " · " + r.aiLevel : ""}`} · {date(r.endedAt)} · {r.verification === "server-verified" ? "서버 기록" : "기기 기록"}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
      <a className="text-button" href="#records">전체 기록과 게임 리뷰 보기</a>
    </section>
  );
}

/** Quick-match win streak: the server already counts it for its 5/10-win achievements (current and best). */
export function StreakFacts({ snapshot }: { snapshot: Snapshot | null }) {
  if (!snapshot) return null;
  const best = snapshot.state.counters?.streak ?? 0;
  return (
    <p className="profile-streak"><Flame size={15} aria-hidden="true" /> 빠른 대전 연승 · 현재 <b>{snapshot.state.streak}</b> · 최고 <b>{best}</b></p>
  );
}

const PIN_KEY = "yachtlab.profile-pins.v1";
const readPins = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
};
/**
 * 대표 업적 (up to 3). Stored on this device for now. `PinStore` is the seam for the server-side version
 * (contract candidate: docs/context/A4-CONTRACT-CANDIDATES-2026-11-27.md): a server store only has to
 * implement `load`/`save`; the editor below does not change.
 */
export type PinStore = { load(): string[]; save(ids: string[]): void };
export const localPinStore: PinStore = {
  load: readPins,
  save: (ids) => {
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  },
};
export const MAX_PINS = 3;
/**
 * SOC-1: the server copy (`GET|PUT /api/me/profile/pins`) when signed in to a Worker that has it. The
 * server checks "earned", duplicates and the limit, and is the value every device sees; this device's
 * copy is only the first paint / the fallback for an older Worker (404) or no connection.
 */
export type RemotePins = { load(): Promise<string[]>; save(ids: string[]): Promise<string[]> };
export function usePinnedAchievements(earned: string[], store: PinStore = localPinStore, remote?: RemotePins | null) {
  const [pins, setPins] = useState(store.load);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(remote);
  live.current = remote;
  useEffect(() => {
    if (!remote) return void setSynced(false);
    let alive = true;
    remote
      .load()
      .then((ids) => {
        if (!alive) return;
        setPins(ids);
        store.save(ids);
        setSynced(true);
      })
      .catch(() => alive && setSynced(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!remote]);
  const valid = pins.filter((id) => earned.includes(id));
  const toggle = (id: string) => {
    const next = valid.includes(id) ? valid.filter((x) => x !== id) : [...valid, id].slice(-MAX_PINS);
    const before = valid;
    setPins(next);
    store.save(next);
    setError("");
    if (live.current && synced)
      live.current.save(next).then(
        (saved) => (setPins(saved), store.save(saved)),
        (e: Error) => (setPins(before), store.save(before), setError(e.message || "대표 업적을 저장하지 못했어요.")),
      );
  };
  return { pins: valid, toggle, synced, error };
}

/** Three fixed slots + the achievements to choose from; "미리보기" shows what the header will say. */
export function Achievements({ earned, pins, toggle, synced = false, error = "" }: { earned: string[]; pins: string[]; toggle: (id: string) => void; synced?: boolean; error?: string }) {
  const list = earned.map((id) => achievementById(id)).filter((a): a is NonNullable<typeof a> => !!a);
  return (
    <section className="profile-card profile-achievements" aria-label="업적">
      <h2><Award size={17} aria-hidden="true" /> 업적 <small>{list.length}개 달성</small></h2>
      {list.length === 0 ? <p className="profile-empty">달성한 업적이 아직 없어요. 로그인 후 온라인 경기에서 달성돼요.</p> : (
        <>
          <h3>대표 업적 <small className="profile-fine">{pins.length}/{MAX_PINS} · {synced ? "계정에 저장돼요 · 프로필에 표시" : "이 기기에 저장돼요"}</small></h3>
          {error && <p className="error-message" role="alert">{error}</p>}
          <ol className="pin-slots" aria-label="대표 업적 슬롯">
            {Array.from({ length: MAX_PINS }, (_, i) => {
              const a = pins[i] ? achievementById(pins[i]) : null;
              return (
                <li key={i} className={a ? "filled" : "empty"}>
                  {a ? (
                    <button type="button" onClick={() => toggle(a.id)} aria-label={`${a.label} 대표 해제`}><Pin size={13} aria-hidden="true" /> <span>{a.label}</span><X size={13} aria-hidden="true" /></button>
                  ) : <span>비어 있음</span>}
                </li>
              );
            })}
          </ol>
          <h3>달성한 업적에서 고르기</h3>
          <ul className="profile-badges">
            {list.map((a) => (
              <li key={a.id}>
                <button type="button" className={"profile-badge" + (pins.includes(a.id) ? " pinned" : "")} aria-pressed={pins.includes(a.id)} onClick={() => toggle(a.id)}>
                  <Medal size={14} aria-hidden="true" /> {a.label} {pins.includes(a.id) && <Pin size={12} aria-label="대표" />}
                </button>
              </li>
            ))}
          </ul>
          <p className="profile-fine">고른 업적은 이 화면의 프로필 위쪽에 보여요. 다른 사람에게 보이게 하는 기능은 서버 저장이 필요해 준비 중이에요.</p>
        </>
      )}
    </section>
  );
}

const SLOT_LABEL: Partial<Record<ItemCategory, string>> = { dice: "주사위", board: "보드판", bubble: "말풍선", profile: "프로필", nameFx: "닉네임 효과", fx: "특수 연출", title: "칭호" };
const COLLECT: ItemCategory[] = ["dice", "board", "emote", "bubble", "profile", "nameFx", "fx", "title"];
const CATEGORY_LABEL: Record<ItemCategory, string> = { dice: "주사위", board: "보드판", emote: "이모티콘", chat: "채팅", bubble: "말풍선", profile: "프로필", nameFx: "닉네임", fx: "특수 연출", title: "칭호" };

export function EquippedLooks({ look, signedIn }: { look: PublicLook; signedIn: boolean }) {
  const lvOf = (slot: string) => (look as Record<string, unknown>)[slot + "Lv"] as number | undefined;
  const slots = (Object.keys(SLOT_LABEL) as ItemCategory[]).map((slot) => {
    const id = (look as Record<string, unknown>)[slot] as string;
    const item = itemById(id);
    return { slot, name: item?.name ?? "기본", lv: lvOf(slot) ?? 1, max: item?.maxLevel ?? 1, basic: !item || item.acquisition === "default", tier: item?.tier };
  });
  return (
    <section className="profile-card profile-equipped" aria-label="장착 중인 꾸미기">
      <h2><Sparkles size={17} aria-hidden="true" /> 장착 중</h2>
      <dl className="profile-slots">
        {slots.map((s) => (
          <div key={s.slot} className={(s.basic ? "basic " : "") + (s.tier ? "tier-" + s.tier : "")}>
            <dt>{SLOT_LABEL[s.slot]}</dt>
            <dd>
              <span className="slot-name">{s.name}</span>
              {s.max > 1 && (
                <span className="lv-pips" role="img" aria-label={`강화 ${s.lv}단계 / 최대 ${s.max}단계`}>
                  {Array.from({ length: s.max }, (_, i) => <i key={i} className={i < s.lv ? "on" : ""} />)}<small>Lv.{s.lv}</small>
                </span>
              )}
            </dd>
          </div>
        ))}
        <div>
          <dt>이모티콘</dt>
          <dd>{look.emotes.map((e) => itemById(e.id)?.look.text ?? "").join(" ") || "—"}</dd>
        </div>
      </dl>
      <a className="text-button" href={signedIn ? "#inventory" : "#shop"}>{signedIn ? "인벤토리에서 바꾸기" : "상점 둘러보기"}</a>
    </section>
  );
}

export function CollectionProgress({ snapshot }: { snapshot: Snapshot | null }) {
  const owned = new Set(snapshot?.inventory.map((i) => i.id) ?? []);
  const rows = COLLECT.map((cat) => {
    const all = ITEMS.filter((i) => i.category === cat && i.acquisition !== "default" && !i.retired);
    return { cat, total: all.length, have: all.filter((i) => owned.has(i.id)).length };
  });
  const seasonal = ITEMS.filter((i) => i.season && owned.has(i.id));
  const total = rows.reduce((a, r) => a + r.total, 0), have = rows.reduce((a, r) => a + r.have, 0);
  const upgraded = (snapshot?.inventory ?? []).filter((i) => i.level > 1).length;
  const maxed = (snapshot?.inventory ?? []).filter((i) => { const it = itemById(i.id); return !!it && it.maxLevel > 1 && i.level >= it.maxLevel; }).length;
  return (
    <section className="profile-card profile-collection" aria-label="수집 현황">
      <h2><LayoutGrid size={17} aria-hidden="true" /> 수집 현황 <small>{snapshot ? `${have} / ${total}` : "로그인 필요"}</small></h2>
      {!snapshot ? <p className="profile-empty">로그인하면 보유한 꾸미기 아이템과 수집률이 보여요.</p> : (
        <>
          <p className="profile-own-summary" aria-label="보유 요약">
            <span><b>{snapshot.inventory.length}</b>개 보유</span>
            <span><b>{upgraded}</b>개 강화</span>
            <span><b>{maxed}</b>개 최대 강화</span>
          </p>
          <ul className="profile-collect">
            {rows.map((r) => (
              <li key={r.cat}>
                <span>{CATEGORY_LABEL[r.cat]}</span>
                <span className="profile-collect-bar" role="img" aria-label={`${CATEGORY_LABEL[r.cat]} ${r.have}/${r.total}`}><i style={{ width: `${r.total ? (r.have / r.total) * 100 : 0}%` }} /></span>
                <span className="profile-collect-n">{r.have}/{r.total}</span>
              </li>
            ))}
          </ul>
          <h3>테마 컬렉션</h3>
          <ul className="profile-themes">
            {COLLECTIONS.map((c) => {
              const p = collectionProgress(c, owned);
              return (
                <li key={c.id} className={p.have === p.total ? "complete" : p.have ? "" : "empty"} style={{ "--col": c.color } as React.CSSProperties} title={c.synergy}>
                  <span>{c.name}</span>
                  <small>{p.have}/{p.total}{p.synergyReady ? " · 시너지" : ""}</small>
                </li>
              );
            })}
          </ul>
          {seasonal.length > 0 && (
            <p className="profile-limited"><b>기간 한정</b> {seasonal.map((i) => `${i.name}${i.season ? ` (${SEASONS[i.season].name})` : ""}`).join(", ")}</p>
          )}
        </>
      )}
    </section>
  );
}
