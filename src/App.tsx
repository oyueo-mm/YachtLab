import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { BrandMark } from "./ui/BrandLoading";
import { type Match } from "./match";
import { type AnalysisSource } from "./ReplayViewer";
import { type Replay } from "./replay";
import LocalGame from "./LocalGame";
import MyGames from "./MyGames";
import Tutorial from "./play/Tutorial";
import { beginFirstGameTutorial } from "./play/tutorial-progress";
import HumanGame from "./play/HumanGame";
import SoloGame from "./play/SoloGame";
import { setOwnLook } from "./play/own-look";
import { useNickname } from "./identity/display-name";
import OnlineEntry from "./play/OnlineEntry";
import OnlineGame from "./play/OnlineGame";
import OnlineWatch from "./play/OnlineWatch";
import Profile from "./shell/Profile";
import MatchRewards, { type PendingReward } from "./shell/MatchRewards";
import { completeSignIn, session } from "./identity/account-client";
import { peekResume } from "./shell/login-resume";
import { syncAccountNickname } from "./identity/display-name";
import { FriendsPage, InviteToasts, refreshInbox, startInbox } from "./shell/Friends";
import { onlineServerUrl, roomFromUrl, setRoomInUrl, watchFromUrl } from "./online/client";
import { currentRoute, researchToolsEnabled, routes, type Route } from "./routes";
import { useProfileEconomy } from "./shell/profile-economy";
import { LabNav, SettingsDialog, TopBar } from "./shell/Chrome";
import InstallBanner from "./shell/InstallBanner";
import { Lobby, OfflineSelect, OnlineSoon } from "./shell/Lobby";
import { AiSetupScreen, LocalSetupScreen } from "./shell/Setup";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { installAudioUnlock } from "./sound";
import { installBgm, type BgmScene } from "./audio/bgm";
import { useBgmScene } from "./audio/useBgm";
import { ToastHost } from "./ui/kit";
import { installShortcuts, ShortcutHelpHost } from "./ui/shortcuts";
import { useUpdateAvailable } from "./version";
import { diceRenderer } from "./settings";
import { preloadDiceTableWhenIdle } from "./dice3d-loader";
import { LEGAL_VISIBLE, POLICY_ROUTES, type PolicyRoute } from "./legal/release";
import { aiMatchConfig, finalizeNames, getAiSetup, getLocalSetup, type AiMatchConfig, type LocalOrder } from "./setup";

// Research tools are a separate, lazily loaded chunk (see routes.ts "lab" tier).
const LabScreen = lazy(() => import("./lab/LabScreen"));
const ItemsPage = lazy(() => import("./shell/EconomyPages").then((module) => ({ default: module.ItemsPage })));
const QuestsPage = lazy(() => import("./shell/EconomyPages").then((module) => ({ default: module.QuestsPage })));
const LicensesPage = lazy(() => import("./legal/LicensesPage"));
// Draft policy texts: a production build without LEGAL_RELEASED does not contain this chunk at all.
const LegalPage = LEGAL_VISIBLE ? lazy(() => import("./legal/LegalPage")) : null;
const isPolicy = (page: Route): page is PolicyRoute => (POLICY_ROUTES as readonly string[]).includes(page);

type LocalConfig = { players: string[]; order: LocalOrder };
const localConfig = (): LocalConfig => {
  const setup = getLocalSetup();
  return { players: finalizeNames(setup.names, setup.count), order: setup.order };
};

const localAiConfig = () => {
  const setup = getAiSetup();
  return aiMatchConfig({ ...setup, research: setup.research && researchToolsEnabled() });
};

/** Background music by screen (a match, the review and the result dialog ask for their own). */
function sceneOf(page: Route): BgmScene {
  if (routes[page].shell === "lab") return "none";
  if (page === "play" || page === "pvp" || page === "solo") return "game";
  if (page === "online" || page === "online-room" || page === "spectate") return "lobby";
  if (page === "shop" || page === "inventory" || page === "draw") return "shop";
  return "home";
}

