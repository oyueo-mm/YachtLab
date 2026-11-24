import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Coins, Gem, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { ACHIEVEMENTS, ECONOMY, QUESTS, SLOTS, TIERS, nextDayStart, nextWeekStart, type TierId } from "../economy/live/config";
import { CATEGORIES, DEFAULT_ITEM_IDS, ITEMS, SINGLE_SLOTS, itemById, priceOf, publicLook, slotPrice, upgradeCost, type ItemCategory, type ItemDef, type Loadout } from "../economy/live/catalog";
import { EconomyError, buy, buySlot, economy, rerollQuest, saveLoadout, signedIn, upgrade, type Snapshot } from "../identity/economy-client";
import { PlayerTag } from "../play/Looks";
import type { Route } from "../routes";

/**
 * Phase 5/6 pages: 상점 (shop), 인벤토리 (inventory / equip / upgrade), 퀘스트, 업적. Separate pages,
 * the same quiet page layout as the profile. Everything shown comes from the server snapshot.
 */
type Go = (r: Route) => void;

function useEconomy(server: string | null) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (!server || !signedIn()) return;
    economy(server)
      .then((s) => (setSnap(s), setError("")))
      .catch((e: Error) => setError(e.message));
  }, [server]);
  useEffect(load, [load]);
  /** Run one server action; the new snapshot replaces the old one. */
  const act = async (fn: () => Promise<Snapshot>, ok?: string) => {
    setBusy(true);
    setError("");
    try {
      setSnap(await fn());
      return ok ?? "";
    } catch (e) {
      setError(e instanceof EconomyError ? e.message : String(e));
      if (e instanceof EconomyError && e.code !== "NETWORK") load();
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { snap, error, busy, act, load };
}

function Gate({ server, go, children }: { server: string | null; go: Go; children: React.ReactNode }) {
  if (!server)
    return <p className="econ-note">온라인 서버에 연결되어 있지 않아요.</p>;
  if (!signedIn())
    return (
      <div className="econ-gate">
        <p>코인·보석·퀘스트·업적·아이템은 로그인한 회원의 서버 검증 경기로만 쌓여요.</p>
        <button type="button" className="primary" onClick={() => go("profile")}>
          프로필에서 로그인하기
        </button>
      </div>
    );
  return <>{children}</>;
}

export function WalletBar({ snap }: { snap: Snapshot | null }) {
  return (
    <div className="wallet-bar" aria-label="보유 재화">
      <span>
        <Coins size={15} /> <strong data-testid="coins">{snap ? snap.wallet.coins.toLocaleString() : "–"}</strong> 코인
      </span>
      <span>
        <Gem size={15} /> <strong data-testid="gems">{snap ? snap.wallet.gems.toLocaleString() : "–"}</strong> 보석
      </span>
    </div>
  );
}

const tierLabel = (t: TierId) => TIERS.find((x) => x.id === t)?.label ?? t;
const ownedMap = (snap: Snapshot | null) => new Map((snap?.inventory ?? []).map((i) => [i.id, i.level]));

/** A small, honest preview of an item (exactly what other players will see). */
export function ItemPreview({ item, level = 1 }: { item: ItemDef; level?: number }) {
  const l = item.look;
  if (l.dice)
    return (
      <span className="item-preview dice-swatch" style={{ background: l.dice.face, color: l.dice.pip, borderColor: l.dice.edge }} aria-hidden="true">
        ⚃
      </span>
    );
  if (l.board !== undefined) return <span className="item-preview board-swatch" style={{ background: l.board || "var(--tray)" }} aria-hidden="true" />;
  if (item.category === "nameFx")
    return (
      <span className="item-preview">
        <span className={`player-name ${l.css ?? ""} fx-lv${level}`}>닉네임</span>
      </span>
    );
  if (item.category === "bubble")
    return (
      <span className={`item-preview bubble-swatch chip-bubble static ${l.css ?? ""}`} style={{ position: "static", animation: "none" }}>
        안녕하세요!
      </span>
    );
  if (item.category === "emote")
    return (
      <span className={`item-preview emote-swatch emote-lv${level}`} aria-hidden="true">
        {l.text}
      </span>
    );
  if (item.category === "fx") return <span className="item-preview">{l.css ? <Sparkles size={18} /> : "–"}</span>;
  return <span className="item-preview">{l.text || "–"}</span>;
}

/* ------------------------------------------------------------------ shop ------------------------------------------------------------------ */

export function ShopPage({ server, go }: { server: string | null; go: Go }) {
  const { snap, error, busy, act } = useEconomy(server);
  const [cat, setCat] = useState<ItemCategory | "all">("all");
  const [tier, setTier] = useState<TierId | "all">("all");
  const [notice, setNotice] = useState("");
  const owned = ownedMap(snap);
  const list = ITEMS.filter((i) => !i.retired && i.acquisition !== "default" && (cat === "all" || i.category === cat) && (tier === "all" || i.tier === tier));
  const purchase = async (i: ItemDef, currency: "coins" | "gems") => {
    const r = await act(() => buy(server!, i.id, currency), `${i.name}을(를) 샀어요. 인벤토리에서 장착할 수 있어요.`);
    if (r) setNotice(r);
  };
  return (
    <section className="econ-page" aria-labelledby="shop-title">
      <div className="econ-head">
        <h1 id="shop-title">상점</h1>
        <WalletBar snap={snap} />
      </div>
      <Gate server={server} go={go}>
        <div className="econ-filters">
          <select aria-label="상품군" value={cat} onChange={(e) => setCat(e.target.value as ItemCategory | "all")}>
            <option value="all">전체 상품군</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select aria-label="등급" value={tier} onChange={(e) => setTier(e.target.value as TierId | "all")}>
            <option value="all">전체 등급</option>
            {TIERS.filter((t) => t.id !== "basic").map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {notice && <p className="econ-ok" role="status">{notice}</p>}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <ul className="shop-grid" aria-label="상품">
          {list.map((i) => {
            const has = owned.has(i.id);
            const coins = priceOf(i, "coins");
            const gems = priceOf(i, "gems");
            return (
              <li key={i.id} className={"shop-item tier-" + i.tier} data-item={i.id}>
                <ItemPreview item={i} level={i.maxLevel} />
                <span className="shop-name">
                  <strong>{i.name}</strong>
                  <small>
                    {tierLabel(i.tier)} · {CATEGORIES.find((c) => c.id === i.category)?.label}
                    {i.maxLevel > 1 ? ` · 최대 Lv.${i.maxLevel}` : ""}
                  </small>
                  {i.levels && <small className="shop-levels">{i.levels.map((d, n) => `Lv.${n + 1} ${d}`).join(" · ")}</small>}
                </span>
                <span className="shop-buy">
                  {has ? (
                    <span className="shop-owned">
                      <Check size={14} /> 보유 중
                    </span>
                  ) : i.acquisition === "achievement" ? (
                    <span className="shop-owned">업적 보상</span>
                  ) : (
                    <>
                      {coins !== null && (
                        <button type="button" className="secondary" disabled={busy || !snap || snap.wallet.coins < coins} onClick={() => void purchase(i, "coins")} aria-label={`${i.name} 코인 ${coins}으로 구매`}>
                          <Coins size={14} /> {coins.toLocaleString()}
                        </button>
                      )}
                      {gems !== null && (
                        <button type="button" className="secondary" disabled={busy || !snap || snap.wallet.gems < gems} onClick={() => void purchase(i, "gems")} aria-label={`${i.name} 보석 ${gems}으로 구매`}>
                          <Gem size={14} /> {gems.toLocaleString()}
                        </button>
                      )}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <h2 className="econ-sub">장착 슬롯 확장</h2>
        <div className="slot-shop">
          {(["emote", "chat"] as const).map((kind) => {
            const have = snap?.slots[kind] ?? SLOTS[kind].base;
            const c = slotPrice(kind, have, "coins");
            const g = slotPrice(kind, have, "gems");
            return (
              <div key={kind} className="slot-row">
                <span>
                  <strong>{kind === "emote" ? "이모티콘" : "채팅"} 슬롯</strong> {have} / {SLOTS[kind].max}
                </span>
                {c === null ? (
                  <span className="shop-owned">최대</span>
                ) : (
                  <span className="shop-buy">
                    <button type="button" className="secondary" disabled={busy || !snap || snap.wallet.coins < c} onClick={() => void act(() => buySlot(server!, kind, "coins"))} aria-label={`${kind === "emote" ? "이모티콘" : "채팅"} 슬롯 코인 구매`}>
                      <Coins size={14} /> {c.toLocaleString()}
                    </button>
                    <button type="button" className="secondary" disabled={busy || !snap || snap.wallet.gems < (g ?? Infinity)} onClick={() => void act(() => buySlot(server!, kind, "gems"))} aria-label={`${kind === "emote" ? "이모티콘" : "채팅"} 슬롯 보석 구매`}>
                      <Gem size={14} /> {g}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Gate>
    </section>
  );
}

/* ---------------------------------------------------------------- inventory ---------------------------------------------------------------- */

export function InventoryPage({ server, go }: { server: string | null; go: Go }) {
  const { snap, error, busy, act } = useEconomy(server);
  const [draft, setDraft] = useState<Loadout | null>(null);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (snap) setDraft(snap.loadout);
  }, [snap]);
  const owned = ownedMap(snap);
  const has = (id: string) => DEFAULT_ITEM_IDS.includes(id) || owned.has(id);
  const mine = ITEMS.filter((i) => !i.retired && has(i.id));
  const save = async () => {
    if (!draft) return;
    const r = await act(() => saveLoadout(server!, draft), "장착을 저장했어요. 다음 경기부터 상대에게 보여요.");
    if (r) setSaved(r);
  };
  const toggleList = (key: "emotes" | "chats", id: string, cap: number) =>
    setDraft((d) => {
      if (!d) return d;
      const list = d[key];
      if (list.includes(id)) return list.length > 1 ? { ...d, [key]: list.filter((x) => x !== id) } : d;
      return list.length < cap ? { ...d, [key]: [...list, id] } : d;
    });
  const move = (key: "emotes" | "chats", i: number, step: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const list = [...d[key]];
      const j = i + step;
      if (j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, [key]: list };
    });
  return (
    <section className="econ-page" aria-labelledby="inv-title">
      <div className="econ-head">
        <h1 id="inv-title">인벤토리</h1>
        <WalletBar snap={snap} />
      </div>
      <Gate server={server} go={go}>
        {!snap || !draft ? (
          <p className="econ-note" role="status">
            <LoaderCircle size={15} className="spin" /> 불러오는 중…
          </p>
        ) : (
          <>
            <div className="loadout-preview" aria-label="장착 미리보기">
              <PlayerTag name="내 닉네임" look={publicLook(draft, owned)} me />
              <ItemPreview item={itemById(draft.dice)!} />
              <span className="loadout-emotes">{draft.emotes.map((id) => itemById(id)?.look.text).join(" ")}</span>
            </div>
            {saved && <p className="econ-ok" role="status">{saved}</p>}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            {SINGLE_SLOTS.map((slot) => (
              <fieldset key={slot} className="inv-group">
                <legend>{CATEGORIES.find((c) => c.id === slot)?.label}</legend>
                <div className="inv-items">
                  {mine
                    .filter((i) => i.category === slot)
                    .map((i) => (
                      <InvItem key={i.id} item={i} level={owned.get(i.id) ?? 1} selectedLevel={draft.levels[i.id]} equipped={draft[slot] === i.id} busy={busy} onEquip={() => setDraft({ ...draft, [slot]: i.id })} onLevel={(lv) => setDraft({ ...draft, levels: { ...draft.levels, [i.id]: lv } })} onUpgrade={() => act(() => upgrade(server!, i.id))} coins={snap.wallet.coins} />
                    ))}
                </div>
              </fieldset>
            ))}
            {(["emote", "chat"] as const).map((kind) => {
              const key = kind === "emote" ? "emotes" : "chats";
              const cap = snap.slots[kind];
              return (
                <fieldset key={kind} className="inv-group">
                  <legend>
                    {kind === "emote" ? "이모티콘" : "채팅"} 장착 {draft[key].length}/{cap}
                  </legend>
                  <ol className="inv-order" aria-label={`${kind === "emote" ? "이모티콘" : "채팅"} 순서`}>
                    {draft[key].map((id, n) => (
                      <li key={id}>
                        <span>{itemById(id)?.look.text}</span>
                        <button type="button" className="icon-button" aria-label="앞으로" disabled={n === 0} onClick={() => move(key, n, -1)}>
                          <ArrowUp size={14} />
                        </button>
                        <button type="button" className="icon-button" aria-label="뒤로" disabled={n === draft[key].length - 1} onClick={() => move(key, n, 1)}>
                          <ArrowDown size={14} />
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="inv-items">
                    {mine
                      .filter((i) => i.category === kind)
                      .map((i) => (
                        <InvItem key={i.id} item={i} level={owned.get(i.id) ?? 1} selectedLevel={draft.levels[i.id]} equipped={draft[key].includes(i.id)} busy={busy} onEquip={() => toggleList(key, i.id, cap)} onLevel={(lv) => setDraft({ ...draft, levels: { ...draft.levels, [i.id]: lv } })} onUpgrade={() => act(() => upgrade(server!, i.id))} coins={snap.wallet.coins} multi />
                      ))}
                  </div>
                </fieldset>
              );
            })}
            <button type="button" className="primary econ-save" disabled={busy} onClick={() => void save()}>
              장착 저장
            </button>
          </>
        )}
      </Gate>
    </section>
  );
}

function InvItem(p: { item: ItemDef; level: number; selectedLevel?: number; equipped: boolean; busy: boolean; multi?: boolean; coins: number; onEquip: () => void; onLevel: (lv: number) => void; onUpgrade: () => void }) {
  const cost = upgradeCost(p.item, p.level);
  const shown = p.selectedLevel ?? p.level;
  return (
    <div className={"inv-item" + (p.equipped ? " equipped" : "")} data-item={p.item.id}>
      <ItemPreview item={p.item} level={shown} />
      <span className="inv-name">
        {p.item.name}
        {p.item.maxLevel > 1 && <small> Lv.{p.level}/{p.item.maxLevel}</small>}
      </span>
      <button type="button" className={p.equipped ? "primary" : "secondary"} aria-pressed={p.equipped} aria-label={`${p.item.name} ${p.equipped ? (p.multi ? "해제" : "장착됨") : "장착"}`} onClick={p.onEquip}>
        {p.equipped ? (p.multi ? "해제" : "장착됨") : "장착"}
      </button>
      {p.level > 1 && (
        <select aria-label={`${p.item.name} 표시 단계`} value={shown} onChange={(e) => p.onLevel(Number(e.target.value))}>
          {Array.from({ length: p.level }, (_, i) => (
            <option key={i} value={i + 1}>
              Lv.{i + 1}
            </option>
          ))}
        </select>
      )}
      {cost !== null && (
        <button type="button" className="secondary" disabled={p.busy || p.coins < cost} onClick={p.onUpgrade} aria-label={`${p.item.name} Lv.${p.level + 1} 강화`}>
          강화 <Coins size={13} /> {cost.toLocaleString()}
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- quests ----------------------------------------------------------------- */

const until = (t: number) => {
  const m = Math.max(0, Math.round((t - Date.now()) / 60_000));
  return m >= 1440 ? `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
};

export function QuestsPage({ server, go }: { server: string | null; go: Go }) {
  const { snap, error, busy, act } = useEconomy(server);
  const row = (q: { id: string; progress: number; done: boolean }, i: number, period: "daily" | "weekly") => {
    const def = QUESTS.find((d) => d.id === q.id);
    if (!def) return null;
    const coins = period === "daily" ? ECONOMY.quests.dailyCoins[i] : ECONOMY.quests.weeklyCoins[i];
    const gems = period === "daily" ? ECONOMY.quests.dailyGems[i] : ECONOMY.quests.weeklyGems[i];
    return (
      <li key={q.id} className={"quest" + (q.done ? " done" : "")}>
        <span className="quest-diff">{["쉬움", "보통", "어려움"][def.difficulty]}</span>
        <span className="quest-label">
          <strong>{def.label}</strong>
          <span className="quest-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (q.progress / def.count) * 100)}%` }} />
          </span>
          <small>
            {q.progress}/{def.count} · {coins}코인{gems ? ` · 보석 ${gems}` : ""}
          </small>
        </span>
        {q.done ? (
          <span className="shop-owned">
            <Check size={14} /> 받음
          </span>
        ) : period === "daily" && (snap?.state.rerolls ?? 1) < ECONOMY.quests.dailyRerolls ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => void act(() => rerollQuest(server!, i))} aria-label={`${def.label} 교체`}>
            <RefreshCw size={14} /> 교체
          </button>
        ) : null}
      </li>
    );
  };
  return (
    <section className="econ-page" aria-labelledby="quest-title">
      <div className="econ-head">
        <h1 id="quest-title">퀘스트</h1>
        <WalletBar snap={snap} />
      </div>
      <Gate server={server} go={go}>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {!snap ? (
          <p className="econ-note" role="status">
            <LoaderCircle size={15} className="spin" /> 불러오는 중…
          </p>
        ) : (
          <>
            <h2 className="econ-sub">
              일일 퀘스트 <small>{until(nextDayStart(Date.now()))} 뒤 초기화 · 매일 00:00(한국 시간)</small>
            </h2>
            <ul className="quest-list">{snap.state.daily.map((q, i) => row(q, i, "daily"))}</ul>
            <p className="econ-note">
              모두 완료하면 {ECONOMY.quests.dailyAllBonus.coins}코인·보석 {ECONOMY.quests.dailyAllBonus.gems} {snap.state.dailyAll ? "(받음)" : ""} · 하루 한 번 무료 교체
            </p>
            <h2 className="econ-sub">
              주간 퀘스트 <small>{until(nextWeekStart(Date.now()))} 뒤 초기화 · 매주 월요일 00:00</small>
            </h2>
            <ul className="quest-list">{snap.state.weekly.map((q, i) => row(q, i, "weekly"))}</ul>
            <p className="econ-note">
              모두 완료하면 {ECONOMY.quests.weeklyAllBonus.coins}코인·보석 {ECONOMY.quests.weeklyAllBonus.gems} {snap.state.weeklyAll ? "(받음)" : ""}
            </p>
            <p className="econ-note">빠른 대전·친구 대전·서버 AI 대전을 끝까지 마친 경기만 진행돼요. 로컬 AI·로컬 대전·본인 기권은 포함되지 않아요.</p>
            <h2 className="econ-sub">최근 받은 보상</h2>
            <ul className="ledger" aria-label="재화 내역">
              {snap.ledger.length === 0 && <li className="econ-note">아직 내역이 없어요.</li>}
              {snap.ledger.map((l) => (
                <li key={l.id}>
                  <span>{l.label}</span>
                  <span className={l.coins < 0 || l.gems < 0 ? "minus" : "plus"}>
                    {l.coins ? `${l.coins > 0 ? "+" : ""}${l.coins}코인` : ""} {l.gems ? `${l.gems > 0 ? "+" : ""}${l.gems}보석` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Gate>
    </section>
  );
}

/* -------------------------------------------------------------- achievements -------------------------------------------------------------- */

export function AchievementsPage({ server, go }: { server: string | null; go: Go }) {
  const { snap, error } = useEconomy(server);
  const got = new Set(snap?.state.achievements ?? []);
  const groups: [string, string][] = [
    ["cumulative", "누적"],
    ["skill", "실력"],
    ["luck", "행운"],
    ["collection", "수집·장기"],
    ["special", "숨김 도전"],
  ];
  return (
    <section className="econ-page" aria-labelledby="ach-title">
      <div className="econ-head">
        <h1 id="ach-title">업적</h1>
        <WalletBar snap={snap} />
      </div>
      <Gate server={server} go={go}>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <p className="econ-note">
          달성 {got.size} / {ACHIEVEMENTS.length} · 업적 진행은 하루 {ECONOMY.daily.achievementMatches}경기까지 집계해요.
        </p>
        {groups.map(([g, label]) => (
          <div key={g}>
            <h2 className="econ-sub">{label}</h2>
            <ul className="ach-list">
              {ACHIEVEMENTS.filter((a) => a.group === g).map((a) => {
                const done = got.has(a.id);
                const v = Math.min(a.count, snap?.state.counters[a.key] ?? 0);
                const hidden = a.hidden && !done;
                return (
                  <li key={a.id} className={done ? "done" : ""}>
                    <strong>{hidden ? "???" : a.label}</strong>
                    <small>
                      {hidden ? "숨겨진 업적" : a.key === "best" ? `최고 ${snap?.state.counters.best ?? 0}점` : `${v}/${a.count}`}
                      {" · "}
                      {a.coins ? `${a.coins}코인 · ` : ""}보석 {a.gems}
                      {a.item ? ` · 전용 칭호` : ""}
                    </small>
                    {done && <Check size={15} aria-label="달성" />}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Gate>
    </section>
  );
}
