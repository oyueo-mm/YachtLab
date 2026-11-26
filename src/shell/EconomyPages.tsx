import ShopRail from "./ShopRail";
import DrawPanel, { DrawOdds } from "./DrawPanel";
import { SEASONS, seasonActive } from "../economy/live/seasons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Coins, Gem, RefreshCw, Sparkles, X } from "lucide-react";
import { ACHIEVEMENTS, ECONOMY, QUESTS, SLOTS, TIERS, nextDayStart, nextWeekStart, type TierId } from "../economy/live/config";
import { CATEGORIES, DEFAULT_LOADOUT, ITEMS, SINGLE_SLOTS, itemById, priceOf, publicLook, slotPrice, upgradeCost, type ItemCategory, type ItemDef, type Loadout } from "../economy/live/catalog";
import { EconomyError, buy, buySlot, economy, rerollQuest, saveLoadout, signedIn, upgrade, type Snapshot } from "../identity/economy-client";
import { PlayerTag } from "../play/Looks";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { BrandMark } from "../ui/BrandLoading";
import { motionLevel, useSettings } from "../settings";
import { useNickname } from "../identity/display-name";
import { ItemStage, ItemThumb, LevelTabs, categoryLabel, tierLabel } from "./ItemViews";
import type { Route } from "../routes";
import "./shop-browse.css";
import { signInAvailable, startSignIn } from "../identity/account-client";
import { clearResume, peekResume, saveResume, type ShopResume } from "./login-resume";

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
  return { snap, error, busy, act, load, setSnap };
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

/**
 * Shown only when a guest tries something that changes their items (buy, draw, upgrade, equip).
 * Browsing, previews and odds never ask. `resume` is the view to come back to after signing in.
 */
export function LoginPrompt({ server, action, resume, onClose, go }: { server: string | null; action: string; resume: Omit<ShopResume, "at">; onClose: () => void; go: Go }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    let alive = true;
    void signInAvailable(server).then((ok) => alive && setAvailable(ok));
    return () => {
      alive = false;
    };
  }, [server]);
  const signIn = async () => {
    if (!server) return;
    saveResume(resume);
    try {
      await startSignIn(server);
    } catch (e) {
      clearResume();
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <dialog ref={dialog} className="modal login-prompt" aria-labelledby="login-prompt-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id="login-prompt-title">{action}하려면 로그인이 필요해요</h2>
      <p>코인·보석과 아이템은 계정에 저장돼요. 로그인한 뒤 이 화면으로 돌아오고, 최신 가격과 잔액을 확인한 다음 다시 한 번 확인을 눌러야 구매돼요.</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="login-prompt-actions">
        {available ? (
          <button type="button" className="primary" onClick={() => void signIn()}>Google로 로그인</button>
        ) : (
          <button type="button" className="primary" onClick={() => { onClose(); go("account"); }} disabled={available === null}>
            {available === null ? "확인 중…" : "로그인 화면으로"}
          </button>
        )}
        <button type="button" className="secondary" onClick={onClose}>계속 둘러보기</button>
      </div>
    </dialog>
  );
}

const ownedMap = (snap: Snapshot | null) => new Map((snap?.inventory ?? []).map((i) => [i.id, i.level]));
const fmt = (n: number) => n.toLocaleString();
const saleDate = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
type Owned = ReadonlyMap<string, number>;
const isOwned = (i: ItemDef, owned: Owned) => i.acquisition === "default" || owned.has(i.id);

