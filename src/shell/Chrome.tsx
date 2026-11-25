import { useEffect, useId, useRef, useState } from "react";
import { Backpack, Coins, Dices, Gem, Globe, History, House, ListChecks, LogIn, LogOut, Maximize, Menu, Minimize, Settings, Store, Trophy, UserRound, UsersRound, Volume2, VolumeX, X } from "lucide-react";
import { diceRenderer, updateSettings, useSettings, webglAvailable, type DiceQuality } from "../settings";
import { playSfx, unlockAudio } from "../sound";
import { labTools, routes, type Route } from "../routes";
import { signOut } from "../identity/account-client";
import { useNickname } from "../identity/display-name";
import { GUEST_LOOK } from "../economy/live/catalog";
import { PlayerTag } from "../play/Looks";
import type { useProfileEconomy } from "./profile-economy";
import "./navigation.css";
import { useInbox } from "./Friends";

export function SoundToggle() {
  const { muted } = useSettings();
  return (
    <button
      type="button"
      className="icon-button shell-icon"
      aria-label={muted ? "효과음 켜기" : "효과음 끄기"}
      title={muted ? "효과음 켜기" : "효과음 끄기"}
      onClick={() => {
        updateSettings({ muted: !muted });
        if (muted) {
          unlockAudio();
          playSfx("hold");
        }
      }}
    >
      {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
    </button>
  );
}

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

export function SettingsDialog({ open, onClose, inGame = false }: { open: boolean; onClose: () => void; inGame?: boolean }) {
  const settings = useSettings();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const systemReduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const renderer = diceRenderer(settings);
  const qualityLabel: Record<DiceQuality, string> = { auto: "자동", "3d-high": "고화질", "3d": "성능 우선", "2.5d": "간단 (2.5D)" };
  return (
    <dialog
      ref={ref}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-sheet">
        <div className="settings-heading">
          <h2 id="settings-title">설정</h2>
          <button type="button" className="icon-button" aria-label="설정 닫기" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <section className="settings-group" aria-label="사운드">
          <label className="settings-row">
            <span>
              <strong>효과음</strong>
              <small>주사위·점수·승패 효과음</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="효과음"
              checked={!settings.muted}
              onChange={(e) => {
                updateSettings({ muted: !e.target.checked });
                if (e.target.checked) unlockAudio();
              }}
            />
          </label>
          <label className="settings-row settings-volume">
            <span>
              <strong>음량</strong>
              <small>{Math.round(settings.volume * 100)}%</small>
            </span>
            <input
              type="range"
              aria-label="효과음 음량"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.volume * 100)}
              disabled={settings.muted}
              onChange={(e) => updateSettings({ volume: Number(e.target.value) / 100 })}
            />
          </label>
          <button
            type="button"
            className="secondary settings-preview"
            disabled={settings.muted || settings.volume === 0}
            onClick={() => {
              unlockAudio();
              playSfx("throw");
              playSfx("impact", { delay: 0.16, intensity: 0.9 });
              playSfx("impact", { delay: 0.3, intensity: 0.45 });
              playSfx("settle", { delay: 0.42, intensity: 0.4 });
            }}
          >
            미리 듣기
          </button>
        </section>
        <section className="settings-group" aria-label="화면 효과">
          <label className="settings-row">
            <span>
              <strong>주사위 애니메이션 품질</strong>
              <small>{webglAvailable() ? "3D는 실제 물리로 굴러요" : "이 브라우저는 3D를 지원하지 않아 2.5D로 표시해요"}</small>
            </span>
            <select aria-label="주사위 애니메이션 품질" value={settings.diceQuality} onChange={(e) => updateSettings({ diceQuality: e.target.value as DiceQuality })}>
              {(Object.keys(qualityLabel) as DiceQuality[]).map((q) => (
                <option key={q} value={q} disabled={q.startsWith("3d") && !webglAvailable()}>
                  {qualityLabel[q]}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span>
              <strong>모션 간단히</strong>
              <small>짧고 가벼운 2.5D 연출로 바꿔요</small>
            </span>
            <input type="checkbox" role="switch" aria-label="모션 간단히" checked={settings.reducedEffects} onChange={(e) => updateSettings({ reducedEffects: e.target.checked })} />
          </label>
          <label className="settings-row">
            <span>
              <strong>상대 아이템 효과</strong>
              <small>온라인 대전에서 상대가 장착한 애니메이션·효과음을 보여 줘요</small>
            </span>
            <input type="checkbox" role="switch" aria-label="상대 아이템 효과" checked={settings.opponentFx} onChange={(e) => updateSettings({ opponentFx: e.target.checked })} />
          </label>
          <p className="settings-note" data-renderer={renderer}>
            {systemReduced
              ? "기기의 '동작 줄이기' 설정이 켜져 있어 주사위가 움직이지 않고 바로 결과를 보여 줘요."
              : renderer === "2.5d"
                ? "2.5D 주사위 연출을 사용 중이에요."
                : renderer === "3d-high"
                  ? settings.diceQuality === "auto"
                    ? "3D 물리 주사위를 선명하게 그리고, 기기가 버거워하면 자동으로 가볍게 바꿔요."
                    : "3D 물리 주사위(고화질)를 사용 중이에요."
                  : "3D 물리 주사위(성능 우선)를 사용 중이에요."}
          </p>
        </section>
        {inGame && <div className="settings-group">
          <p className="settings-note settings-game-note">규칙·난이도·인원은 게임 화면의 ‘설정 변경’에서 바꿀 수 있어요.</p>
          <FullscreenToggle />
        </div>}
        <p className="settings-footnote">설정은 이 브라우저에만 저장돼요.</p>
      </div>
    </dialog>
  );
}

const groups = [
  { label: "게임", items: [["home", "홈", House], ["online", "온라인 대전", Globe], ["offline", "오프라인 대전", Dices], ["practice", "한 차례 연습하기", Dices]] },
  { label: "활동", items: [["friends", "친구", UsersRound], ["records", "내 기록", History], ["quests", "퀘스트", ListChecks], ["achievements", "업적", Trophy]] },
  { label: "아이템", items: [["shop", "상점", Store], ["inventory", "인벤토리", Backpack]] },
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
    ["play", "pvp", "play-setup", "pvp-setup"].includes(route) ? "offline" : route;

  const close = (next?: Route) => {
    if (phase !== "open") return;
    target.current = next && next !== route ? next : null;
    setPhase("closing");
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
  return (
    <header className={`shell-top shell-top-${info.shell}`} inert={route === "tutorial"}>
      <div className="shell-top-left">
        <Sidebar route={route} navigate={navigate} profile={profile} />
        <button type="button" className="wordmark" aria-label="홈으로" onClick={() => route !== "home" && navigate("home")}>Yacht<b>Lab</b></button>
      </div>
      {route !== "home" && <div className="shell-title">{info.title}</div>}
      <div className="shell-top-right">
        {profile.signedIn && <div className="top-wallet" aria-label="보유 재화">
          {([{ label: "코인", value: wallet?.coins, Icon: Coins }, { label: "보석", value: wallet?.gems, Icon: Gem }]).map(({ label, value, Icon }) => (
            <span key={label} title={`${label} ${value?.toLocaleString() ?? "–"}`} aria-label={`${label} ${value?.toLocaleString() ?? "–"}`}>
              <Icon size={15} aria-hidden="true" /><b>{value?.toLocaleString() ?? "–"}</b>
            </span>
          ))}
        </div>}
        <SoundToggle />
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
