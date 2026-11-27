import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Backpack, Coins, Dices, Gem, Globe, History, ListChecks, LogIn, LogOut, Maximize, Menu, Minimize, Settings, Store, UserRound, UsersRound, X } from "lucide-react";
import { diceRenderer, sfxAudible, updateSettings, useSettings, webglAvailable, type DiceQuality, type FxQuality, type Settings as AppSettings } from "../settings";
import { Segmented, Select, Sheet, Slider, Switch } from "../ui/kit";
import { openShortcutHelp } from "../ui/shortcuts";
import { playSfx, unlockAudio } from "../sound";
import { labTools, routes, type Route } from "../routes";
import { signOut } from "../identity/account-client";
import { useNickname } from "../identity/display-name";
import { GUEST_LOOK } from "../economy/live/catalog";
import { PlayerTag } from "../play/Looks";
import type { useProfileEconomy } from "./profile-economy";
import "./navigation.css";
import { useInbox } from "./Friends";
import { LegalNav } from "../legal/LegalNav";

export function FullscreenToggle() {
  const supported = typeof document !== "undefined" && !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen;
  const [active, setActive] = useState(() => supported && !!document.fullscreenElement);
  useEffect(() => {
    if (!supported) return;
    const sync = () => setActive(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [supported]);
  if (!supported) return null;
  return (
    <button
      type="button"
      className="icon-button shell-icon shell-fullscreen"
      aria-label={active ? "전체 화면 종료" : "전체 화면"}
      title={active ? "전체 화면 종료" : "전체 화면"}
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
        else void document.documentElement.requestFullscreen().catch(() => undefined);
      }}
    >
      {active ? <Minimize size={19} /> : <Maximize size={19} />}
    </button>
  );
}

const qualityLabel: Record<DiceQuality, string> = { auto: "자동", "3d-high": "고화질", "3d": "성능 우선", "2.5d": "간단 (2.5D)" };
const fxLabel: Record<FxQuality, string> = { auto: "자동", high: "높음", low: "낮음" };
const percent = (v: number) => `${Math.round(v)}%`;

function Row({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span>
        <strong>{title}</strong>
        {note && <small>{note}</small>}
      </span>
      {children}
    </div>
  );
}

/**
 * Settings (2026-11-26): a centred modal on PC, a bottom sheet on phones. Changes save at once (this
 * browser only). Sound effects and music have separate switches and volumes under one master mute.
 */
