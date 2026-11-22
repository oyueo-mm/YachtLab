import { Bot, FlaskConical, Trophy, type LucideIcon } from "lucide-react";
import HomeDemo from "../HomeDemo";
import type { Match } from "../match";
import type { Replay } from "../replay";
import type { AnalysisSource } from "../ReplayViewer";
import { routes, type Route } from "../routes";
import { Analysis, Spectator, Tournament } from "./LabPages";

/**
 * Research lab entry (lazy-loaded chunk). Everything here is an advanced/research tool,
 * structurally separated from the regular game modes. No access control is applied.
 */
export default function LabScreen({
  route,
  navigate,
  replay,
  clearReplay,
  openReplay,
  arenaSource,
  analysisSource,
  onBranch,
  onAnalyze,
}: {
  route: Route;
  navigate: (r: Route) => void;
  replay: Match | null;
  clearReplay: () => void;
  openReplay: (m: Match) => void;
  arenaSource: { replay: Replay; index: number } | null;
  analysisSource: AnalysisSource | null;
  onBranch: (r: Replay, index: number) => void;
  onAnalyze: (s: AnalysisSource) => void;
}) {
  if (route === "watch") return <Spectator initial={replay} source={arenaSource} onBranch={onBranch} onAnalyze={onAnalyze} clearInitial={clearReplay} />;
  if (route === "tournament") return <Tournament openReplay={openReplay} />;
  if (route === "analysis") return <Analysis initial={analysisSource} />;
  const tools: { id: Route; icon: LucideIcon; text: string }[] = [
    { id: "watch", icon: Bot, text: "두 AI 알고리즘의 대국을 한 수씩 재생하고 판단 근거를 확인해요." },
    { id: "tournament", icon: Trophy, text: "여러 알고리즘을 같은 시드로 겨루게 해 승률과 점수를 비교해요." },
    { id: "analysis", icon: FlaskConical, text: "특정 상황에서 전략별 기대 점수를 DP로 비교해요." },
  ];
  return (
    <section className="lab-hub" aria-labelledby="lab-title">
      <div className="lab-hub-heading">
        <h1 id="lab-title">연구실</h1>
        <p>AI 알고리즘을 관전·비교·분석하는 연구용 고급 기능이에요. 일반 게임 모드와 별도로 제공돼요.</p>
      </div>
      <div className="lab-tools">
        {tools.map(({ id, icon: Icon, text }) => (
          <button type="button" key={id} className="lab-tool" onClick={() => navigate(id)}>
            <Icon size={22} aria-hidden="true" />
            <strong>{routes[id].title}</strong>
            <span>{text}</span>
          </button>
        ))}
      </div>
      <div className="lab-demo">
        <h2>AI 시연</h2>
        <p>실제 AI 기록에서 고른 한 턴을 반복 재생해요.</p>
        <HomeDemo />
      </div>
    </section>
  );
}
