import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { type Match } from "./match";
import { type AnalysisSource } from "./ReplayViewer";
import { type Replay } from "./replay";
import LocalGame from "./LocalGame";
import MyGames from "./MyGames";
import HumanGame from "./play/HumanGame";
import { currentRoute, routes, type Route } from "./routes";
import { LabNav, SettingsDialog, TopBar } from "./shell/Chrome";
import { Lobby, OfflineSelect, OnlineSoon } from "./shell/Lobby";
import { AiSetupScreen, LocalSetupScreen } from "./shell/Setup";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { installAudioUnlock } from "./sound";
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
  const inProgress = useRef(false);
  const [leaveTo, setLeaveTo] = useState<Route | null>(null);
  const go = (p: Route) => {
    if (p === "watch") {
      setArenaSource(null);
      setReplay(null);
    }
    if (p === "analysis") setAnalysisSource(null);
    if ((p === "play" || p === "pvp") && page !== p) {
      // Entering a game screen from elsewhere starts from the latest saved setup.
      if (p === "play") setAiConfig(aiMatchConfig(getAiSetup()));
      else setLocal(localConfig());
      setGameKey((k) => k + 1);
    }
    location.hash = p;
    setPage(p);
  };
  /** Leaving a game in progress asks first (top-bar home, settings links). */
  const navigate = (p: Route) => {
    if (routes[page].shell === "game" && inProgress.current && p !== page) setLeaveTo(p);
    else go(p);
  };
  const branch = (r: Replay, index: number) => {
    setReplay(null);
    location.hash = "watch";
    setPage("watch");
    setArenaSource({ replay: r, index });
  };
  const analyze = (source: AnalysisSource) => {
    location.hash = "analysis";
    setPage("analysis");
    setAnalysisSource(source);
  };
  useEffect(() => {
    installAudioUnlock();
    const fn = () => {
      const next = currentRoute();
      setPage((prev) => {
        if ((next === "play" || next === "pvp") && prev !== next) {
          if (next === "play") setAiConfig(aiMatchConfig(getAiSetup()));
          else setLocal(localConfig());
          setGameKey((k) => k + 1);
        }
        return next;
      });
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    window.scrollTo?.(0, 0);
    document.title = page === "home" ? "YachtLab" : routes[page].title + " · YachtLab";
  }, [page]);
  const shell = routes[page].shell;
  const progress = (value: boolean) => {
    inProgress.current = value;
  };
  return (
    <div className={`app-shell shell-${shell}`}>
      <TopBar route={page} navigate={navigate} openSettings={() => setSettingsOpen(true)} />
      {shell === "lab" && <LabNav route={page} navigate={navigate} />}
      <main className={`main page-${page}`}>
        {page === "home" && <Lobby navigate={navigate} />}
        {page === "offline" && <OfflineSelect navigate={navigate} />}
        {page === "online" && <OnlineSoon navigate={navigate} />}
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
                location.hash = "watch";
                setPage("watch");
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
        onCancel={() => setLeaveTo(null)}
        onConfirm={() => {
          const target = leaveTo;
          setLeaveTo(null);
          inProgress.current = false;
          if (target) go(target);
        }}
      />
    </div>
  );
}
