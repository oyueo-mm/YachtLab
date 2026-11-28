import { useActivityDialog } from "./activity-visible";
import { Select } from "../ui/kit";
import ShopRail from "./ShopRail";
import DrawPanel, { DrawIntro, DrawOdds } from "./DrawPanel";
import { SEASONS, seasonActive, seasonUpcoming, remainingText } from "../economy/live/seasons";
import { COLLECTIONS, collectionProgress, collectionsOf, synergyOf } from "../economy/live/collections";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Backpack, Check, CircleHelp, Coins, Dices, Gem, RefreshCw, RotateCcw, Search, Sparkles, Store, Trash2, X } from "lucide-react";
import { Coach, useCoach, type CoachStep } from "../ui/Coach";
import { INVENTORY_STEPS, QUEST_STEPS, ACHIEVEMENT_STEPS } from "../ui/feature-guides";
import { DRAW_COST, DRAW_DAILY_LIMIT, DUPLICATE_COINS } from "../economy/live/draw";
import { ACHIEVEMENTS, ECONOMY, QUESTS, SLOTS, TIERS, nextDayStart, nextWeekStart, type TierId } from "../economy/live/config";
import { CATEGORIES, DEFAULT_LOADOUT, ITEMS, SINGLE_SLOTS, itemById, lookAt, priceOf, publicLook, sellableOn, slotPrice, upgradeCost, upgradeSupportedOn, type ItemCategory, type ItemDef, type Loadout } from "../economy/live/catalog";
import { EconomyError, buy, buySlot, economy, rerollQuest, saveLoadout, signedIn, upgrade, type Snapshot } from "../identity/economy-client";
import { PlayerTag, boardTheme } from "../play/Looks";
import { DieIcon } from "../Dice";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { BrandMark } from "../ui/BrandLoading";
import { motionLevel, useSettings } from "../settings";
import { useNickname } from "../identity/display-name";
import { DiceFace, ItemStage, ItemThumb, LevelTabs, categoryLabel, tierLabel } from "./ItemViews";
import { PromoCarousel } from "./shop/PromoCarousel";
import { EDITOR_PICKS, EMPTY_QUERY, PRICE_BANDS, SORTS, filterItems, isFiltered, matchesText, newItems, promoSlides, sortItems, themeProgress, type OwnFilter, type PriceFilter, type ShopQuery } from "./shop/curation";
import { MAX_PRESETS, accountOf, applyPreset, loadPresets, storePresets, type Preset } from "./shop/presets";
import "./shop/shop.css";
import type { Route } from "../routes";
import "./shop-browse.css";
import { session, signInAvailable, startSignIn } from "../identity/account-client";
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
  const load = useCallback(async (clearError = true) => {
    if (!server || !signedIn()) return;
    try {
      setSnap(await economy(server));
      if (clearError) setError("");
    } catch (error) {
      if (clearError) setError(error instanceof Error ? error.message : String(error));
    }
  }, [server]);
  useEffect(() => { void load(); }, [load]);
  /** Run one server action; the new snapshot replaces the old one. */
  const act = async (fn: () => Promise<Snapshot>, ok?: string) => {
    setBusy(true);
    setError("");
    try {
      setSnap(await fn());
      return ok ?? "";
    } catch (e) {
      setError(e instanceof EconomyError ? e.message : String(e));
      if (e instanceof EconomyError && e.code !== "NETWORK") await load(false);
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
  useActivityDialog(dialog);
  useEffect(() => {
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
const listKey = (c: ItemCategory) => (c === "emote" ? "emotes" : "chats") as "emotes" | "chats";
/** Is the item worn in this loadout? (emotes / chats: in the list; others: the single slot) */
function wears(loadout: Loadout | null | undefined, i: ItemDef) {
  if (!loadout) return false;
  if (i.category === "emote") return loadout.emotes.includes(i.id);
  if (i.category === "chat") return loadout.chats.includes(i.id);
  return loadout[i.category as (typeof SINGLE_SLOTS)[number]] === i.id;
}

/**
 * Card in a grid or rail. The look comes first (large static thumbnail — never a renderer); below it only
 * name, tier, level range and price / ownership. Tapping opens the detail with the live preview.
 */
function ItemCard({ item, owned, level, badge, price, equipped, action, onOpen, preparing = false }: { item: ItemDef; owned: boolean; level: number; badge?: string; price?: React.ReactNode; equipped?: boolean; action?: React.ReactNode; onOpen: () => void; preparing?: boolean }) {
  return (
    <li className={"item-card tier-" + item.tier + (owned ? " owned" : "") + (equipped ? " equipped" : "")} data-item={item.id}>
      <button type="button" className="item-card-button" onClick={onOpen} aria-label={`${item.name} 자세히`}>
        <span className="item-card-art">
          <ItemThumb item={item} level={level} size={76} />
          {equipped && <span className="item-card-flag">장착 중</span>}
          {!equipped && owned && item.acquisition !== "default" && <span className="item-card-flag owned"><Check size={11} aria-hidden="true" /> 보유</span>}
        </span>
        <span className="item-card-name">{item.name}</span>
        <span className="item-card-meta">
          <span className={"tier-chip tier-" + item.tier}>{tierLabel(item.tier)}</span>
          {item.season && <span className="lv-chip limited">기간 한정</span>}
          {preparing && <span className="lv-chip">준비 중</span>}
          {item.maxLevel > 1 && <span className="lv-chip">Lv.{owned ? level : 1}/{item.maxLevel}</span>}
        </span>
        {badge ? <span className="item-card-badge">{badge}</span> : price}
      </button>
      {action}
    </li>
  );
}

/** Category navigation shared by the shop (with 둘러보기) and the inventory: a vertical sidebar on wide screens, a swipeable chip row on phones. */
function CategoryTabs({ value, onChange, counts, all, label = "상품군" }: { value: ItemCategory | null; onChange: (c: ItemCategory) => void; counts?: Partial<Record<ItemCategory, number>>; all?: () => void; label?: string }) {
  const keys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = tabs[(at + step + tabs.length) % tabs.length];
    next.focus();
    next.click();
  };
  return (
    <div className="item-tabs cat-nav" role="tablist" aria-label={label} aria-orientation="vertical" onKeyDown={keys}>
      {all && <button type="button" role="tab" aria-selected={value === null} tabIndex={value === null ? 0 : -1} className={value === null ? "active" : ""} onClick={all}>둘러보기</button>}
      {CATEGORIES.map((c) => (
        <button key={c.id} type="button" role="tab" aria-selected={value === c.id} tabIndex={value === c.id || (!all && value === null) ? 0 : -1} className={value === c.id ? "active" : ""} onClick={() => onChange(c.id)}>
          {c.label}
          {counts?.[c.id] !== undefined && <small>{counts[c.id]}</small>}
        </button>
      ))}
    </div>
  );
}

/** Search box shared by the shop and the inventory (filters as you type; Esc clears). */
function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="shop-search">
      <Search size={16} aria-hidden="true" />
      <input type="search" value={value} placeholder={label} aria-label={label} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }} />
    </label>
  );
}