export default function App() {
  const tutorialDestination = useRef<"play" | "pvp" | "solo" | null>(null);
  const [page, setPage] = useState<Route>(currentRoute),
    [replay, setReplay] = useState<Match | null>(null),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [arenaSource, setArenaSource] = useState<{ replay: Replay; index: number } | null>(null),
    [analysisSource, setAnalysisSource] = useState<AnalysisSource | null>(null);
  // Game configs are fixed when a game starts (setup "게임 시작" or a #play / #pvp deep link),
  // so editing the setup later never changes a game that is already running.
  const [aiConfig, setAiConfig] = useState<AiMatchConfig>(localAiConfig);
  const [local, setLocal] = useState<LocalConfig>(localConfig);
  const [gameKey, setGameKey] = useState(0);
  // Online play needs a configured server; without one the online screen stays "준비 중".
  const [onlineServer] = useState(onlineServerUrl);
  const profile = useProfileEconomy(onlineServer, page === "home");
  // Offline screens (AI, local, 1인 플레이) show the player's own equipped dice and board too.
  useEffect(() => setOwnLook(profile.snapshot?.look ?? null), [profile.snapshot]);
  const nickname = useNickname();
  const [onlineCode, setOnlineCode] = useState<string | null>(roomFromUrl);
  const [quickIntro, setQuickIntro] = useState<string | null>(null);
  const [pendingReward, setPendingReward] = useState<PendingReward | null>(null);
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
      // A guest who signed in from the shop goes back to the same shop view (nothing is bought).
      const resume = r.ok ? peekResume() : null;
      if (resume) {
        history.replaceState(history.state, "", location.pathname + location.search + "#" + resume.route);
        enter(resume.route);
        return;
      }
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
  const historyKey = () => location.href + ":" + history.state?.idx;
  const handledHistory = useRef("");
  /** Switch screens without touching the URL (the URL already says where we are). */
  const enter = (p: Route) => {
    if (p === "online" || p === "online-room") setOnlineCode(roomFromUrl());
    else if (new URLSearchParams(location.search).has("room")) setRoomInUrl(null);
    if ((p === "play" || p === "pvp" || p === "solo") && pageRef.current !== p) {
      // Entering a game screen from elsewhere starts from the latest saved setup.
      if (p === "play") setAiConfig(localAiConfig());
      else setLocal(localConfig());
      setGameKey((k) => k + 1);
    }
    if (p !== "tutorial") tutorialDestination.current = null;
    pageRef.current = p;
    setPage(p);
  };
  const pushRoute = (p: Route, room?: string, replace = false) => {
    const url = new URL(location.href);
    url.hash = p;
    if (room) url.searchParams.set("room", room);
    else url.searchParams.delete("room");
    if (replace) history.replaceState({ ...history.state, idx: historyIndex.current }, "", url);
    else history.pushState({ idx: ++historyIndex.current }, "", url);
    handledHistory.current = historyKey();
  };
  const enterRoom = (code: string, quick?: boolean) => {
    setQuickIntro(quick ? code : null);
    setOnlineNotice("");
    // An invite becomes the room entry. Going back cannot reopen and auto-join the same invite.
    const replace = pageRef.current === "online-room" || (pageRef.current === "online" && roomFromUrl() === code);
    pushRoute("online-room", code, replace);
    enter("online-room");
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
  const startLocalGame = (destination: "play" | "pvp" | "solo") => {
    if (!beginFirstGameTutorial()) return go(destination);
    pushRoute(destination);
    tutorialDestination.current = destination;
    enter("tutorial");
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
    installBgm();
    installShortcuts();
    if (diceRenderer().startsWith("3d")) preloadDiceTableWhenIdle();
    if (typeof history.state?.idx !== "number") history.replaceState({ idx: historyIndex.current }, "");
    if (pageRef.current !== "online" && pageRef.current !== "online-room" && new URLSearchParams(location.search).has("room")) setRoomInUrl(null);
    handledHistory.current = historyKey();
    // Back / forward / a hash typed in the address bar. Leaving a game in progress asks first;
    // cancelling steps the history back to the game entry instead of adding a new one.
    const fn = () => {
      if (handledHistory.current === historyKey()) return;
      handledHistory.current = historyKey();
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
      handledHistory.current = historyKey();
    };
    window.addEventListener("popstate", fn);
    window.addEventListener("hashchange", fn);
    // A hash changed between the first render and these listeners (a deep link or a quick link while the
    // app was still starting) would otherwise be lost: follow it now.
    const early = currentRoute();
    if (early !== pageRef.current) enter(early);
    return () => {
      window.removeEventListener("popstate", fn);
      window.removeEventListener("hashchange", fn);
    };
  }, []);
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [page]);
  const shell = routes[page].shell;
  useBgmScene(sceneOf(page));
  // Online screens need the latest page (server protocol); an old cached page asks for a reload.
  const updateAvailable = useUpdateAvailable(page === "online" || page === "online-room" || page === "spectate" ? page : null);
  const progress = (value: boolean) => {
    inProgress.current = value;
  };
  return (
    <div className={`app-shell shell-${shell}`}>
      <TopBar route={page} server={onlineServer} profile={profile} navigate={navigate} openSettings={() => setSettingsOpen(true)} />
      {shell === "lab" && <LabNav route={page} navigate={navigate} />}
      <main className={`main page-${page}`}>
        {/* Friend invites on any page except during a running game (not to interrupt play). */}
        {page !== "tutorial" && !(page === "online-room" && inProgress.current) && page !== "play" && page !== "pvp" && page !== "solo" && (
          <InviteToasts
            server={onlineServer}
            onJoined={enterRoom}
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
        <InstallBanner active={page === "home"} />
        {page === "home" && onlineServer && pendingReward && <MatchRewards
          key={pendingReward.matchId}
          server={onlineServer}
          pending={pendingReward}
          consume={() => setPendingReward(null)}
        />}
        {page === "home" && <Lobby navigate={navigate} />}
        {page === "tutorial" && <Tutorial onExit={() => {
          if (tutorialDestination.current) enter(tutorialDestination.current);
          else go("home");
        }} />}
        {page === "practice" && <Tutorial practiceOnly onExit={() => go("offline")} />}
        {page === "offline" && <OfflineSelect navigate={navigate} startSolo={() => startLocalGame("solo")} />}
        {(page === "online" || page === "online-room") && !onlineServer && <OnlineSoon navigate={navigate} />}
        {page === "online" && onlineServer && (
          <>
            {onlineNotice && (
              <p className="online-notice" role="status">
                {onlineNotice}
              </p>
            )}
            <OnlineEntry
              key={onlineCode ?? "online"}
              server={onlineServer}
              onBack={() => navigate("home")}
              onAi={() => navigate("play-setup")}
              onEnter={enterRoom}
            />
          </>
        )}
        {page === "online-room" && onlineServer && onlineCode && (
          <OnlineGame
            key={onlineCode}
            server={onlineServer}
            code={onlineCode}
            quickIntro={quickIntro === onlineCode}
            onFinished={(matchId) => {
              const account = session();
              if (account) setPendingReward({ matchId, account });
            }}
            onProgress={progress}
            onLeave={(message, destination) => {
              inProgress.current = false;
              setOnlineNotice(message ?? "");
              setOnlineCode(null);
              setQuickIntro(null);
              setRoomInUrl(null);
              go(destination ?? "online");
            }}
          />
        )}
        {(page === "profile" || page === "account") && <Profile key={JSON.stringify([session(), profileNotice])} server={onlineServer} notice={profileNotice} snapshot={profile.snapshot} accountSettings={page === "account"} />}
        {(page === "shop" || page === "inventory" || page === "draw" || page === "quests" || page === "achievements") && (
          <Suspense fallback={<p className="econ-note" role="status"><BrandMark /> 불러오는 중…</p>}>
            {(page === "shop" || page === "inventory" || page === "draw") && <ItemsPage key={session() ?? "guest"} server={onlineServer} go={navigate} route={page} />}
            {(page === "quests" || page === "achievements") && <QuestsPage key={session() ?? "guest"} server={onlineServer} go={navigate} achievements={page === "achievements"} />}
          </Suspense>
        )}
        {page === "friends" && <FriendsPage server={onlineServer} go={navigate} />}
        {(page === "licenses" || (LegalPage && isPolicy(page))) && (
          <Suspense fallback={<p className="econ-note" role="status"><BrandMark /> 불러오는 중…</p>}>
            {page === "licenses" && <LicensesPage />}
            {LegalPage && isPolicy(page) && <LegalPage route={page} />}
          </Suspense>
        )}
        {page === "spectate" && !onlineServer && <OnlineSoon navigate={navigate} />}
        {page === "spectate" && onlineServer && (watchTarget ? <OnlineWatch key={watchTarget.code + watchTarget.key} server={onlineServer} code={watchTarget.code} watchKey={watchTarget.key} onLeave={() => navigate("home")} /> : (
          <p className="online-connecting" role="alert">
            관전 링크가 올바르지 않아요.
          </p>
        ))}
        {page === "online-room" && onlineServer && !onlineCode && <OnlineEntry server={onlineServer} onBack={() => navigate("home")} onEnter={enterRoom} />}
        {page === "play-setup" && <AiSetupScreen onBack={() => navigate("offline")} onStart={() => startLocalGame("play")} />}
        {page === "pvp-setup" && <LocalSetupScreen onBack={() => navigate("offline")} onStart={() => startLocalGame("pvp")} />}
        {page === "play" && <HumanGame key={gameKey} config={aiConfig} onBranch={branch} onAnalyze={analyze} onChangeSetup={() => go("play-setup")} onLeave={() => go("home")} onProgress={progress} />}
        {page === "pvp" && <LocalGame key={gameKey} players={local.players} order={local.order} onChangeSetup={() => go("pvp-setup")} onLeave={() => go("home")} onProgress={progress} />}
        {page === "solo" && <SoloGame key={gameKey} name={nickname || getAiSetup().name || "나"} server={onlineServer} onLeave={() => go("offline")} onRecords={() => go("records")} onProgress={progress} />}
        {page === "records" && <MyGames server={onlineServer} onBranch={branch} onAnalyze={analyze} />}
        {shell === "lab" && (
          <Suspense
            fallback={
              <p className="lab-loading" role="status">
                <BrandMark /> 연구실을 불러오는 중
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
      <ShortcutHelpHost />
      <ToastHost />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} inGame={shell === "game"} />
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
