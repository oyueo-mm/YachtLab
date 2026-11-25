import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { type Match } from "./match";
import { type AnalysisSource } from "./ReplayViewer";
import { type Replay } from "./replay";
import LocalGame from "./LocalGame";
import MyGames from "./MyGames";
import Tutorial from "./play/Tutorial";
import HumanGame from "./play/HumanGame";
import OnlineEntry from "./play/OnlineEntry";
import OnlineGame from "./play/OnlineGame";
import OnlineWatch from "./play/OnlineWatch";
import Profile from "./shell/Profile";
import { AchievementsPage, InventoryPage, QuestsPage, ShopPage } from "./shell/EconomyPages";
import { completeSignIn } from "./identity/account-client";
import { syncAccountNickname } from "./identity/display-name";
import { FriendsPage, InviteToasts, refreshInbox, startInbox } from "./shell/Friends";
import { onlineServerUrl, roomFromUrl, setRoomInUrl, watchFromUrl } from "./online/client";
import { currentRoute, routes, type Route } from "./routes";
import { LabNav, SettingsDialog, TopBar } from "./shell/Chrome";
import { Lobby, OfflineSelect, OnlineSoon } from "./shell/Lobby";
import { AiSetupScreen, LocalSetupScreen } from "./shell/Setup";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { installAudioUnlock } from "./sound";
import { useUpdateAvailable } from "./version";
import { diceRenderer } from "./settings";
import { preloadDiceTableWhenIdle } from "./dice3d-loader";
import { aiMatchConfig, finalizeNames, getAiSetup, getLocalSetup, type AiMatchConfig, type LocalOrder } from "./setup";

// Research tools are a separate, lazily loaded chunk (see routes.ts "lab" tier).
const LabScreen = lazy(() => import("./lab/LabScreen"));

type LocalConfig = { players: string[]; order: LocalOrder };
const localConfig = (): LocalConfig => {
  const setup = getLocalSetup();
  return { players: finalizeNames(setup.names, setup.count), order: setup.order };
};