/** Card in a grid: the item's look, name, tier and price / state. Tapping opens the detail. */
function ItemCard({ item, owned, level, badge, price, equipped, action, onOpen }: { item: ItemDef; owned: boolean; level: number; badge?: string; price?: React.ReactNode; equipped?: boolean; action?: React.ReactNode; onOpen: () => void }) {
  return (
    <li className={"item-card tier-" + item.tier + (owned ? " owned" : "") + (equipped ? " equipped" : "")} data-item={item.id}>
      <button type="button" className="item-card-button" onClick={onOpen} aria-label={`${item.name} 자세히`}>
        <ItemThumb item={item} level={level} />
        <span className="item-card-name">{item.name}</span>
        <span className="item-preview-label">효과 미리보기</span>
        <span className="item-card-meta">
          <span className={"tier-chip tier-" + item.tier}>{tierLabel(item.tier)}</span>
          {item.season && <span className="lv-chip">시즌</span>}
          {item.maxLevel > 1 && <span className="lv-chip">Lv.{owned ? level : 1}/{item.maxLevel}</span>}
        </span>
        {badge ? <span className="item-card-badge">{badge}</span> : price}
      </button>
      {action}
    </li>
  );
}

/** Category tabs shared by the shop and the inventory. */
function CategoryTabs({ value, onChange, counts, all }: { value: ItemCategory | null; onChange: (c: ItemCategory) => void; counts?: Partial<Record<ItemCategory, number>>; all?: () => void }) {
  return (
    <div className="item-tabs" role="tablist" aria-label="상품군">
      {all && <button type="button" role="tab" aria-selected={value === null} className={value === null ? "active" : ""} onClick={all}>둘러보기</button>}
      {CATEGORIES.map((c) => (
        <button key={c.id} type="button" role="tab" aria-selected={value === c.id} className={value === c.id ? "active" : ""} onClick={() => onChange(c.id)}>
          {c.label}
          {counts?.[c.id] !== undefined && <small>{counts[c.id]}</small>}
        </button>
      ))}
    </div>
  );
}

const stageDescriptions = {
  board: ["정적 표면", "움직이는 조명", "굴림·킵·족보 반응"],
  emote: ["기본 이모티콘", "애니메이션", "강화 애니메이션과 빛"],
} as const;

