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
import { useBackgroundMatch } from "./online/useBackgroundMatch";
import { countdownFor } from "./online/match-flow";
import { MatchPopup } from "./play/MatchPopup";
import { ImportantNotice } from "./shell/ImportantNotice";
import { ActivityVisible } from "./shell/activity-visible";
import OnlineGame from "./play/OnlineGame";
import OnlineWatch from "./play/OnlineWatch";
import Profile from "./shell/Profile";
import MatchRewards from "./shell/MatchRewards";
import { addNotice, dropNotices, noticesFor, type PendingNotice } from "./match-result/reward-notices";
import { completeSignIn, session } from "./identity/account-client";
import { peekResume } from "./shell/login-resume";
import { syncAccountNickname } from "./identity/display-name";
import { FriendsPage, InviteToasts, refreshInbox, startInbox } from "./shell/Friends";
import { onlineServerUrl, roomFromUrl, setRoomInUrl, watchFromUrl, watchLink } from "./online/client";
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
import { aiMatchConfig, finalizeNames, getAiSetup, getLocalSetup, type AiMatchConfig, type LocalOrder } from "./setup";

// Research tools are a separate, lazily loaded chunk (see routes.ts "lab" tier).
const LabScreen = lazy(() => import("./lab/LabScreen"));
const ItemsPage = lazy(() => import("./shell/EconomyPages").then((module) => ({ default: module.ItemsPage })));
const AdminConsole = lazy(() => import("./admin/AdminConsole"));
const SuggestionsPage = lazy(() => import("./engagement/EngagementPages").then((module) => ({ default: module.SuggestionsPage })));
const MailboxPage = lazy(() => import("./engagement/EngagementPages").then((module) => ({ default: module.MailboxPage })));
const DailyPage = lazy(() => import("./daily/DailyPage"));
const QuestsPage = lazy(() => import("./shell/EconomyPages").then((module) => ({ default: module.QuestsPage })));
const RewardsPage = lazy(() => import("./rewards/RewardsPage"));

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
  // H-A3-3: every finished online match keeps its home notice (deduplicated by matchId, per account).
  const [pendingRewards, setPendingRewards] = useState<PendingNotice[]>([]);
  const [onlineNotice, setOnlineNotice] = useState("");
  const [watchTarget, setWatchTarget] = useState(watchFromUrl);
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
  const [suspended, setSuspended] = useState<{ route: Route; scroll: number; inProgress: boolean } | null>(null);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const preserve = (route: Route) => ["play", "pvp", "solo", "shop", "inventory", "draw", "quests", "achievements", "records", "profile"].includes(route);
  const ignoreNextHash = useRef(false);
  const pendingHistory = useRef<{ idx: number; undo: () => void } | null>(null);
  const historyKey = () => location.href + ":" + history.state?.idx;
  const handledHistory = useRef("");
  /** Switch screens without touching the URL (the URL already says where we are). */
  const enter = (p: Route) => {
    if (p === "online" || p === "online-room") setOnlineCode(roomFromUrl());
    else if (new URLSearchParams(location.search).has("room")) setRoomInUrl(null);
    if (suspendedRef.current?.route === p) {
      inProgress.current = suspendedRef.current.inProgress;
      setSuspended(null);
    } else if ((p === "play" || p === "pvp" || p === "solo") && pageRef.current !== p) {
      // Entering a game screen from elsewhere starts from the latest saved setup.
      if (p === "play") setAiConfig(localAiConfig());
      else setLocal(localConfig());
      setGameKey((k) => k + 1);
      if (suspendedRef.current) setSuspended(null);
    }
    if (p === "spectate") setWatchTarget(watchFromUrl());
    if (p !== "tutorial") tutorialDestination.current = null;
    pageRef.current = p;
    setPage(p);
  };
  const pushRoute = (p: Route, room?: string, replace = false) => {
    const url = new URL(location.href);
    url.hash = p;
    if (p !== "spectate") {
      url.searchParams.delete("watch");
      url.searchParams.delete("k");
    }
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
    if (pendingOnline.current && pendingOnline.current !== code) return;
    const replace = pageRef.current === "online-room" || (pageRef.current === "online" && roomFromUrl() === code);
    pushRoute("online-room", code, replace);
    enter("online-room");
  };
  const pendingOnline = useRef<string | null>(null);
  const match = useBackgroundMatch(onlineServer, (found) => {
    const route = pageRef.current;
    pendingOnline.current = found.code;
    if (preserve(route)) {
      setSuspended({ route, scroll: window.scrollY, inProgress: inProgress.current });
    }
    setLeaveTo(null);
    pendingHistory.current = null;
    inProgress.current = false;
    enterRoom(found.code, true);
  }, () => countdownFor(inProgress.current && preserve(pageRef.current)));
  const enterWatch = (code: string, key: string) => {
    if (pageRef.current !== "online" || pendingOnline.current) return;
    history.pushState({ idx: ++historyIndex.current }, "", watchLink(code, key));
    handledHistory.current = historyKey();
    enter("spectate");
  };
  const restoreActivity = () => {
    const previous = suspendedRef.current;
    if (!previous) return false;
    // Keep the same mounted game and its setup, even if the normal route has since changed.
    pushRoute(previous.route, undefined, true);
    pageRef.current = previous.route;
    setPage(previous.route);
    inProgress.current = previous.inProgress;
    setSuspended(null);
    requestAnimationFrame(() => window.scrollTo(0, previous.scroll));
    return true;
  };
  const activity = (route: Route | readonly Route[], children: React.ReactNode) => {
    const matches = (p: Route) => typeof route === "string" ? route === p : route.includes(p);
    const visible = matches(page);
    if (!visible && (!suspended || !matches(suspended.route))) return null;
    return (
      <div className="activity-scope" hidden={!visible} inert={!visible} style={{ display: visible ? "contents" : "none" }}>
        <ActivityVisible.Provider value={visible}>{children}</ActivityVisible.Provider>
      </div>
    );
  };
  const go = (p: Route) => {
    if (p === "watch") {
      setArenaSource(null);
      setReplay(null);
    }
    if (p === "analysis") setAnalysisSource(null);
    if ((p === "play" || p === "pvp" || p === "solo") && suspendedRef.current?.route !== p) setSuspended(null);
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
    if (pendingOnline.current && p !== page) return;
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
      if (pendingOnline.current && next !== pageRef.current) {
        ignoreNextHash.current = true;
        undo();
        return;
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
        {/* UI-1 §11: ADMIN-1 important notice (flag features.notices), never during a game. */}
        {(shell === "lobby" || shell === "page") && page !== "tutorial" && <ImportantNotice server={onlineServer} />}
        <MatchPopup match={match} onAi={() => navigate("play-setup")} onRoom={(code) => enterRoom(code)} offerAfterMs={30_000} practicePaused={inProgress.current && preserve(page)} />
        {suspended && page !== "online-room" && <button type="button" className="secondary" onClick={restoreActivity}>이전 활동으로 돌아가기</button>}
        <InstallBanner active={page === "home"} />
        {page === "home" && onlineServer && noticesFor(pendingRewards, session()).length > 0 && <MatchRewards
          key={noticesFor(pendingRewards, session()).map((n) => n.matchId).join(",")}
          server={onlineServer}
          pending={noticesFor(pendingRewards, session())}
          consume={(ids) => setPendingRewards((list) => dropNotices(list, ids))}
        />}
        {page === "home" && <Lobby navigate={navigate} server={onlineServer} signedIn={profile.signedIn} />}
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
              match={match}
              onWatch={enterWatch}
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
            entryTimeoutMs={pendingOnline.current === onlineCode ? 20_000 : undefined}
            onEntered={() => {
              if (pendingOnline.current !== onlineCode) return;
              pendingOnline.current = null;
              match.entered();
            }}
            onFinished={(matchId) => {
              const account = session();
              if (account) setPendingRewards((list) => addNotice(list, { matchId, account, at: Date.now() }));
            }}
            onProgress={progress}
            onLeave={(message, destination) => {
              inProgress.current = false;
              if (pendingOnline.current === onlineCode) {
                pendingOnline.current = null;
                match.entryFailed(message ?? "경기에 입장하지 못했어요.", onlineCode);
              }
              setOnlineNotice(message ?? "");
              setOnlineCode(null);
              setQuickIntro(null);
              setRoomInUrl(null);
              if (!restoreActivity()) go(destination ?? "online");
            }}
          />
        )}
        {activity("profile", <Profile key={JSON.stringify([session(), profileNotice])} server={onlineServer} notice={profileNotice} snapshot={profile.snapshot} accountSettings={false} />)}
        {page === "account" && <Profile key={JSON.stringify([session(), profileNotice])} server={onlineServer} notice={profileNotice} snapshot={profile.snapshot} accountSettings />}
        <Suspense fallback={["shop", "inventory", "draw", "quests", "achievements"].includes(page) ? <p className="econ-note" role="status"><BrandMark /> 불러오는 중…</p> : null}>
          {activity(["shop", "inventory", "draw"], <ItemsPage key={session() ?? "guest"} server={onlineServer} go={navigate}
            route={page === "shop" || page === "inventory" || page === "draw" ? page :
              suspended?.route === "inventory" || suspended?.route === "draw" ? suspended.route : "shop"} />)}
          {activity(["quests", "achievements"], <QuestsPage key={session() ?? "guest"} server={onlineServer} go={navigate}
            achievements={page === "achievements" || (page !== "quests" && suspended?.route === "achievements")} />)}
        </Suspense>
        {page === "rewards" && <Suspense fallback={null}><RewardsPage key={session() ?? "guest"} server={onlineServer} go={navigate} /></Suspense>}
        {page === "friends" && <FriendsPage server={onlineServer} go={navigate} onEnterRoom={(code) => enterRoom(code)} />}
        {(page === "suggestions" || page === "mailbox" || page === "admin") && (
          <Suspense fallback={<p className="econ-note" role="status"><BrandMark /> 불러오는 중…</p>}>
            {page === "suggestions" && <SuggestionsPage server={onlineServer} />}
            {page === "mailbox" && <MailboxPage server={onlineServer} />}
            {page === "admin" && <AdminConsole server={onlineServer} />}
          </Suspense>
        )}
        {page === "daily" && <Suspense fallback={<p className="econ-note" role="status"><BrandMark /> 불러오는 중…</p>}><DailyPage server={onlineServer} go={navigate} /></Suspense>}
        {page === "spectate" && !onlineServer && <OnlineSoon navigate={navigate} />}
        {page === "spectate" && onlineServer && (watchTarget ? <OnlineWatch key={watchTarget.code + watchTarget.key} server={onlineServer} code={watchTarget.code} watchKey={watchTarget.key} onLeave={() => navigate("home")} /> : (
          <p className="online-connecting" role="alert">
            관전 링크가 올바르지 않아요.
          </p>
        ))}
        {page === "online-room" && onlineServer && !onlineCode && <OnlineEntry server={onlineServer} onBack={() => navigate("home")} onEnter={enterRoom} match={match} onWatch={enterWatch} />}
        {page === "play-setup" && <AiSetupScreen onBack={() => navigate("offline")} onStart={() => startLocalGame("play")} />}
        {page === "pvp-setup" && <LocalSetupScreen onBack={() => navigate("offline")} onStart={() => startLocalGame("pvp")} />}
        {activity("play", <HumanGame key={gameKey} suspended={page !== "play"} config={aiConfig} onBranch={branch} onAnalyze={analyze} onChangeSetup={() => go("play-setup")} onLeave={() => go("home")} onProgress={(value) => { if (pageRef.current === "play") progress(value); }} />)}
        {activity("pvp", <LocalGame key={gameKey} players={local.players} order={local.order} onChangeSetup={() => go("pvp-setup")} onLeave={() => go("home")} onProgress={(value) => { if (pageRef.current === "pvp") progress(value); }} />)}
        {activity("solo", <SoloGame key={gameKey} name={nickname || getAiSetup().name || "나"} server={onlineServer} onLeave={() => go("offline")} onRecords={() => go("records")} onProgress={(value) => { if (pageRef.current === "solo") progress(value); }} />)}
        {activity("records", <MyGames server={onlineServer} onBranch={branch} onAnalyze={analyze} />)}
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
