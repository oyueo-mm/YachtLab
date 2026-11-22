import { Suspense, lazy, useEffect, useState } from "react";
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
import { installAudioUnlock } from "./sound";

// Research tools are a separate, lazily loaded chunk (see routes.ts "lab" tier).
const LabScreen = lazy(() => import("./lab/LabScreen"));

export default function App() {
  const [page, setPage] = useState<Route>(currentRoute),
    [replay, setReplay] = useState<Match | null>(null),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [arenaSource, setArenaSource] = useState<{ replay: Replay; index: number } | null>(null),
    [analysisSource, setAnalysisSource] = useState<AnalysisSource | null>(null);
  const navigate = (p: Route) => {
    if (p === "watch") {
      setArenaSource(null);
      setReplay(null);
    }
    if (p === "analysis") setAnalysisSource(null);
    location.hash = p;
    setPage(p);
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
    const fn = () => setPage(currentRoute());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    window.scrollTo?.(0, 0);
    document.title = page === "home" ? "YachtLab" : routes[page].title + " · YachtLab";
  }, [page]);
  const shell = routes[page].shell;
  return (
    <div className={`app-shell shell-${shell}`}>
      <TopBar route={page} navigate={navigate} openSettings={() => setSettingsOpen(true)} />
      {shell === "lab" && <LabNav route={page} navigate={navigate} />}
      <main className={`main page-${page}`}>
        {page === "home" && <Lobby navigate={navigate} />}
        {page === "offline" && <OfflineSelect navigate={navigate} />}
        {page === "online" && <OnlineSoon navigate={navigate} />}
        {page === "play" && <HumanGame onBranch={branch} onAnalyze={analyze} />}
        {page === "pvp" && <LocalGame />}
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
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} navigate={navigate} />
    </div>
  );
}