export function SettingsDialog({ open, onClose, inGame = false }: { open: boolean; onClose: () => void; inGame?: boolean }) {
  const settings = useSettings();
  const systemReduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const canRender3d = !open || webglAvailable();
  const renderer = diceRenderer(settings);
  const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches && !window.matchMedia?.("(any-pointer: fine)").matches;
  const set = (patch: Partial<AppSettings>) => {
    updateSettings(patch);
    unlockAudio();
  };
  return (
    <Sheet open={open} onClose={onClose} title="설정" className="settings-dialog">
      <div className="settings-content" role="region" aria-label="설정 항목" tabIndex={0} data-select-viewport>
        <section className="settings-group" aria-labelledby="settings-sound">
          <h3 id="settings-sound">사운드</h3>
          <Row title="전체 음소거" note="효과음과 배경 음악을 모두 꺼요 (M)">
            <Switch label="전체 음소거" checked={settings.muted} onChange={(v) => set({ muted: v })} />
          </Row>
          <Row title="효과음">
            <Switch label="효과음" checked={settings.sfx} disabled={settings.muted} onChange={(v) => set({ sfx: v })} />
          </Row>
          <Row title="효과음 음량">
            <Slider label="효과음 음량" value={Math.round(settings.volume * 100)} step={5} format={percent}
              disabled={settings.muted || !settings.sfx} onChange={(v) => set({ volume: v / 100 })} />
          </Row>
          <Row title="배경 음악" note="상황에 맞는 잔잔한 음악 (B)">
            <Switch label="배경 음악" checked={settings.bgm} disabled={settings.muted} onChange={(v) => set({ bgm: v })} />
          </Row>
          <Row title="배경 음악 음량">
            <Slider label="배경 음악 음량" value={Math.round(settings.bgmVolume * 100)} step={5} format={percent}
              disabled={settings.muted || !settings.bgm} onChange={(v) => set({ bgmVolume: v / 100 })} />
          </Row>
          <button type="button" className="secondary settings-preview" disabled={!sfxAudible(settings)}
            onClick={() => {
              unlockAudio();
              playSfx("throw");
              playSfx("impact", { delay: 0.16, intensity: 0.9 });
              playSfx("impact", { delay: 0.3, intensity: 0.45 });
              playSfx("settle", { delay: 0.42, intensity: 0.4 });
            }}>
            효과음 미리 듣기
          </button>
        </section>
        <section className="settings-group" aria-labelledby="settings-screen">
          <h3 id="settings-screen">화면</h3>
          <Row title="주사위 애니메이션 품질" note={canRender3d ? undefined : "이 브라우저는 3D를 지원하지 않아 2.5D로 표시해요"}>
            <Select label="주사위 애니메이션 품질" value={settings.diceQuality} onChange={(v) => updateSettings({ diceQuality: v })}
              options={(Object.keys(qualityLabel) as DiceQuality[]).map((q) => ({ value: q, label: qualityLabel[q], disabled: q.startsWith("3d") && !canRender3d }))} />
          </Row>
          <Row title="효과 품질" note="주사위·보드·이모티콘 입자 수">
            <Segmented label="효과 품질" value={settings.fxQuality} onChange={(v) => updateSettings({ fxQuality: v })}
              options={(Object.keys(fxLabel) as FxQuality[]).map((q) => ({ value: q, label: fxLabel[q] }))} />
          </Row>
          <Row title="모션 간단히" note="짧고 가벼운 2.5D 연출, 움직이는 배경 정지">
            <Switch label="모션 간단히" checked={settings.reducedEffects} onChange={(v) => updateSettings({ reducedEffects: v })} />
          </Row>
          <Row title="상대 아이템 효과" note="상대가 장착한 애니메이션·효과음">
            <Switch label="상대 아이템 효과" checked={settings.opponentFx} onChange={(v) => updateSettings({ opponentFx: v })} />
          </Row>
          <p className="settings-note" data-renderer={renderer}>
            {systemReduced
              ? "기기의 '동작 줄이기'가 켜져 있어 주사위가 움직이지 않고 바로 결과를 보여 줘요."
              : renderer === "2.5d"
                ? "2.5D 주사위 연출을 사용 중이에요."
                : renderer === "3d-high"
                  ? settings.diceQuality === "auto"
                    ? "3D 물리 주사위를 선명하게 그리고, 기기가 버거워하면 자동으로 가볍게 바꿔요."
                    : "3D 물리 주사위(고화질)를 사용 중이에요."
                  : "3D 물리 주사위(성능 우선)를 사용 중이에요."}
          </p>
        </section>
        {!coarse && (
          <section className="settings-group" aria-labelledby="settings-keys">
            <h3 id="settings-keys">조작</h3>
            <Row title="키보드 단축키" note="Space 굴리기 · 1~5 고정 · ? 도움말">
              <Switch label="키보드 단축키" checked={settings.shortcuts} onChange={(v) => updateSettings({ shortcuts: v })} />
            </Row>
          </section>
        )}
        <section className="settings-group" aria-labelledby="settings-help">
          <h3 id="settings-help">도움말</h3>
          {!coarse && <button type="button" className="text-button" onClick={() => { onClose(); openShortcutHelp(); }}>단축키 모두 보기</button>}
          {inGame && <>
            <p className="settings-note settings-game-note">규칙·난이도·인원은 게임 화면의 ‘설정 변경’에서 바꿀 수 있어요.</p>
            <FullscreenToggle />
          </>}
          <p className="settings-footnote">변경 사항은 바로 이 브라우저에 저장돼요.</p>
          <LegalNav className="settings-legal" onNavigate={onClose} />
        </section>
      </div>
    </Sheet>
  );
}