const stageDescriptions = {
  board: ["정적 표면", "움직이는 조명", "굴림·킵·족보 반응"],
  emote: ["기본 이모티콘", "애니메이션", "강화 애니메이션과 빛"],
} as const;

/**
 * The detail sheet: large live preview on the left (the one active stage), facts and actions on the right.
 * `status` says whether the player owns / wears the item. Nothing here buys, equips or upgrades by itself.
 */
function ItemDetail({ item, initialLevel, unlocked, onClose, children, status, now = Date.now() }: { item: ItemDef; initialLevel: number; unlocked?: number; onClose: () => void; children: (previewLevel: number) => React.ReactNode; status?: React.ReactNode; now?: number }) {
  const [level, setLevel] = useState(initialLevel);
  const season = item.season && SEASONS[item.season];
  const dialog = useRef<HTMLDialogElement>(null);
  useActivityDialog(dialog);
  return (
    <dialog ref={dialog} className="modal item-detail item-detail-v2" aria-label={`${item.name} 상세`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      // Esc closes the detail even if a close-watcher rule skips the native cancel event.
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); } }}
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
        <div className="item-detail-body">
          <div className="item-detail-stage">
            <ItemStage item={item} level={level} />
          </div>
          <div className="item-detail-info">
            {status && <p className="item-detail-status">{status}</p>}
            {season && <p className="item-level-note item-limited-note"><b>기간 한정</b> {season.name} · {saleDate.format(season.start)} ~ {saleDate.format(season.end)} (한국 시간){remainingText(item.season!, now)}. 판매가 끝나도 이미 가진 상품은 계속 쓸 수 있어요. {season.rerun}</p>}
            {collectionsOf(item.id).map((c) => <p key={c.id} className="item-level-note item-collection-note" style={{ "--col": c.color } as React.CSSProperties}><b>{c.name} 컬렉션</b> · 같은 컬렉션의 주사위와 보드판을 함께 장착하면 시너지 연출: {c.synergy}</p>)}
            <LevelTabs item={item} level={level} setLevel={setLevel} unlocked={unlocked} />
            {item.maxLevel > 1 && (item.category === "board" || item.category === "emote") && <p className="item-short">{stageDescriptions[item.category][level - 1]}</p>}
            <div className="item-detail-actions">{children(level)}</div>
          </div>
        </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ shop ------------------------------------------------------------------ */

type EconomyState = ReturnType<typeof useEconomy>;
type Intent = { collection?: string; item?: string } | null;
type EconomyProps = { server: string | null; go: Go; economyState: EconomyState; active: boolean; intent: Intent; clearIntent: () => void; onIntent: (route: "shop" | "inventory", intent: NonNullable<Intent>) => void };

/** Shop tour: currency, preview, upgrade levels, collections, buying and equipping. Looks only. */
const SHOP_STEPS = (member: boolean): CoachStep[] => [
  { target: member ? ".top-wallet" : ".shop-guest-note", title: "코인과 보석", body: "코인은 경기·퀘스트·업적으로, 보석은 업적과 주간 보상 등으로 모아요. 현금 결제는 없어요." + (member ? "" : " 둘러보기와 미리보기는 로그인 없이 할 수 있어요.") },
  { target: ".shop-page .item-card", title: "상품 미리보기", body: "카드를 누르면 실제 게임과 같은 화면으로 굴려 보고 들어 볼 수 있어요. 미리보기는 아무것도 사지 않아요." },
  { target: ".shop-page .item-card .lv-chip", title: "강화 단계 비교", body: "Lv.1→Lv.2→Lv.3으로 연출이 커져요. 상세 화면의 단계 탭으로 미리 비교하고, 강화는 원할 때만 코인으로 해요." },
  { target: ".econ-filters", title: "검색·필터·테마", body: "이름으로 찾고 등급·가격·테마·보유 여부로 좁혀 볼 수 있어요. 같은 테마의 주사위와 보드판을 함께 장착하면 시너지 연출이 켜져요." },
  { target: '.items-hub [role="tab"]:nth-child(3)', title: "구매 뒤 장착", body: "구매는 확인을 한 번 더 눌러야 진행돼요. 산 상품은 인벤토리에서 장착하고, 강화한 상품은 보여 줄 단계를 고를 수 있어요." },
];
/** Draw tour: cost, odds, duplicates, result. It explains; it never encourages repeated draws. */
const DRAW_STEPS = (member: boolean): CoachStep[] => [
  { target: member ? ".draw-controls" : ".draw-odds", title: "비용과 횟수", body: `한 번에 ${DRAW_COST}코인, 하루 ${DRAW_DAILY_LIMIT}회까지예요(매일 00:00 초기화). 뽑기 전에 확인 창이 한 번 더 나와요.` },
  { target: ".draw-odds", title: "족보로 정해지는 등급과 확률", body: "주사위 5개를 한 번 굴린 족보가 등급을 정해요. 7,776가지 조합 전체에서 계산한 족보별·등급별·상품별 확률을 여기서 모두 볼 수 있어요." },
  { target: member ? ".draw-panel .econ-note" : ".draw-odds", title: "중복 상품", body: `이미 가진 상품이 나오면 ${DUPLICATE_COINS}코인으로 돌려받아요. 같은 상품을 두 개 가질 수는 없어요.` },
  { target: member ? ".draw-panel .stage-board" : ".draw-odds", title: "결과 확인", body: "주사위가 멈추면 받은 상품과 족보가 표시되고 최근 뽑기 기록에 남아요. 서버가 결과를 정하고, 화면 연출은 결과를 보여 줄 뿐이에요." },
];

const HUB_TITLE = { shop: "상점", draw: "뽑기", inventory: "인벤토리" } as const;