/** The detail sheet: large real preview (level tabs), facts, and the action buttons given by the page. */
function ItemDetail({ item, initialLevel, unlocked, onClose, children }: { item: ItemDef; initialLevel: number; unlocked?: number; onClose: () => void; children: (previewLevel: number) => React.ReactNode }) {
  const [level, setLevel] = useState(initialLevel);
  const season = item.season && SEASONS[item.season];
  const descriptions = item.category === "board" || item.category === "emote" ? stageDescriptions[item.category] : item.levels;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const surface = dialog.current;
    const previous = document.activeElement;
    surface?.showModal();
    return () => {
      surface?.close();
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={dialog} className="modal item-detail" aria-label={`${item.name} 상세`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
        <div className="item-detail-head">
          <div>
            <h2>{item.name}</h2>
            <p>
              <span className={"tier-chip tier-" + item.tier}>{tierLabel(item.tier)}</span> {categoryLabel(item.category)}
              {item.family ? ` · ${item.family}` : ""}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {season && <p className="item-level-note">{season.name} · {saleDate.format(season.start)} ~ {saleDate.format(season.end)} (한국 시간). 시즌 이후에도 소유 상품을 쓸 수 있어요.</p>}
        <ItemStage item={item} level={level} />
        <LevelTabs item={item} level={level} setLevel={setLevel} unlocked={unlocked} />
        {descriptions && <p className="item-level-note">Lv.{level} · {descriptions[level - 1]}</p>}
        <div className="item-detail-actions">{children(level)}</div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ shop ------------------------------------------------------------------ */

type PriceFilter = "all" | "coins" | "gems" | "afford";

type EconomyState = ReturnType<typeof useEconomy>;
type EconomyProps = { server: string | null; go: Go; economyState: EconomyState; active: boolean };

export function ItemsPage({ server, go, route }: { server: string | null; go: Go; route: "shop" | "inventory" | "draw" }) {
  const economyState = useEconomy(server);
  const motion = motionLevel(useSettings());
  return <section className="econ-page items-hub" data-preview-motion={motion === "full" ? "full" : "static"} aria-labelledby="items-title">
    <h1 id="items-title">상점과 인벤토리</h1>
    <div className="item-tabs" role="tablist" aria-label="상품 관리">
      <button type="button" role="tab" aria-selected={route === "shop"} onClick={() => route !== "shop" && go("shop")}>상품</button>
      <button type="button" role="tab" aria-selected={route === "draw"} onClick={() => route !== "draw" && go("draw")}>뽑기</button>
      <button type="button" role="tab" aria-selected={route === "inventory"} onClick={() => route !== "inventory" && go("inventory")}>인벤토리</button>
    </div>
    <ShopPage server={server} go={go} economyState={economyState} active={route === "shop"} />
    {route === "draw" && (server && signedIn()
      ? <DrawPanel server={server} onWallet={economyState.setSnap} />
      : <GuestDraw server={server} go={go} />)}
    <InventoryPage server={server} go={go} economyState={economyState} active={route === "inventory"} />
  </section>;
}

/** Guests: the odds are public; drawing asks to sign in (the view comes back afterwards). */
function GuestDraw({ server, go }: { server: string | null; go: Go }) {
  const [ask, setAsk] = useState(false);
  return (
    <div role="tabpanel" aria-label="뽑기 확률">
      <DrawOdds pool="standard" />
      <p className="login-prompt-actions">
        <button type="button" className="primary" onClick={() => setAsk(true)}>뽑기</button>
      </p>
      {ask && <LoginPrompt server={server} action="뽑기" resume={{ route: "draw", cat: null, tier: "all", price: "all", item: null, scrollY: window.scrollY }} go={go} onClose={() => setAsk(false)} />}
    </div>
  );
}

function ShopPage({ server, go, economyState, active }: EconomyProps) {
  const { snap, error, busy, act } = economyState;
  const [cat, setCat] = useState<ItemCategory | null>(null);
  const [tier, setTier] = useState<TierId | "all">("all");
  const [price, setPrice] = useState<PriceFilter>("all");
  const [open, setOpen] = useState<ItemDef | null>(null);
  const [confirm, setConfirm] = useState<{ item: ItemDef; currency: "coins" | "gems"; amount: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [askLogin, setAskLogin] = useState<string | null>(null);
  const member = !!server && signedIn();
  const owned = ownedMap(snap);
  const wallet = snap?.wallet ?? { coins: 0, gems: 0 };
  // Guests see the catalogue too (seasons by this device's clock until the server's time is known).
  const now = snap?.serverTime ?? Date.now();
  const forSale = ITEMS.filter((i) => !i.retired && i.acquisition !== "default" && (!i.season || seasonActive(i.season, now)));
  // Back from sign-in: the same tab, filters, item and scroll position — never an automatic purchase.
  useEffect(() => {
    if (!active || !member || !snap) return;
    const resume = peekResume();
    if (!resume || resume.route !== "shop") return;
    clearResume();
    setCat((resume.cat as ItemCategory | null) ?? null);
    setTier(resume.tier as TierId | "all");
    setPrice(resume.price as PriceFilter);
    const item = itemById(resume.item);
    if (item) setOpen(item);
    requestAnimationFrame(() => window.scrollTo(0, resume.scrollY));
  }, [active, member, snap]);
  const resumeState = (item: ItemDef | null) => ({ route: "shop" as const, cat, tier, price, item: item?.id ?? null, scrollY: window.scrollY });
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, forSale.filter((i) => i.category === c.id).length])) as Record<ItemCategory, number>;
  const list = forSale.filter((i) => {
    if ((cat && i.category !== cat) || (tier !== "all" && i.tier !== tier)) return false;
    const c = priceOf(i, "coins"),
      g = priceOf(i, "gems");
    if (price === "coins") return c !== null;
    if (price === "gems") return g !== null;
    if (price === "afford") return !owned.has(i.id) && ((c !== null && c <= wallet.coins) || (g !== null && g <= wallet.gems));
    return true;
  });
  const tierOrder = (item: ItemDef) => TIERS.findIndex((entry) => entry.id === item.tier);
  const ordered = list.slice().sort((a, b) => tierOrder(a) - tierOrder(b));
  const group = (category: ItemCategory) => ordered.filter((item) => item.category === category);
  const purchase = async (i: ItemDef, currency: "coins" | "gems") => {
    const r = await act(() => buy(server!, i.id, currency), `${i.name}을(를) 샀어요. 인벤토리에서 장착할 수 있어요.`);
    if (r) setNotice(r);
  };
  const priceLine = (i: ItemDef) => {
    if (owned.has(i.id)) return null;
    if (i.acquisition === "achievement") return <span className="item-card-price">업적 보상</span>;
    const c = priceOf(i, "coins"),
      g = priceOf(i, "gems");
    return (
      <span className="item-card-price">
        {c !== null && (
          <span className={member && c > wallet.coins ? "short" : ""}>
            <Coins size={12} /> {fmt(c)}
          </span>
        )}
        {g !== null && (
          <span className={member && g > wallet.gems ? "short" : ""}>
            <Gem size={12} /> {fmt(g)}
          </span>
        )}
      </span>
    );
  };
  const cards = (items: ItemDef[]) => items.map((item) => (
    <ItemCard key={item.id} item={item} owned={owned.has(item.id)} level={owned.get(item.id) ?? 1} badge={owned.has(item.id) ? "보유 중" : undefined} price={priceLine(item)} onOpen={() => setOpen(item)} />
  ));
  if (!active) return null;
  return (
    <section className="shop-page" role="tabpanel" aria-label="상품">
        {!member && <p className="econ-note shop-guest-note">둘러보기와 미리보기는 로그인 없이 할 수 있어요. 구매·뽑기·강화·장착은 로그인 후 이용할 수 있어요.</p>}
        <CategoryTabs value={cat} onChange={setCat} counts={counts} all={() => setCat(null)} />
        <div className="econ-filters">
          <select aria-label="등급" value={tier} onChange={(e) => setTier(e.target.value as TierId | "all")}>
            <option value="all">전체 등급</option>
            {TIERS.filter((t) => t.id !== "basic").map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select aria-label="가격" value={price} onChange={(e) => setPrice(e.target.value as PriceFilter)}>
            <option value="all">모든 가격</option>
            <option value="coins">코인으로 살 수 있는 것</option>
            <option value="gems">보석으로 살 수 있는 것</option>
            {member && <option value="afford">지금 살 수 있는 것</option>}
          </select>
        </div>
        {busy && <p className="econ-note" role="status"><BrandMark /> 처리 중…</p>}
        {notice && <p className="econ-ok" role="status">{notice}</p>}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {ordered.length === 0 && <p className="econ-note">조건에 맞는 상품이 없어요.</p>}
        {CATEGORIES.map(({ id, label }) => {
          const items = group(id);
          if (!items.length) return null;
          return (
            <section className="shop-section" aria-labelledby={`shop-section-${id}`} key={id}>
              <h2 id={`shop-section-${id}`}>{label}</h2>
              {cat === id ? <ul className="item-grid" aria-label={label + " 상품"}>{cards(items)}</ul> : <>
                <button type="button" className="text-button shop-view-all" onClick={() => setCat(id)}>{label} 전체 보기</button>
                <ShopRail label={label}>{cards(items)}</ShopRail>
              </>}
            </section>
          );
        })}
        <h2 className="econ-sub">장착 슬롯 확장</h2>
        <Gate server={server} go={go}>
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
                    <button type="button" className="secondary" disabled={busy || !snap || wallet.coins < c} onClick={() => void act(() => buySlot(server!, kind, "coins"))} aria-label={`${kind === "emote" ? "이모티콘" : "채팅"} 슬롯 코인 구매`}>
                      <Coins size={14} /> {fmt(c)}
                    </button>
                    <button type="button" className="secondary" disabled={busy || !snap || wallet.gems < (g ?? Infinity)} onClick={() => void act(() => buySlot(server!, kind, "gems"))} aria-label={`${kind === "emote" ? "이모티콘" : "채팅"} 슬롯 보석 구매`}>
                      <Gem size={14} /> {g}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        </Gate>
      {askLogin && <LoginPrompt server={server} action={askLogin} resume={resumeState(open)} go={go} onClose={() => setAskLogin(null)} />}
      {active && open && (
        <ItemDetail item={open} initialLevel={1} onClose={() => setOpen(null)}>
          {() => {
            const i = open;
            if (owned.has(i.id))
              return (
                <>
                  <span className="shop-owned">
                    <Check size={14} /> 보유 중 (Lv.{owned.get(i.id)})
                  </span>
                  <button type="button" className="secondary" onClick={() => go("inventory")}>
                    인벤토리에서 장착
                  </button>
                </>
              );
            if (i.acquisition === "achievement") return <span className="shop-owned">업적으로만 얻을 수 있어요</span>;
            const c = priceOf(i, "coins"),
              g = priceOf(i, "gems");
            if (!member)
              return (
                <>
                  {c !== null && <button type="button" className="primary" onClick={() => setAskLogin("구매")} aria-label={`${i.name} 코인 ${c}으로 구매`}><Coins size={15} /> {fmt(c)} 코인으로 구매</button>}
                  {g !== null && <button type="button" className="secondary" onClick={() => setAskLogin("구매")} aria-label={`${i.name} 보석 ${g}으로 구매`}><Gem size={15} /> {fmt(g)} 보석으로 구매</button>}
                </>
              );
            return (
              <>
                {c !== null && (
                  <button type="button" className="primary" disabled={busy || !snap || wallet.coins < c} onClick={() => setConfirm({ item: i, currency: "coins", amount: c })} aria-label={`${i.name} 코인 ${c}으로 구매`}>
                    <Coins size={15} /> {fmt(c)} 코인으로 구매
                  </button>
                )}
                {g !== null && (
                  <button type="button" className="secondary" disabled={busy || !snap || wallet.gems < g} onClick={() => setConfirm({ item: i, currency: "gems", amount: g })} aria-label={`${i.name} 보석 ${g}으로 구매`}>
                    <Gem size={15} /> {fmt(g)} 보석으로 구매
                  </button>
                )}
                <button type="button" className="text-button" onClick={() => {
                  setCat(i.category);
                  setTier(i.tier);
                  setPrice("all");
                  setOpen(null);
                  window.scrollTo(0, 0);
                }}>같은 등급 상품 보기</button>
                {((c !== null && wallet.coins < c) || c === null) && (g === null || wallet.gems < g) && <small className="item-short">재화가 부족해요. 미리보기는 그대로 볼 수 있어요.</small>}
              </>
            );
          }}
        </ItemDetail>
      )}
      <ConfirmDialog
        open={active && !!confirm}
        title="구매할까요?"
        message={confirm ? `${confirm.item.name} · ${confirm.currency === "coins" ? "코인" : "보석"} ${fmt(confirm.amount)}개를 써요.` : ""}
        confirmLabel="구매"
        cancelLabel="취소"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void purchase(c.item, c.currency);
        }}
      />
    </section>
  );
}