const groups = [
  { label: "게임", items: [["online", "온라인 대전", Globe], ["offline", "오프라인 대전", Dices]] },
  { label: "활동", items: [["friends", "친구", UsersRound], ["records", "내 기록", History], ["quests", "퀘스트", ListChecks]] },
] as const;

type HeaderProfile = ReturnType<typeof useProfileEconomy>;

function Sidebar({ route, navigate, profile }: { route: Route; navigate: (r: Route) => void; profile: HeaderProfile }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const target = useRef<Route | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const box = useInbox();
  const alerts = profile.signedIn ? box.requests + box.invites.filter((invite) => invite.expires > Date.now()).length : 0;
  const quests = profile.snapshot?.state;
  const current = route === "online-room" || route === "spectate" ? "online" :
    ["play", "pvp", "play-setup", "pvp-setup", "practice"].includes(route) ? "offline" : route === "achievements" ? "quests" : route;

  useLayoutEffect(() => {
    if (!dialog.current?.open) return;
    dialog.current.close();
    target.current = null;
    pointer.current = null;
    setPhase("closed");
  }, [route]);

  const close = (next?: Route) => {
    if (phase !== "open") return;
    target.current = next && next !== route ? next : null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else setPhase("closing");
  };
  const finish = () => {
    if (!dialog.current?.open) return;
    dialog.current.close();
    setPhase("closed");
    const next = target.current;
    target.current = null;
    if (next) navigate(next);
  };
  useEffect(() => {
    if (phase !== "closing") return;
    const timer = window.setTimeout(finish, 260);
    return () => clearTimeout(timer);
  }, [phase, route]);

  return <>
    <button type="button" className="icon-button shell-icon" aria-label="메뉴" aria-controls={id} aria-expanded={phase === "open"} aria-haspopup="dialog" onClick={() => {
      if (dialog.current?.open) return;
      setPhase("open");
      dialog.current?.showModal();
    }}><Menu size={20} aria-hidden="true" /></button>
    <dialog id={id} ref={dialog} className="mobile-nav-dialog" data-phase={phase} aria-label="메뉴"
      onAnimationEnd={(event) => { if (event.target === event.currentTarget && phase === "closing") finish(); }}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      onPointerDown={(event) => { if (event.pointerType === "touch" && event.target !== event.currentTarget) pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }}
      onPointerCancel={() => { pointer.current = null; }}
      onPointerUp={(event) => {
        const start = pointer.current;
        pointer.current = null;
        if (start?.id !== event.pointerId) return;
        const left = start.x - event.clientX;
        if (left > 55 && left > 1.4 * Math.abs(event.clientY - start.y)) close();
      }}>
      <div className="mobile-nav-heading">
        <strong>메뉴</strong>
        <button type="button" className="icon-button" aria-label="메뉴 닫기" autoFocus onClick={() => close()}><X size={20} aria-hidden="true" /></button>
      </div>
      <nav className="mobile-nav-links" aria-label="주요 메뉴">
        {groups.map(({ label, items }) => <section className="sidebar-group" aria-label={label} key={label}>
          <h2>{label}</h2>
          {items.map(([item, title, Icon]) => <button type="button" key={item} aria-current={current === item ? "page" : undefined} onClick={() => close(item)}>
            <Icon size={18} aria-hidden="true" />{title}
            {item === "friends" && alerts > 0 && <b className="menu-badge" aria-label={`새 알림 ${alerts}개`}>{alerts}</b>}
            {item === "quests" && (quests?.dailyAll || quests?.weeklyAll) && <b className="menu-badge" aria-label="퀘스트 묶음 완료">✓</b>}
          </button>)}
        </section>)}
      </nav>
    </dialog>
  </>;
}