export function ItemsPage({ server, go, route }: { server: string | null; go: Go; route: "shop" | "inventory" | "draw" }) {
  const economyState = useEconomy(server);
  const motion = motionLevel(useSettings());
  const member = !!server && signedIn();
  const shopTour = useCoach("shop", route === "shop");
  const drawTour = useCoach("draw", route === "draw");
  const inventoryTour = useCoach("inventory", route === "inventory" && member);
  const tour = route === "draw" ? drawTour : route === "inventory" ? inventoryTour : shopTour;
  // Cross-links between the shop and the inventory ("컬렉션 보기", "인벤토리에서 관리"): one pending intent.
  const [intent, setIntent] = useState<{ route: "shop" | "inventory"; value: NonNullable<Intent> } | null>(null);
  const onIntent = (to: "shop" | "inventory", value: NonNullable<Intent>) => {
    setIntent({ route: to, value });
    go(to);
  };
  const clearIntent = () => setIntent(null);
  return <section className={"econ-page items-hub hub-" + route} data-preview-motion={motion === "full" ? "full" : "static"} aria-labelledby="items-title">
    <div className="items-head">
      <h1 id="items-title">{HUB_TITLE[route]}</h1>
      <div className="item-tabs hub-tabs" role="tablist" aria-label="상품 관리">
        <button type="button" role="tab" aria-selected={route === "shop"} onClick={() => route !== "shop" && go("shop")}><Store size={15} aria-hidden="true" />상품</button>
        <button type="button" role="tab" aria-selected={route === "draw"} onClick={() => route !== "draw" && go("draw")}><Dices size={15} aria-hidden="true" />뽑기</button>
        <button type="button" role="tab" aria-selected={route === "inventory"} onClick={() => route !== "inventory" && go("inventory")}><Backpack size={15} aria-hidden="true" />인벤토리</button>
      </div>
      {(route !== "inventory" || member) && <button type="button" className="text-button items-help" onClick={tour.start}><CircleHelp size={16} /> {route === "draw" ? "뽑기 사용법" : route === "inventory" ? "인벤토리 사용법" : "상점 사용법"}</button>}
    </div>
    <Coach label="상점" steps={SHOP_STEPS(member)} open={route === "shop" && shopTour.open} onClose={shopTour.close} />
    <Coach label="뽑기" steps={DRAW_STEPS(member)} open={route === "draw" && drawTour.open} onClose={drawTour.close} />
    <Coach label="인벤토리" steps={INVENTORY_STEPS} open={route === "inventory" && inventoryTour.open} onClose={inventoryTour.close} />
    <ShopPage server={server} go={go} economyState={economyState} active={route === "shop"} intent={intent?.route === "shop" ? intent.value : null} clearIntent={clearIntent} onIntent={onIntent} />
    {route === "draw" && (server && signedIn()
      ? <DrawPanel server={server} onWallet={economyState.setSnap} />
      : <GuestDraw server={server} go={go} />)}
    <InventoryPage server={server} go={go} economyState={economyState} active={route === "inventory"} intent={intent?.route === "inventory" ? intent.value : null} clearIntent={clearIntent} onIntent={onIntent} />
  </section>;
}

/** Guests: the odds are public; drawing asks to sign in (the view comes back afterwards). */
function GuestDraw({ server, go }: { server: string | null; go: Go }) {
  const [ask, setAsk] = useState(false);
  return (
    <div className="draw-panel draw-guest" role="tabpanel" aria-label="뽑기 확률">
      <DrawIntro />
      <DrawOdds pool="standard" />
      <p className="login-prompt-actions">
        <button type="button" className="primary" onClick={() => setAsk(true)}>뽑기</button>
      </p>
      {ask && <LoginPrompt server={server} action="뽑기" resume={{ route: "draw", cat: null, tier: "all", price: "all", item: null, scrollY: window.scrollY }} go={go} onClose={() => setAsk(false)} />}
    </div>
  );
}