/* ---------------------------------------------------------------- inventory ---------------------------------------------------------------- */

function InventoryPage({ server, go, economyState, active }: EconomyProps) {
  const { snap, error, busy, act } = economyState;
  const [changes, setChanges] = useState<Loadout | null>(null);
  const draft = changes ?? snap?.loadout ?? null;
  const [saved, setSaved] = useState("");
  const [cat, setCat] = useState<ItemCategory>("dice");
  const [open, setOpen] = useState<ItemDef | null>(null);
  const [confirmUp, setConfirmUp] = useState<{ item: ItemDef; cost: number; to: number } | null>(null);
  const name = useNickname();

  const owned = ownedMap(snap);
  const mine = ITEMS.filter((i) => !i.retired && isOwned(i, owned));
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, mine.filter((i) => i.category === c.id).length])) as Record<ItemCategory, number>;
  const dirty = !!snap && !!draft && JSON.stringify(draft) !== JSON.stringify(snap.loadout);
  const save = async () => {
    if (!draft) return;
    const r = await act(() => saveLoadout(server!, draft), "장착을 저장했어요. 다음 경기부터 상대에게 보여요.");
    if (r) { setChanges((current) => current === draft ? null : current); setSaved(r); }
  };
  const isEquipped = (i: ItemDef) => {
    if (!draft) return false;
    if (i.category === "emote") return draft.emotes.includes(i.id);
    if (i.category === "chat") return draft.chats.includes(i.id);
    return draft[i.category as (typeof SINGLE_SLOTS)[number]] === i.id;
  };
  const toggle = (i: ItemDef) =>
    setChanges((current) => {
      const d = current ?? draft;
      if (!d || !snap) return d;
      if (i.category === "emote" || i.category === "chat") {
        const key = i.category === "emote" ? "emotes" : "chats";
        const cap = snap.slots[i.category];
        const list = d[key];
        if (list.includes(i.id)) return list.length > 1 ? { ...d, [key]: list.filter((x) => x !== i.id) } : d;
        return list.length < cap ? { ...d, [key]: [...list, i.id] } : d;
      }
      const slot = i.category as (typeof SINGLE_SLOTS)[number];
      // a single slot cannot be empty: unequipping returns it to the free default item
      if (d[slot] === i.id) return { ...d, [slot]: DEFAULT_LOADOUT[slot] };
      return { ...d, [slot]: i.id };
    });
  const move = (key: "emotes" | "chats", i: number, step: -1 | 1) =>
    setChanges((current) => {
      const d = current ?? draft;
      if (!d) return d;
      const list = [...d[key]];
      const j = i + step;
      if (j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, [key]: list };
    });
  const shownLevel = (i: ItemDef) => (draft?.levels[i.id] ?? owned.get(i.id) ?? 1);
  const listKind = cat === "emote" || cat === "chat" ? cat : null;
  if (!active) return null;
  return (
    <section className="inventory-page" role="tabpanel" aria-label="인벤토리">
      <Gate server={server} go={go}>
        {!snap || !draft ? (
          <p className="econ-note" role="status">
            <BrandMark /> 불러오는 중…
          </p>
        ) : (
          <>
            <div className="loadout-preview" aria-label="장착 미리보기">
              <div className="loadout-card">
                <PlayerTag name={name} look={publicLook(draft, owned)} me />
                <span className="loadout-pieces">
                  <ItemThumb item={itemById(draft.dice)!} level={shownLevel(itemById(draft.dice)!)} />
                  <ItemThumb item={itemById(draft.board)!} level={shownLevel(itemById(draft.board)!)} />
                  <span className="loadout-emotes">{draft.emotes.map((id) => itemById(id)?.look.text).join(" ")}</span>
                </span>
              </div>
              <div className="loadout-save">
                <button type="button" className="primary econ-save" disabled={busy || !dirty} onClick={() => void save()}>
                  장착 저장
                </button>
                <small>{dirty ? "저장하지 않은 변경이 있어요" : "저장된 장착"}</small>
              </div>
            </div>
            {busy && <p className="econ-note" role="status"><BrandMark /> 저장 중…</p>}
            {saved && <p className="econ-ok" role="status">{saved}</p>}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <CategoryTabs value={cat} onChange={setCat} counts={counts} />
            {listKind && (
              <div className="inv-order-box">
                <strong>
                  {listKind === "emote" ? "이모티콘" : "채팅"} 장착 {draft[listKind === "emote" ? "emotes" : "chats"].length}/{snap.slots[listKind]}
                </strong>
                <ol className="inv-order" aria-label={`${listKind === "emote" ? "이모티콘" : "채팅"} 순서`}>
                  {draft[listKind === "emote" ? "emotes" : "chats"].map((id, n, list) => (
                    <li key={id}>
                      <span>{itemById(id)?.look.text}</span>
                      <button type="button" className="icon-button" aria-label="앞으로" disabled={n === 0} onClick={() => move(listKind === "emote" ? "emotes" : "chats", n, -1)}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" className="icon-button" aria-label="뒤로" disabled={n === list.length - 1} onClick={() => move(listKind === "emote" ? "emotes" : "chats", n, 1)}>
                        <ArrowDown size={14} />
                      </button>
                    </li>
                  ))}
                </ol>
                {snap.slots[listKind] < SLOTS[listKind].max && (
                  <button type="button" className="text-button" onClick={() => go("shop")}>
                    슬롯 늘리기 (상점)
                  </button>
                )}
              </div>
            )}
            <ul className="item-grid" aria-label="보유 아이템">
              {mine
                .filter((i) => i.category === cat)
                .map((i) => (
                  <ItemCard key={i.id} item={i} owned equipped={isEquipped(i)} level={shownLevel(i)} onOpen={() => setOpen(i)}
                    action={<button type="button" className={"item-equip " + (isEquipped(i) ? "primary" : "secondary")}
                      aria-pressed={isEquipped(i)} aria-label={`${i.name} ${isEquipped(i) ? (listKind ? "해제" : "장착됨") : "장착"}`} onClick={() => toggle(i)}>
                      {isEquipped(i) ? (listKind ? "해제" : "장착 중") : "장착"}
                    </button>} />
                ))}
            </ul>
          </>
        )}
      </Gate>
      {active && open && snap && draft && (
        <ItemDetail item={open} initialLevel={shownLevel(open)} unlocked={owned.get(open.id) ?? 1} onClose={() => setOpen(null)}>
          {(previewLevel) => {
            const i = open;
            const have = owned.get(i.id) ?? 1;
            const cost = upgradeCost(i, have);
            const pickable = previewLevel <= have;
            return (
              <>
                <button type="button" className={isEquipped(i) ? "secondary" : "primary"} onClick={() => toggle(i)}>
                  {isEquipped(i) ? "장착 해제" : "장착"}
                </button>
                {i.maxLevel > 1 && (
                  <button type="button" className="secondary" disabled={!pickable || shownLevel(i) === previewLevel} onClick={() => setChanges({ ...draft, levels: { ...draft.levels, [i.id]: previewLevel } })}>
                    {pickable ? `Lv.${previewLevel} 모습으로 표시` : `Lv.${previewLevel}은 강화 후 사용`}
                  </button>
                )}
                {cost !== null && (
                  <button type="button" className="secondary" disabled={busy || snap.wallet.coins < cost} onClick={() => setConfirmUp({ item: i, cost, to: have + 1 })} aria-label={`${i.name} Lv.${have + 1} 강화`}>
                    <Sparkles size={15} /> Lv.{have + 1} 강화 · <Coins size={13} /> {fmt(cost)}
                  </button>
                )}
                <small className="item-short">장착·단계 변경은 &lsquo;장착 저장&rsquo;을 눌러야 다음 경기에 적용돼요.</small>
              </>
            );
          }}
        </ItemDetail>
      )}
      <ConfirmDialog
        open={active && !!confirmUp}
        title="강화할까요?"
        message={confirmUp ? `${confirmUp.item.name}을(를) Lv.${confirmUp.to}로 강화해요 · 코인 ${fmt(confirmUp.cost)}개` : ""}
        confirmLabel="강화"
        cancelLabel="취소"
        onCancel={() => setConfirmUp(null)}
        onConfirm={() => {
          const c = confirmUp;
          setConfirmUp(null);
          if (c) void act(() => upgrade(server!, c.item.id), `${c.item.name} Lv.${c.to} 강화 완료`).then((r) => r && setSaved(r));
        }}
      />
    </section>
  );
}

