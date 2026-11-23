import { useEffect, useRef, useState } from "react";
import { FlaskConical, History, House, Maximize, Minimize, Settings, Volume2, VolumeX, X } from "lucide-react";
import { diceRenderer, updateSettings, useSettings, webglAvailable, type DiceQuality } from "../settings";
import { playSfx, unlockAudio } from "../sound";
import { labTools, routes, type Route } from "../routes";

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

export function SettingsDialog({ open, onClose, navigate, inGame = false }: { open: boolean; onClose: () => void; navigate: (r: Route) => void; inGame?: boolean }) {
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
  const go = (route: Route) => {
    onClose();
    navigate(route);
  };
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
        {inGame ? (
          <p className="settings-note settings-game-note">규칙·난이도·인원은 게임 화면의 ‘설정 변경’에서 바꿀 수 있어요.</p>
        ) : (
        <section className="settings-group settings-links" aria-label="더 보기">
          <button type="button" className="settings-link" onClick={() => go("records")}>
            <History size={17} /> 내 기록
          </button>
          <button type="button" className="settings-link" onClick={() => go("lab")}>
            <FlaskConical size={17} /> 연구실 <small>고급 기능</small>
          </button>
        </section>
        )}
        <p className="settings-footnote">설정은 이 브라우저에만 저장돼요.</p>
      </div>
    </dialog>
  );
}

/** Top bar: home on the left, sound/settings (and fullscreen in games) on the right. */
export function TopBar({ route, navigate, openSettings }: { route: Route; navigate: (r: Route) => void; openSettings: () => void }) {
  const info = routes[route];
  const home = route === "home";
  return (
    <header className={`shell-top shell-top-${info.shell}`}>
      <div className="shell-top-left">
        {home ? (
          <span className="wordmark" aria-label="YachtLab">
            Yacht<b>Lab</b>
          </span>
        ) : (
          <button type="button" className="shell-home" aria-label="홈으로" onClick={() => navigate("home")}>
            <House size={19} />
            <span>홈</span>
          </button>
        )}
      </div>
      {!home && <div className="shell-title">{info.title}</div>}
      <div className="shell-top-right">
        {home && (
          <>
            <button type="button" className="shell-pill" onClick={() => navigate("records")}>
              <History size={17} />
              <span>내 기록</span>
            </button>
            <button type="button" className="shell-pill" onClick={() => navigate("lab")}>
              <FlaskConical size={17} />
              <span>연구실</span>
            </button>
          </>
        )}
        <SoundToggle />
        {info.shell === "game" && <FullscreenToggle />}
        <button type="button" className="icon-button shell-icon" aria-label="설정" title="설정" aria-haspopup="dialog" onClick={openSettings}>
          <Settings size={20} />
        </button>
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