function ProfileMenu({ route, server, profile, navigate }: { route: Route; server: string | null; profile: HeaderProfile; navigate: (route: Route) => void }) {
  const [open, setOpen] = useState(false);
  const name = useNickname();
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const look = profile.snapshot?.look ?? GUEST_LOOK;
  useEffect(() => { setOpen(false); }, [route, profile.signedIn]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open]);
  const choose = (target: Route) => {
    setOpen(false);
    trigger.current?.focus();
    if (target !== route) navigate(target);
  };
  return <div ref={anchor} className="top-profile" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="icon-button shell-icon top-profile-button" aria-label="프로필 메뉴" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <PlayerTag name={name} look={look} me compact />
    </button>
    <div id={id} className="top-profile-panel" hidden={!open}>
      <div className="top-profile-name"><PlayerTag name={name || "게스트"} look={look} me /></div>
      <button type="button" onClick={() => choose("profile")}><UserRound size={17} aria-hidden="true" /> 내 프로필</button>
      <button type="button" onClick={() => choose("account")}>
        {profile.signedIn ? <Settings size={17} aria-hidden="true" /> : <LogIn size={17} aria-hidden="true" />}
        {profile.signedIn ? "계정 설정" : "로그인"}
      </button>
      {profile.signedIn && server && <button type="button" onClick={() => {
        setOpen(false);
        trigger.current?.focus();
        void signOut(server).catch(() => undefined);
      }}><LogOut size={17} aria-hidden="true" /> 로그아웃</button>}
    </div>
  </div>;
}

export function TopBar({ route, server, profile, navigate, openSettings }: {
  route: Route; server: string | null; profile: HeaderProfile; navigate: (r: Route) => void; openSettings: () => void;
}) {
  const info = routes[route];
  const wallet = profile.snapshot?.wallet;
  const shopLinks = [{ route: "shop", title: "상점", Icon: Store }, { route: "inventory", title: "인벤토리", Icon: Backpack }] as const;
  const compactBalance = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });
  return (
    <header className={`shell-top shell-top-${info.shell}`} inert={route === "tutorial"}>
      <div className="shell-top-left">
        <Sidebar route={route} navigate={navigate} profile={profile} />
        <button type="button" className="wordmark" aria-label="홈으로" onClick={() => route !== "home" && navigate("home")}>
          <img src={`${import.meta.env.BASE_URL}icons/online-yacht.svg`} width="32" height="32" alt="" />
          <span>Online <b>Yacht</b></span>
        </button>
      </div>
      <div className="shell-top-right">
        {shopLinks.map(({ route: target, title, Icon }) => (
          <button type="button" key={target} className="header-shop icon-button shell-icon" aria-label={title}
            aria-current={target === route || (target === "shop" && route === "draw") ? "page" : undefined} title={title} onClick={() => target !== route && navigate(target)}>
            <Icon size={19} aria-hidden="true" /><span>{title}</span>
          </button>
        ))}
        {profile.signedIn && <div className="top-wallet" aria-label="보유 재화">
          {([{ label: "코인", value: wallet?.coins, Icon: Coins, kind: "coin" }, { label: "보석", value: wallet?.gems, Icon: Gem, kind: "gem" }]).map(({ label, value, Icon, kind }) => (
            <span key={kind} className={kind} role="group" title={`${label} ${value?.toLocaleString() ?? "–"}`} aria-label={`${label} ${value?.toLocaleString() ?? "–"}`}>
              <Icon size={15} aria-hidden="true" />
              <b aria-hidden="true" className="balance-full" data-testid={kind === "coin" ? "coins" : "gems"}>{value?.toLocaleString() ?? "–"}</b>
              <b aria-hidden="true" className="balance-compact">{value === undefined ? "–" : compactBalance.format(value)}</b>
            </span>
          ))}
        </div>}
        <button type="button" className="icon-button shell-icon" aria-label="설정" title="설정" aria-haspopup="dialog" onClick={openSettings}><Settings size={20} /></button>
        <ProfileMenu route={route} server={server} profile={profile} navigate={navigate} />
      </div>
    </header>
  );
}

export function LabNav({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  const items: Route[] = ["lab", ...labTools];
  return (
    <nav className="lab-nav" aria-label="연구실 메뉴">
      <div className="lab-nav-inner">
        <span className="lab-badge">고급 기능</span>
        {items.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            className={route === id ? "active" : ""}
            aria-current={route === id ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate(id);
            }}
          >
            {id === "lab" ? "개요" : routes[id].title}
          </a>
        ))}
      </div>
    </nav>
  );
}