/* ----------------------------------------------------------------- quests ----------------------------------------------------------------- */

const until = (t: number) => {
  const m = Math.max(0, Math.round((t - Date.now()) / 60_000));
  return m >= 1440 ? `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
};

export function QuestsPage({ server, go, achievements }: { server: string | null; go: Go; achievements: boolean }) {
  const [period, setPeriod] = useState<"daily" | "weekly">("daily");
  const [replace, setReplace] = useState<{ period: "daily" | "weekly"; expected: number } | null>(null);
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
          <button type="button" className="secondary" disabled={busy} onClick={() => void act(() => rerollQuest(server!, i, "daily", snap!.state.day))} aria-label={`${def.label} 교체`}>
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
      </div>
      <div className="item-tabs" role="tablist" aria-label="퀘스트 종류">
        <button type="button" role="tab" aria-selected={!achievements && period === "daily"} onClick={() => { setPeriod("daily"); if (achievements) go("quests"); }}>일일</button>
        <button type="button" role="tab" aria-selected={!achievements && period === "weekly"} onClick={() => { setPeriod("weekly"); if (achievements) go("quests"); }}>주간</button>
        <button type="button" role="tab" aria-selected={achievements} onClick={() => !achievements && go("achievements")}>업적</button>
      </div>
      <Gate server={server} go={go}>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {!snap ? (
          <p className="econ-note" role="status">
            <BrandMark /> 불러오는 중…
          </p>
        ) : (
          <>
            {achievements ? <AchievementsPanel snap={snap} /> : <div role="tabpanel" aria-label={period === "daily" ? "일일" : "주간"}>
              <h2 className="econ-sub">
                {period === "daily" ? "일일 퀘스트" : "주간 퀘스트"} <small>{until(period === "daily" ? nextDayStart(Date.now()) : nextWeekStart(Date.now()))} 뒤 초기화 · {period === "daily" ? "매일" : "매주 월요일"} 00:00(한국 시간)</small>
              </h2>
              <ul className="quest-list">{snap.state[period].map((q, i) => row(q, i, period))}</ul>
              {snap.state.weeklyRerolls !== undefined && snap.state[period].some((quest) => !quest.done) &&
                (period === "daily" ? snap.state.rerolls < ECONOMY.quests.dailyRerolls : snap.state.weeklyRerolls === 0) &&
                <button type="button" className="secondary" disabled={busy} onClick={() => setReplace({
                  period, expected: period === "daily" ? snap.state.day : snap.state.week,
                })}><RefreshCw size={15} /> 미완료 퀘스트 전체 교체</button>}
              <p className="econ-note">{period === "daily" ? "일일은 개별 또는 전체 교체 중 하루 한 번 무료로 선택할 수 있어요." : "주간 미완료 퀘스트는 주에 한 번 함께 무료로 교체할 수 있어요."}</p>
              <p className="econ-note">
                모두 완료하면 {period === "daily" ? ECONOMY.quests.dailyAllBonus.coins : ECONOMY.quests.weeklyAllBonus.coins}코인·보석 {period === "daily" ? ECONOMY.quests.dailyAllBonus.gems : ECONOMY.quests.weeklyAllBonus.gems} {snap.state[period === "daily" ? "dailyAll" : "weeklyAll"] ? "(받음)" : ""}
              </p>
            </div>}
            <p className="econ-note">빠른 대전·친구 대전·서버 AI 대전을 끝까지 마친 경기만 진행돼요. 로컬 AI·로컬 대전·본인 기권은 포함되지 않아요.</p>
            {!achievements && <details className="economy-ledger">
            <summary>최근 재화 내역</summary>
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
            </details>}
          </>
        )}
      </Gate>
      <ConfirmDialog open={!!replace} title="미완료 퀘스트를 모두 바꿀까요?"
        message="완료한 퀘스트와 받은 보상은 그대로예요. 교체되는 퀘스트는 처음부터 진행해요."
        confirmLabel="전체 교체" cancelLabel="취소" onCancel={() => setReplace(null)} onConfirm={() => {
          if (replace) void act(() => rerollQuest(server!, "all", replace.period, replace.expected));
          setReplace(null);
        }} />
    </section>
  );
}

/* -------------------------------------------------------------- achievements -------------------------------------------------------------- */

function AchievementsPanel({ snap }: { snap: Snapshot }) {
  const got = new Set(snap?.state.achievements ?? []);
  const groups: [string, string][] = [
    ["cumulative", "누적"],
    ["skill", "실력"],
    ["luck", "행운"],
    ["collection", "수집·장기"],
    ["special", "숨김 도전"],
  ];
  return (
    <div role="tabpanel" aria-label="업적">
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
    </div>
  );
}