export default function App() {
  const [page, setPage] = useState<Route>(currentRoute),
    [replay, setReplay] = useState<Match | null>(null),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [arenaSource, setArenaSource] = useState<{ replay: Replay; index: number } | null>(null),
    [analysisSource, setAnalysisSource] = useState<AnalysisSource | null>(null);
  // Game configs are fixed when a game starts (setup "게임 시작" or a #play / #pvp deep link),
  // so editing the setup later never changes a game that is already running.
  const [aiConfig, setAiConfig] = useState<AiMatchConfig>(() => aiMatchConfig(getAiSetup()));
  const [local, setLocal] = useState<LocalConfig>(localConfig);
  const [gameKey, setGameKey] = useState(0);
  // Online play needs a configured server; without one the online screen stays "준비 중".
  const [onlineServer] = useState(onlineServerUrl);
  const [onlineCode, setOnlineCode] = useState<string | null>(roomFromUrl);
  const [onlineNotice, setOnlineNotice] = useState("");
  const [watchTarget] = useState(watchFromUrl);
  const [profileNotice, setProfileNotice] = useState("");
  // Members: friend requests and room invites (checked once a minute while the site is visible).
  useEffect(() => startInbox(onlineServer), [onlineServer]);
  // …and right away when the home menu or the friends page opens (badge / invites without waiting).
  useEffect(() => {
    if (onlineServer && (page === "home" || page === "friends" || page === "online")) void refreshInbox(onlineServer);
  }, [page, onlineServer]);
  // Members: the account nickname is the one used everywhere (copied to this device on start / sign-in).
  useEffect(() => {
    const sync = () => void syncAccountNickname(onlineServer);
    sync();
    window.addEventListener("yachtlab-session", sync);
    return () => window.removeEventListener("yachtlab-session", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Coming back from Google sign-in (#login=… / #login-error=…): finish it, then show the profile.
  useEffect(() => {
    void completeSignIn(onlineServer).then((r) => {
      if (!r) return;
      setProfileNotice(r.message);
      enter("profile");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const inProgress = useRef(false);
  const [leaveTo, setLeaveTo] = useState<Route | null>(null);
  // Browser history: every in-app move pushes an entry tagged with an index, so back/forward can be
  // told apart and undone exactly (no duplicate entries) when the player cancels leaving a game.
  const historyIndex = useRef(typeof history.state?.idx === "number" ? (history.state.idx as number) : 0);
  const pageRef = useRef(page);
  pageRef.current = page;
  const ignoreNextHash = useRef(false);
  const pendingHistory = useRef<{ idx: number; undo: () => void } | null>(null);
  /** Switch screens without touching the URL (the URL already says where we are). */
  const enter = (p: Route) => {
    if ((p === "play" || p === "pvp") && pageRef.current !== p) {
      // Entering a game screen from elsewhere starts from the latest saved setup.
      if (p === "play") setAiConfig(aiMatchConfig(getAiSetup()));
      else setLocal(localConfig());
      setGameKey((k) => k + 1);
    }
    pageRef.current = p;
    setPage(p);
  };
  const pushRoute = (p: Route) => {
    historyIndex.current += 1;
    history.pushState({ idx: historyIndex.current }, "", "#" + p);
  };
  const go = (p: Route) => {
    if (p === "watch") {
      setArenaSource(null);
      setReplay(null);
    }
    if (p === "analysis") setAnalysisSource(null);
    pushRoute(p);
    enter(p);
  };
  /** Leaving a game in progress asks first (top-bar home, settings links). */
  const navigate = (p: Route) => {
    if (routes[page].shell === "game" && inProgress.current && p !== page) setLeaveTo(p);
    else go(p);
  };
  const branch = (r: Replay, index: number) => {
    setReplay(null);
    pushRoute("watch");
    enter("watch");
    setArenaSource({ replay: r, index });
  };
  const analyze = (source: AnalysisSource) => {
    pushRoute("analysis");
    enter("analysis");
    setAnalysisSource(source);
  };
  useEffect(() => {
    installAudioUnlock();
    if (diceRenderer().startsWith("3d")) preloadDiceTableWhenIdle();
    if (typeof history.state?.idx !== "number") history.replaceState({ idx: historyIndex.current }, "");
    // Back / forward / a hash typed in the address bar. Leaving a game in progress asks first;
    // cancelling steps the history back to the game entry instead of adding a new one.
    const fn = () => {
      const state = history.state as { idx?: number } | null;
      if (ignoreNextHash.current) {
        ignoreNextHash.current = false;
        if (typeof state?.idx === "number") historyIndex.current = state.idx;
        return;
      }
      const next = currentRoute();
      let idx: number, undo: () => void;
      if (typeof state?.idx === "number") {
        idx = state.idx;
        undo = idx < historyIndex.current ? () => history.forward() : () => history.back();
      } else {
        idx = historyIndex.current + 1;
        history.replaceState({ idx }, "");
        undo = () => history.back();
      }
      if (routes[pageRef.current].shell === "game" && inProgress.current && next !== pageRef.current) {
        pendingHistory.current = { idx, undo };
        setLeaveTo(next);
        return;
      }
      historyIndex.current = idx;
      enter(next);
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    window.scrollTo?.(0, 0);
    document.title = page === "home" ? "YachtLab" : routes[page].title + " · YachtLab";
  }, [page]);
  const shell = routes[page].shell;
  // Online screens need the latest page (server protocol); an old cached page asks for a reload.
  const updateAvailable = useUpdateAvailable(page === "online" || page === "online-room" || page === "spectate" ? page : null);
  const progress = (value: boolean) => {
    inProgress.current = value;
  };
  return (
    <div className={`app-shell shell-${shell}`}>
      <TopBar route={page} navigate={navigate} openSettings={() => setSettingsOpen(true)} />
      {shell === "lab" && <LabNav route={page} navigate={navigate} />}
      <main className={`main page-${page}`}>
        {/* Friend invites on any page except during a running game (not to interrupt play). */}
        {!(page === "online-room" && inProgress.current) && page !== "play" && page !== "pvp" && (
          <InviteToasts
            server={onlineServer}
            onJoined={(code) => {
              setOnlineCode(code);
              enter("online-room");
            }}
          />
        )}
        {updateAvailable && (page === "online" || page === "online-room" || page === "spectate" || page === "home") && (
          <p className="update-banner" role="status">
            새 버전이 나왔어요. 새로고침하면 최신 기능을 쓸 수 있어요.
            <button type="button" className="secondary" onClick={() => location.reload()}>
              새로고침
            </button>
          </p>
        )}
        {page === "home" && <Lobby navigate={navigate} server={onlineServer} />}
        {page === "tutorial" && <Tutorial onHome={() => navigate("home")} />}
        {page === "offline" && <OfflineSelect navigate={navigate} />}
        {(page === "online" || page === "online-room") && !onlineServer && <OnlineSoon navigate={navigate} />}
        {page === "online" && onlineServer && (
          <>
            {onlineNotice && (
              <p className="online-notice" role="status">
                {onlineNotice}
              </p>
            )}
            <OnlineEntry
              key={gameKey}
              server={onlineServer}
              onBack={() => navigate("home")}
              onAi={() => navigate("play-setup")}
              onEnter={(code) => {
                setOnlineNotice("");
                setOnlineCode(code);
                go("online-room");
              }}
            />
          </>
        )}
        {page === "online-room" && onlineServer && onlineCode && (
          <OnlineGame
            key={onlineCode}
            server={onlineServer}
            code={onlineCode}
            onProgress={progress}
            onLeave={(message) => {
              inProgress.current = false;
              setOnlineNotice(message ?? "");
              setOnlineCode(null);
              setRoomInUrl(null);
              go("online");
            }}
          />
        )}
        {page === "profile" && <Profile key={profileNotice} server={onlineServer} notice={profileNotice} />}
        {page === "shop" && <ShopPage server={onlineServer} go={navigate} />}
        {page === "inventory" && <InventoryPage server={onlineServer} go={navigate} />}
        {page === "quests" && <QuestsPage server={onlineServer} go={navigate} />}
        {page === "achievements" && <AchievementsPage server={onlineServer} go={navigate} />}
        {page === "friends" && <FriendsPage server={onlineServer} go={navigate} />}
        {page === "spectate" && !onlineServer && <OnlineSoon navigate={navigate} />}
        {page === "spectate" && onlineServer && (watchTarget ? <OnlineWatch key={watchTarget.code + watchTarget.key} server={onlineServer} code={watchTarget.code} watchKey={watchTarget.key} onLeave={() => navigate("home")} /> : (
          <p className="online-connecting" role="alert">
            관전 링크가 올바르지 않아요.
          </p>
        ))}
        {page === "online-room" && onlineServer && !onlineCode && <OnlineEntry server={onlineServer} onBack={() => navigate("home")} onEnter={(code) => { setOnlineCode(code); enter("online-room"); }} />}
        {page === "play-setup" && <AiSetupScreen onBack={() => navigate("offline")} onStart={() => go("play")} />}
        {page === "pvp-setup" && <LocalSetupScreen onBack={() => navigate("offline")} onStart={() => go("pvp")} />}
        {page === "play" && <HumanGame key={gameKey} config={aiConfig} onBranch={branch} onAnalyze={analyze} onChangeSetup={() => go("play-setup")} onProgress={progress} />}
        {page === "pvp" && <LocalGame key={gameKey} players={local.players} order={local.order} onChangeSetup={() => go("pvp-setup")} onProgress={progress} />}
        {page === "records" && <MyGames onBranch={branch} onAnalyze={analyze} />}
        {shell === "lab" && (
          <Suspense
            fallback={
              <p className="lab-loading" role="status">
                <LoaderCircle size={16} className="spin" /> 연구실을 불러오는 중
              </p>
            }
          >
            <LabScreen
              route={page}
              navigate={navigate}
              replay={replay}
              clearReplay={() => setReplay(null)}
              openReplay={(match) => {
                setArenaSource(null);
                setReplay(match);
                pushRoute("watch");
                enter("watch");
              }}
              arenaSource={arenaSource}
              analysisSource={analysisSource}
              onBranch={branch}
              onAnalyze={analyze}
            />
          </Suspense>
        )}
      </main>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} navigate={navigate} inGame={shell === "game"} />
      <ConfirmDialog
        open={leaveTo !== null}
        title="게임을 나갈까요?"
        message="진행 중인 경기는 저장되지 않아요."
        confirmLabel="나가기"
        onCancel={() => {
          setLeaveTo(null);
          const pending = pendingHistory.current;
          pendingHistory.current = null;
          if (pending) {
            ignoreNextHash.current = true;
            pending.undo();
          }
        }}
        onConfirm={() => {
          const target = leaveTo;
          setLeaveTo(null);
          inProgress.current = false;
          const pending = pendingHistory.current;
          pendingHistory.current = null;
          if (!target) return;
          if (pending) {
            historyIndex.current = pending.idx;
            enter(target);
          } else go(target);
        }}
      />
    </div>
  );
}