function ShopPage({ server, go, economyState, active, intent, clearIntent, onIntent }: EconomyProps) {
  const { snap, error, busy, act } = economyState;
  const [q, setQ] = useState<ShopQuery>(EMPTY_QUERY);
  const set = <K extends keyof ShopQuery>(key: K) => (value: ShopQuery[K]) => setQ((current) => ({ ...current, [key]: value }));
  const [open, setOpen] = useState<ItemDef | null>(null);
  const [confirm, setConfirm] = useState<{ item: ItemDef; currency: "coins" | "gems"; amount: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [askLogin, setAskLogin] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const member = !!server && signedIn();
  const owned = ownedMap(snap);
  const wallet = snap?.wallet ?? { coins: 0, gems: 0 };
  // Guests see the catalogue too (seasons by this device's clock until the server's time is known).
  const now = snap?.serverTime ?? Date.now();
  const forSale = useMemo(() => ITEMS.filter((i) => !i.retired && i.acquisition !== "default" && (!i.season || seasonActive(i.season, now))), [now]);
  const upcoming = ITEMS.filter((i) => !i.retired && i.season && seasonUpcoming(i.season, now));
  // Items of a newer catalog revision than the server's: preview only until the server sells them.
  const preparing = (i: ItemDef) => !sellableOn(i, snap?.catalogRev);
  // Back from sign-in: the same tab, filters, item and scroll position — never an automatic purchase.
  useEffect(() => {
    if (!active || !member || !snap) return;
    const resume = peekResume();
    if (!resume || resume.route !== "shop") return;
    clearResume();
    setQ({ ...EMPTY_QUERY, category: (resume.cat as ItemCategory | null) ?? null, tier: resume.tier as TierId | "all", price: resume.price as PriceFilter });
    const item = itemById(resume.item);
    if (item) setOpen(item);
    requestAnimationFrame(() => window.scrollTo(0, resume.scrollY));
  }, [active, member, snap]);
  // From the inventory / carousel: a theme or an item to show.
  useEffect(() => {
    if (!active || !intent) return;
    if (intent.collection) setQ({ ...EMPTY_QUERY, collection: intent.collection });
    const item = itemById(intent.item);
    if (item) setOpen(item);
    clearIntent();
  }, [active, intent]);
  const resumeState = (item: ItemDef | null) => ({ route: "shop" as const, cat: q.category, tier: q.tier, price: q.price, item: item?.id ?? null, scrollY: window.scrollY });
  const ctx = { owned, wallet };
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, forSale.filter((i) => i.category === c.id).length])) as Record<ItemCategory, number>;
  const results = sortItems(filterItems(forSale, q, ctx), q.sort);
  const browsing = q.category === null && !isFiltered(q);
  const showTop = () => top.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const pickCategory = (c: ItemCategory | null) => {
    setQ((current) => ({ ...current, category: c }));
    if (window.scrollY > (top.current?.offsetTop ?? 0)) showTop();
  };
  const purchase = async (i: ItemDef, currency: "coins" | "gems") => {
    const r = await act(() => buy(server!, i.id, currency, { expectedPrice: priceOf(i, currency) ?? undefined, configVersion: snap?.config }), `${i.name}을(를) 샀어요. 인벤토리에서 장착할 수 있어요.`);
    if (r) setNotice(r);
  };
  const equipNow = async (i: ItemDef) => {
    if (!snap || i.category === "emote" || i.category === "chat") return;
    const next = { ...snap.loadout, [i.category]: i.id };
    const r = await act(() => saveLoadout(server!, next), `${i.name}을(를) 장착했어요. 다음 경기부터 상대에게 보여요.`);
    if (r) setNotice(r);
  };
  const priceLine = (i: ItemDef) => {
    if (owned.has(i.id)) return null;
    // Achievement-only items are never for sale, whatever the server's catalog revision (C5 streak titles).
    if (i.acquisition === "achievement") return <span className="item-card-price">업적 보상</span>;
    if (preparing(i)) return <span className="item-card-price">판매 준비 중</span>;
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
  const card = (item: ItemDef) => (
    <ItemCard key={item.id} item={item} owned={owned.has(item.id)} level={owned.get(item.id) ?? 1} equipped={owned.has(item.id) && wears(snap?.loadout, item)}
      badge={owned.has(item.id) ? "보유 중" : undefined} price={priceLine(item)} preparing={item.acquisition !== "achievement" && preparing(item)} onOpen={() => setOpen(item)} />
  );
  const picks = sortItems(forSale.filter((i) => EDITOR_PICKS.includes(i.id)), "recommended");
  const fresh = newItems(forSale);
  const ownedIds = new Set(owned.keys());
  const activeCollection = q.collection !== "all" ? COLLECTIONS.find((x) => x.id === q.collection) : null;
  if (!active) return null;
  return (
    <section className="shop-page" role="tabpanel" aria-label="상품">
      {!member && <p className="econ-note shop-guest-note">둘러보기와 미리보기는 로그인 없이 할 수 있어요. 구매·뽑기·강화·장착은 로그인 후 이용할 수 있어요.</p>}
      {browsing && (
        <PromoCarousel slides={promoSlides()} unavailable={(id) => { const i = itemById(id); return !i || preparing(i); }}
          onCollection={(c) => {
            if (c) {
              setQ({ ...EMPTY_QUERY, collection: c });
              requestAnimationFrame(showTop);
            } else document.getElementById("shop-picks")?.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
          onItem={(id) => setOpen(itemById(id))} />
      )}
      <div className="shop-layout" ref={top}>
        <aside className="shop-side" aria-label="상품 카테고리">
          <CategoryTabs value={q.category} onChange={pickCategory} counts={counts} all={() => pickCategory(null)} />
        </aside>
        <div className="shop-main">
          <div className="shop-toolbar">
            <SearchBox value={q.text} onChange={set("text")} label="상품 이름·테마 검색" />
            <div className="econ-filters">
              <Select label="등급" value={q.tier} onChange={set("tier")}
                options={[{ value: "all" as TierId | "all", label: "전체 등급" }, ...TIERS.filter((t) => t.id !== "basic").map((t) => ({ value: t.id as TierId | "all", label: t.label }))]} />
              <Select label="가격" value={q.price} onChange={set("price")}
                options={[{ value: "all" as PriceFilter, label: "모든 가격" }, { value: "coins" as PriceFilter, label: "코인으로 구매" }, { value: "gems" as PriceFilter, label: "보석으로 구매" }, ...(member ? [{ value: "afford" as PriceFilter, label: "지금 살 수 있는 것" }] : [])]} />
              <Select label="가격대" value={q.band} onChange={set("band")} options={PRICE_BANDS.map((b) => ({ value: b.value, label: b.label }))} />
              <Select label="테마 컬렉션" value={q.collection} onChange={set("collection")}
                options={[{ value: "all", label: "모든 테마" }, ...COLLECTIONS.map((c) => ({ value: c.id, label: `${c.name} 컬렉션` }))]} />
              {member && <Select label="보유 상태" value={q.own} onChange={set("own")} options={[{ value: "all" as OwnFilter, label: "보유 무관" }, { value: "unowned" as OwnFilter, label: "미보유만" }, { value: "owned" as OwnFilter, label: "보유만" }]} />}
              <Select label="정렬" value={q.sort} onChange={set("sort")} options={SORTS} />
            </div>
            {isFiltered(q) && <button type="button" className="text-button shop-reset" onClick={() => setQ({ ...EMPTY_QUERY, category: q.category, sort: q.sort })}><RotateCcw size={14} aria-hidden="true" /> 필터 초기화</button>}
          </div>
          {activeCollection && (() => {
            const p = collectionProgress(activeCollection, ownedIds);
            return <p className="collection-banner" style={{ "--col": activeCollection.color } as React.CSSProperties}><b>{activeCollection.name} 컬렉션</b> {member ? `보유 ${p.have}/${p.total}` : `${p.total}개 상품`} · 시너지: {activeCollection.synergy}</p>;
          })()}
          {busy && <p className="econ-note" role="status"><BrandMark /> 처리 중…</p>}
          {notice && !open && <p className="econ-ok" role="status">{notice}</p>}
          {error && !open && <p className="error-message" role="alert">{error}</p>}
          {browsing ? <>
            <section className="shop-section shop-feature" id="shop-picks" aria-labelledby="shop-section-picks">
              <h2 id="shop-section-picks">에디터 추천</h2>
              <p className="econ-note shop-section-note">이용량이나 개인 데이터 없이 직접 고른 편집 목록이에요.</p>
              <ShopRail label="에디터 추천">{picks.map(card)}</ShopRail>
            </section>
            <section className="shop-section shop-feature" aria-labelledby="shop-section-themes">
              <h2 id="shop-section-themes">테마 컬렉션</h2>
              <p className="econ-note shop-section-note">같은 테마의 주사위와 보드판을 함께 장착하면 시너지 연출이 켜져요.</p>
              <ShopRail label="테마 컬렉션">
                {COLLECTIONS.map((c) => {
                  const p = collectionProgress(c, ownedIds);
                  const pieces = [c.dice[0], c.boards[0]].map((id) => itemById(id)).filter((i): i is ItemDef => !!i);
                  return (
                    <li key={c.id} className="theme-card" style={{ "--col": c.color } as React.CSSProperties}>
                      <button type="button" onClick={() => { setQ({ ...EMPTY_QUERY, collection: c.id }); requestAnimationFrame(showTop); }} aria-label={`${c.name} 컬렉션 보기`}>
                        <span className="theme-card-art">{pieces.map((i) => <ItemThumb key={i.id} item={i} level={1} size={54} />)}</span>
                        <b>{c.name}</b>
                        <small>{member ? `보유 ${p.have}/${p.total}` : `${p.total}개 상품`}</small>
                        {member && <span className="theme-bar" aria-hidden="true"><i style={{ width: `${(p.have / Math.max(1, p.total)) * 100}%` }} /></span>}
                      </button>
                    </li>
                  );
                })}
              </ShopRail>
            </section>
            {fresh.length > 0 && (
              <section className="shop-section shop-feature" aria-labelledby="shop-section-new">
                <h2 id="shop-section-new">신상품</h2>
                <p className="econ-note shop-section-note">가장 최근에 추가된 상품이에요. 서버가 판매를 열기 전에는 미리보기만 할 수 있어요.</p>
                <ShopRail label="신상품">{fresh.map(card)}</ShopRail>
              </section>
            )}
            {CATEGORIES.map(({ id, label }) => {
              const items = sortItems(forSale.filter((i) => i.category === id), q.sort === "recommended" ? "tier-asc" : q.sort);
              if (!items.length) return null;
              return (
                <section className="shop-section" aria-labelledby={`shop-section-${id}`} key={id}>
                  <h2 id={`shop-section-${id}`}>{label}</h2>
                  <button type="button" className="text-button shop-view-all" onClick={() => pickCategory(id)}>{label} 전체 보기</button>
                  <ShopRail label={label}>{items.map(card)}</ShopRail>
                </section>
              );
            })}
            {upcoming.length > 0 && (
              <section className="shop-section shop-upcoming" aria-label="판매 예정 기간 한정 상품">
                <h2>판매 예정 · 기간 한정</h2>
                <p className="econ-note">{[...new Set(upcoming.map((i) => i.season!))].map((id) => `${SEASONS[id].name}: ${saleDate.format(SEASONS[id].start)}부터`).join(" · ")} (한국 시간)</p>
                <ShopRail label="판매 예정">{upcoming.map((item) => <ItemCard key={item.id} item={item} owned={owned.has(item.id)} level={1} badge="판매 예정" onOpen={() => setOpen(item)} />)}</ShopRail>
              </section>
            )}
          </> : (
            <section className="shop-results" aria-labelledby="shop-results-title">
              <h2 id="shop-results-title">{q.category ? categoryLabel(q.category) : "검색 결과"} <small>{results.length}개{q.sort === "recommended" ? " · 편집 추천순" : ""}</small></h2>
              {results.length === 0 ? <p className="econ-note shop-empty">조건에 맞는 상품이 없어요. 필터를 줄이거나 다른 이름으로 찾아보세요.</p>
                : <ul className="item-grid shop-grid-full" aria-label={(q.category ? categoryLabel(q.category) : "검색 결과") + " 상품"}>{results.map(card)}</ul>}
            </section>
          )}
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
                      <button type="button" className="secondary" disabled={busy || !snap || wallet.coins < c} onClick={() => void act(() => buySlot(server!, kind, "coins", { expectedPrice: c, configVersion: snap?.config }))} aria-label={`${kind === "emote" ? "이모티콘" : "채팅"} 슬롯 코인 구매`}>
                        <Coins size={14} /> {fmt(c)}
                      </button>
                      <button type="button" className="secondary" disabled={busy || !snap || wallet.gems < (g ?? Infinity)} onClick={() => void act(() => buySlot(server!, kind, "gems", { expectedPrice: g ?? undefined, configVersion: snap?.config }))} aria-label={`${kind === "emote" ? "이모티콘" : "채팅"} 슬롯 보석 구매`}>
                        <Gem size={14} /> {g}
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          </Gate>
        </div>
      </div>
      {askLogin && <LoginPrompt server={server} action={askLogin} resume={resumeState(open)} go={go} onClose={() => setAskLogin(null)} />}
      {active && open && (
        <ItemDetail item={open} initialLevel={owned.get(open.id) ?? 1} now={now} onClose={() => { setOpen(null); setNotice(""); }}
          status={!member ? "로그인하지 않아도 미리보기는 모두 볼 수 있어요." : owned.has(open.id) ? <><Check size={14} aria-hidden="true" /> 보유 중 · Lv.{owned.get(open.id)}{wears(snap?.loadout, open) ? " · 지금 장착 중" : " · 장착하지 않음"}</> : "아직 보유하지 않은 상품이에요."}>
          {() => {
            const i = open;
            if (owned.has(i.id))
              return (
                <>
                  {i.category !== "emote" && i.category !== "chat" && !wears(snap?.loadout, i) && (
                    <button type="button" className="primary" disabled={busy || !snap} onClick={() => void equipNow(i)}>바로 장착</button>
                  )}
                  <button type="button" className="secondary" onClick={() => { setOpen(null); onIntent("inventory", { item: i.id }); }}>
                    인벤토리에서 {i.maxLevel > 1 ? "강화·" : ""}장착 관리
                  </button>
                  {notice && <p className="econ-ok" role="status">{notice}</p>}
                  {error && <p className="error-message" role="alert">{error}</p>}
                </>
              );
            if (i.acquisition === "achievement") return <span className="shop-owned">업적으로만 얻을 수 있어요</span>;
            if (i.season && !seasonActive(i.season, now)) return <span className="shop-owned">{seasonUpcoming(i.season, now) ? `판매 예정 · ${saleDate.format(SEASONS[i.season].start)}부터 (한국 시간)` : "판매 기간이 끝났어요."}</span>;
            if (preparing(i)) return <span className="shop-owned">판매 준비 중이에요. 서버가 새 상품을 열면 바로 살 수 있어요. 미리보기는 지금도 볼 수 있어요.</span>;
            const c = priceOf(i, "coins"),
              g = priceOf(i, "gems");
            // A refused purchase (e.g. 409 PRICE_CHANGED / POLICY_CHANGED after a price update) is shown here,
            // above the buttons, with the snapshot already reloaded so the buttons show the current price.
            const refused = error ? <p className="error-message" role="alert">{error}</p> : null;
            if (!member)
              return (
                <>
                  {c !== null && <button type="button" className="primary" onClick={() => setAskLogin("구매")} aria-label={`${i.name} 코인 ${c}으로 구매`}><Coins size={15} /> {fmt(c)} 코인으로 구매</button>}
                  {g !== null && <button type="button" className="secondary" onClick={() => setAskLogin("구매")} aria-label={`${i.name} 보석 ${g}으로 구매`}><Gem size={15} /> {fmt(g)} 보석으로 구매</button>}
                </>
              );
            return (
              <>
                {refused}
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
                  setQ({ ...EMPTY_QUERY, category: i.category, tier: i.tier });
                  setOpen(null);
                  showTop();
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

type InvSort = "recent" | "tier-desc" | "name" | "level";
type InvView = "all" | "equipped" | "unequipped" | "upgradable";
const SLOT_LABEL: Record<(typeof SINGLE_SLOTS)[number], string> = { dice: "주사위", board: "보드판", bubble: "말풍선", profile: "프로필", nameFx: "닉네임 효과", fx: "특수 연출", title: "칭호" };

function InventoryPage({ server, go, economyState, active, intent, clearIntent, onIntent }: EconomyProps) {
  const { snap, error, busy, act } = economyState;
  const [changes, setChanges] = useState<Loadout | null>(null);
  const draft = changes ?? snap?.loadout ?? null;
  const [saved, setSaved] = useState("");
  const [cat, setCat] = useState<ItemCategory>("dice");
  const [open, setOpen] = useState<ItemDef | null>(null);
  const [combo, setCombo] = useState(false);
  const [confirmUp, setConfirmUp] = useState<{ item: ItemDef; cost: number; to: number } | null>(null);
  const [text, setText] = useState("");
  const [sort, setSort] = useState<InvSort>("recent");
  const [view, setView] = useState<InvView>("all");
  const name = useNickname();
  const account = accountOf(session());
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets(account));
  const [presetName, setPresetName] = useState("");
  const [presetNote, setPresetNote] = useState("");
  const grid = useRef<HTMLDivElement>(null);

  const owned = ownedMap(snap);
  const acquired = new Map((snap?.inventory ?? []).map((i) => [i.id, i.at]));
  const mine = ITEMS.filter((i) => !i.retired && isOwned(i, owned));
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, mine.filter((i) => i.category === c.id).length])) as Record<ItemCategory, number>;
  const dirty = !!snap && !!draft && JSON.stringify(draft) !== JSON.stringify(snap.loadout);
  useEffect(() => {
    if (!active || !intent || !snap) return;
    const item = itemById(intent.item);
    if (item && isOwned(item, owned)) {
      setCat(item.category);
      setOpen(item);
    }
    clearIntent();
  }, [active, intent, snap]);
  const save = async () => {
    if (!draft) return;
    const r = await act(() => saveLoadout(server!, draft), "장착을 저장했어요. 다음 경기부터 상대에게 보여요.");
    if (r) { setChanges((current) => current === draft ? null : current); setSaved(r); }
  };
  const isEquipped = (i: ItemDef) => wears(draft, i);
  const toggle = (i: ItemDef) =>
    setChanges((current) => {
      const d = current ?? draft;
      if (!d || !snap) return d;
      if (i.category === "emote" || i.category === "chat") {
        const key = listKey(i.category);
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
  const upgradeInfo = (i: ItemDef) => {
    const have = owned.get(i.id) ?? 1;
    const cost = upgradeCost(i, have);
    return { have, cost, supported: !!snap && upgradeSupportedOn(i, snap.catalogRev) };
  };
  const tierRank = (i: ItemDef) => TIERS.findIndex((t) => t.id === i.tier);
  const shown = mine
    .filter((i) => i.category === cat && matchesText(i, text))
    .filter((i) => view === "all" || (view === "equipped" ? isEquipped(i) : view === "unequipped" ? !isEquipped(i) : upgradeInfo(i).cost !== null))
    .sort((a, b) => sort === "recent" ? (acquired.get(b.id) ?? 0) - (acquired.get(a.id) ?? 0) || tierRank(b) - tierRank(a)
      : sort === "tier-desc" ? tierRank(b) - tierRank(a) : sort === "level" ? (owned.get(b.id) ?? 1) - (owned.get(a.id) ?? 1) || tierRank(b) - tierRank(a)
      : a.name.localeCompare(b.name, "ko"));
  const focusCategory = (c: ItemCategory) => {
    setCat(c);
    setView("all");
    setText("");
    requestAnimationFrame(() => grid.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  };
  const savePreset = () => {
    if (!draft) return;
    const label = (presetName.trim() || `프리셋 ${presets.length + 1}`).slice(0, 20);
    const next = [...presets, { id: Math.random().toString(36).slice(2, 10), name: label, loadout: draft, at: Date.now() }].slice(0, MAX_PRESETS);
    setPresets(next);
    setPresetName("");
    setPresetNote(storePresets(account, next) ? `‘${label}’ 프리셋을 이 기기에 저장했어요.` : "이 브라우저에는 프리셋을 저장할 수 없어요.");
  };
  const removePreset = (id: string) => {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    storePresets(account, next);
    setPresetNote("프리셋을 지웠어요.");
  };
  const usePreset = (p: Preset) => {
    if (!snap) return;
    const applied = applyPreset(p, owned, snap.slots);
    setChanges(applied.loadout);
    setSaved("");
    setPresetNote(applied.message);
  };
  if (!active) return null;
  const synergy = draft ? synergyOf(draft.dice, draft.board) : null;
  const diceItem = draft ? itemById(draft.dice) : null;
  const boardItem = draft ? itemById(draft.board) : null;
  return (
    <section className="inventory-page" role="tabpanel" aria-label="인벤토리">
      <Gate server={server} go={go}>
        {!snap || !draft ? (
          <p className="econ-note" role="status">
            <BrandMark /> 불러오는 중…
          </p>
        ) : (
          <>
            <div className="inv-top">
              <section className="loadout-preview" aria-label="장착 미리보기">
                <div className="loadout-stage">
                  {(() => {
                    const theme = boardTheme(boardItem, shownLevel(boardItem!), false);
                    const look = diceItem ? lookAt(diceItem, shownLevel(diceItem)).dice : null;
                    return (
                      <div className={"loadout-board board-sample" + theme.className} style={theme.style} data-synergy={synergy?.kind}>
                        {[5, 3, 6].map((v) => look ? <DiceFace key={v} item={diceItem!} level={shownLevel(diceItem!)} size={44} value={v} /> : <DieIcon key={v} value={v} />)}
                      </div>
                    );
                  })()}
                  <div className="loadout-card">
                    <PlayerTag name={name} look={publicLook(draft, owned)} me />
                    <span className={"feed-msg chat sample " + (lookAt(itemById(draft.bubble), shownLevel(itemById(draft.bubble)!)).css ?? "")}><b className="feed-from">{name}</b> 좋은 경기 해요!</span>
                    <span className="loadout-emotes">{draft.emotes.map((id) => itemById(id)?.look.text).join(" ")}</span>
                  </div>
                  <button type="button" className="secondary loadout-roll" onClick={() => setCombo(true)}><Dices size={15} aria-hidden="true" /> 이 조합으로 굴려 보기</button>
                </div>
                <ul className="loadout-slots" aria-label="장착한 아이템">
                  {SINGLE_SLOTS.map((slot) => {
                    const item = itemById(draft[slot]);
                    if (!item) return null;
                    const changed = snap.loadout[slot] !== draft[slot] || snap.loadout.levels[item.id] !== draft.levels[item.id];
                    return (
                      <li key={slot}>
                        <button type="button" className={"loadout-slot" + (cat === slot ? " active" : "") + (changed ? " changed" : "")} onClick={() => focusCategory(slot)} aria-label={`${SLOT_LABEL[slot]}: ${item.name}${changed ? " (저장 전)" : ""} — 바꾸기`}>
                          <ItemThumb item={item} level={shownLevel(item)} size={40} />
                          <span><small>{SLOT_LABEL[slot]}</small><b>{item.name}</b>{item.maxLevel > 1 && <em>Lv.{shownLevel(item)}</em>}</span>
                        </button>
                      </li>
                    );
                  })}
                  {(["emote", "chat"] as const).map((kind) => (
                    <li key={kind}>
                      <button type="button" className={"loadout-slot" + (cat === kind ? " active" : "")} onClick={() => focusCategory(kind)} aria-label={`${kind === "emote" ? "이모티콘" : "채팅"} ${draft[listKey(kind)].length}개 — 바꾸기`}>
                        <span className="loadout-slot-count">{draft[listKey(kind)].length}/{snap.slots[kind]}</span>
                        <span><small>{kind === "emote" ? "이모티콘" : "채팅"}</small><b>{kind === "emote" ? draft.emotes.map((id) => itemById(id)?.look.text).join(" ") : `${draft.chats.length}개 문구`}</b></span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="loadout-save">
                  <button type="button" className="primary econ-save" disabled={busy || !dirty} onClick={() => void save()}>
                    장착 저장
                  </button>
                  {dirty && <button type="button" className="text-button" onClick={() => { setChanges(null); setPresetNote(""); }}>변경 취소</button>}
                  <small>{dirty ? "저장하지 않은 변경이 있어요" : "저장된 장착"}</small>
                </div>
              </section>
              {synergy ? <p className="collection-banner active" style={{ "--col": synergy.color } as React.CSSProperties}><b>{synergy.name} 시너지 켜짐</b> · {synergy.synergy}</p>
                : (() => {
                  const hint = COLLECTIONS.find((c) => c.dice.includes(draft.dice) || c.boards.includes(draft.board));
                  return hint ? <p className="collection-banner" style={{ "--col": hint.color } as React.CSSProperties}><b>{hint.name} 컬렉션</b> · 같은 테마의 {hint.dice.includes(draft.dice) ? "보드판" : "주사위"}을 함께 장착하면 시너지 연출이 켜져요.</p> : null;
                })()}
            </div>
            {busy && <p className="econ-note" role="status"><BrandMark /> 저장 중…</p>}
            {saved && !open && <p className="econ-ok" role="status">{saved}</p>}
            {error && !open && <p className="error-message" role="alert">{error}</p>}
            <div className="inv-layout" ref={grid}>
              <aside className="shop-side inv-side">
                <CategoryTabs value={cat} onChange={(c) => { setCat(c); setView("all"); }} counts={counts} />
              </aside>
              <div className="inv-main">
                <div className="shop-toolbar">
                  <SearchBox value={text} onChange={setText} label="보유 상품 검색" />
                  <div className="econ-filters">
                    <Select label="보기" value={view} onChange={setView} options={[{ value: "all" as InvView, label: "보유 전체" }, { value: "equipped" as InvView, label: "장착 중" }, { value: "unequipped" as InvView, label: "장착 안 함" }, { value: "upgradable" as InvView, label: "강화 가능" }]} />
                    <Select label="정렬" value={sort} onChange={setSort} options={[{ value: "recent" as InvSort, label: "최근 획득순" }, { value: "tier-desc" as InvSort, label: "등급 높은순" }, { value: "level" as InvSort, label: "강화 단계순" }, { value: "name" as InvSort, label: "이름순" }]} />
                  </div>
                </div>
                {listKind && (
                  <div className="inv-order-box">
                    <strong>
                      {listKind === "emote" ? "이모티콘" : "채팅"} 장착 {draft[listKey(listKind)].length}/{snap.slots[listKind]}
                    </strong>
                    <ol className="inv-order" aria-label={`${listKind === "emote" ? "이모티콘" : "채팅"} 순서`}>
                      {draft[listKey(listKind)].map((id, n, list) => (
                        <li key={id}>
                          <span>{itemById(id)?.look.text}</span>
                          <button type="button" className="icon-button" aria-label="앞으로" disabled={n === 0} onClick={() => move(listKey(listKind), n, -1)}>
                            <ArrowUp size={14} />
                          </button>
                          <button type="button" className="icon-button" aria-label="뒤로" disabled={n === list.length - 1} onClick={() => move(listKey(listKind), n, 1)}>
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
                {shown.length === 0 ? <p className="econ-note shop-empty">{text || view !== "all" ? "조건에 맞는 보유 상품이 없어요." : "이 상품군에는 아직 가진 상품이 없어요."} <button type="button" className="text-button" onClick={() => go("shop")}>상점에서 찾아보기</button></p> : (
                  <ul className="item-grid" aria-label="보유 아이템">
                    {shown.map((i) => {
                      const up = upgradeInfo(i);
                      return (
                        <ItemCard key={i.id} item={i} owned equipped={isEquipped(i)} level={shownLevel(i)} onOpen={() => setOpen(i)}
                          action={<span className="item-card-actions">
                            <button type="button" className={"item-equip " + (isEquipped(i) ? "primary" : "secondary")}
                              aria-pressed={isEquipped(i)} aria-label={`${i.name} ${isEquipped(i) ? (listKind ? "해제" : "장착됨") : "장착"}`} onClick={() => toggle(i)}>
                              {isEquipped(i) ? (listKind ? "해제" : "장착 중") : "장착"}
                            </button>
                            {up.cost !== null && up.supported && (
                              <button type="button" className="item-up secondary" disabled={busy || snap.wallet.coins < up.cost} title={`Lv.${up.have + 1} 강화 · ${fmt(up.cost)}코인`}
                                aria-label={`${i.name} 목록에서 Lv.${up.have + 1}로 강화, ${fmt(up.cost)}코인`} onClick={() => { setSaved(""); setConfirmUp({ item: i, cost: up.cost!, to: up.have + 1 }); }}>
                                <Sparkles size={13} aria-hidden="true" /> {fmt(up.cost)}
                              </button>
                            )}
                          </span>} />
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="inv-panels">
              <section className="inv-presets" aria-labelledby="inv-presets-title">
                <h2 id="inv-presets-title">장착 프리셋 <small>이 기기에만 저장 · 계정 동기화 없음</small></h2>
                {presets.length === 0 ? <p className="econ-note">지금 장착 조합을 이름을 붙여 저장해 두고 한 번에 불러올 수 있어요. 불러올 때 지금 가진 상품과 슬롯으로 다시 확인해요.</p> : (
                  <ul className="preset-list">
                    {presets.map((p) => {
                      const pd = itemById(p.loadout.dice), pb = itemById(p.loadout.board);
                      return (
                        <li key={p.id}>
                          <span className="preset-art" aria-hidden="true">{pd && <ItemThumb item={pd} size={30} />}{pb && <ItemThumb item={pb} size={30} />}</span>
                          <b>{p.name}</b>
                          <button type="button" className="secondary" onClick={() => usePreset(p)} aria-label={`${p.name} 프리셋 불러오기`}>불러오기</button>
                          <button type="button" className="icon-button" onClick={() => removePreset(p.id)} aria-label={`${p.name} 프리셋 지우기`}><Trash2 size={15} /></button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="preset-new">
                  <input type="text" maxLength={20} value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder={`프리셋 ${presets.length + 1}`} aria-label="새 프리셋 이름" disabled={presets.length >= MAX_PRESETS} />
                  <button type="button" className="secondary" onClick={savePreset} disabled={presets.length >= MAX_PRESETS}>프리셋으로 저장</button>
                </div>
                {presets.length >= MAX_PRESETS && <small className="econ-note">프리셋은 {MAX_PRESETS}개까지 저장할 수 있어요.</small>}
                {presetNote && <p className="econ-note" role="status">{presetNote}</p>}
              </section>
              <section className="inv-collections" aria-labelledby="inv-collections-title">
                <h2 id="inv-collections-title">컬렉션 진행도</h2>
                <ul className="collection-progress">
                  {themeProgress(new Set(owned.keys())).map(({ collection: c, have, total }) => (
                    <li key={c.id} style={{ "--col": c.color } as React.CSSProperties} className={have === total ? "complete" : ""}>
                      <span className="cp-name"><b>{c.name}</b> <small>{have}/{total}</small>{synergy?.id === c.id && <em>시너지 켜짐</em>}</span>
                      <span className="theme-bar" aria-hidden="true"><i style={{ width: `${(have / Math.max(1, total)) * 100}%` }} /></span>
                      <button type="button" className="text-button" onClick={() => onIntent("shop", { collection: c.id })} aria-label={`${c.name} 컬렉션 상점에서 보기`}>상점</button>
                    </li>
                  ))}
                </ul>
                <p className="econ-note">진행도는 표시만 해요. 컬렉션 완성 보상은 없어요.</p>
              </section>
            </div>
          </>
        )}
      </Gate>
      {active && open && snap && draft && (
        <ItemDetail item={open} initialLevel={shownLevel(open)} unlocked={owned.get(open.id) ?? 1} onClose={() => setOpen(null)}
          status={<><Check size={14} aria-hidden="true" /> {isEquipped(open) ? "지금 장착 중 (저장 전 변경 포함)" : "보유 중 · 장착하지 않음"}</>}>
          {(previewLevel) => {
            const i = open;
            const have = owned.get(i.id) ?? 1;
            const cost = upgradeCost(i, have);
            const upgradeSupported = upgradeSupportedOn(i, snap.catalogRev);
            const pickable = previewLevel <= have && (previewLevel === 1 || upgradeSupported);
            return (
              <>
                <p className="item-short">보유 Lv.{have} · 선택 Lv.{shownLevel(i)}</p>
                {saved && <p className="econ-ok" role="status">{saved}</p>}
                {error && <p className="error-message" role="alert">{error}</p>}
                <button type="button" className={isEquipped(i) ? "secondary" : "primary"} onClick={() => toggle(i)}>
                  {isEquipped(i) ? "장착 해제" : "장착"}
                </button>
                {i.maxLevel > 1 && (
                  <button type="button" className="secondary" disabled={!pickable || shownLevel(i) === previewLevel} onClick={() => setChanges({ ...draft, levels: { ...draft.levels, [i.id]: previewLevel } })}>
                    {pickable ? `Lv.${previewLevel} 모습으로 표시` : !upgradeSupported ? `Lv.${previewLevel} 서버 지원 준비 중` : `Lv.${previewLevel}은 강화 후 사용`}
                  </button>
                )}
                {cost !== null && (!upgradeSupported ? (
                  <p className="item-short" role="status">현재 서버에서는 이 단계의 강화를 준비 중이에요. 외형은 미리 볼 수 있어요.</p>
                ) : (
                  <button type="button" className="secondary" disabled={busy || snap.wallet.coins < cost} onClick={() => {
                    setSaved("");
                    setConfirmUp({ item: i, cost, to: have + 1 });
                  }} aria-label={`${i.name} Lv.${have + 1} 강화`}>
                    <Sparkles size={15} /> Lv.{have + 1} 강화 · <Coins size={13} /> {fmt(cost)}
                  </button>
                ))}
                <small className="item-short">장착·단계 변경은 &lsquo;장착 저장&rsquo;을 눌러야 다음 경기에 적용돼요.</small>
              </>
            );
          }}
        </ItemDetail>
      )}
      {active && combo && draft && diceItem && <ComboDialog dice={diceItem} board={boardItem} level={shownLevel(diceItem)} onClose={() => setCombo(false)} />}
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
          if (!c || !snap || !upgradeSupportedOn(c.item, snap.catalogRev)) return;
          void act(async () => {
            // SEC-08: the level the player confirmed from; a second tab or a late retry cannot upgrade twice
            const updated = await upgrade(server!, c.item.id, { expectedLevel: c.to - 1, expectedPrice: c.cost, configVersion: snap.config });
            if (!updated.inventory.some((entry) => entry.id === c.item.id && entry.level >= c.to)) {
              throw new EconomyError("UPGRADE_UNCONFIRMED", "강화 결과를 확인하지 못했어요. 보유 단계와 재화 내역을 확인해 주세요.");
            }
            return updated;
          }, `${c.item.name} Lv.${c.to} 강화 완료`).then((r) => r && setSaved(r));
        }}
      />
    </section>
  );
}

/** The equipped die on the equipped board, live (the single active stage while open). Nothing is saved. */
function ComboDialog({ dice, board, level, onClose }: { dice: ItemDef; board: ItemDef | null; level: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useActivityDialog(dialog);
  return (
    <dialog ref={dialog} className="modal item-detail combo-dialog" aria-label="장착 조합 미리보기" onCancel={(e) => { e.preventDefault(); onClose(); }} onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); } }}>
      <div className="item-detail-head">
        <div><h2>장착 조합 미리보기</h2><p>{dice.name}{board ? ` + ${board.name}` : ""}</p></div>
        <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
      </div>
      <ItemStage item={dice} level={level} partnerId={board && board.acquisition !== "default" ? board.id : null} />
    </dialog>
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
  const guideId = achievements ? "achievements" : "quests";
  const tour = useCoach(guideId, !!snap);
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
        {!!snap && <button type="button" className="text-button items-help" onClick={tour.start}><CircleHelp size={16} /> {achievements ? "업적 사용법" : "퀘스트 사용법"}</button>}
      </div>
      <Coach label={achievements ? "업적" : "퀘스트"} steps={achievements ? ACHIEVEMENT_STEPS : QUEST_STEPS} open={!!snap && tour.open} onClose={tour.close} />
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
