import { ArrowRight, Bot, Globe, Smartphone, UsersRound, WifiOff } from "lucide-react";
import { DieIcon } from "../Dice";
import type { Route } from "../routes";
import { HomeDice } from "./HomeDice";

type Go = (route: Route) => void;

/** Home = game mode lobby. Two choices only; research tools live behind the top-right "연구실". */
export function Lobby({ navigate }: { navigate: Go }) {
  return (
    <section className="lobby" aria-labelledby="lobby-title">
      <div className="lobby-menu">
      <h1 id="lobby-title" className="lobby-title">
        게임 모드 선택
      </h1>
      <div className="lobby-modes">
        <button type="button" className="mode-card mode-online" onClick={() => navigate("online")} aria-describedby="online-status">
          <span className="mode-dice" aria-hidden="true">
            <DieIcon value={6} />
            <DieIcon value={5} />
          </span>
          <span className="mode-icon" aria-hidden="true">
            <Globe size={26} />
          </span>
          <span className="mode-text">
            <strong>온라인 대전</strong>
            <span>다른 플레이어와 실시간으로 대결</span>
          </span>
          <span className="mode-badge" id="online-status">
            준비 중
          </span>
        </button>
        <button type="button" className="mode-card mode-offline mode-primary" onClick={() => navigate("offline")}>
          <span className="mode-icon" aria-hidden="true">
            <WifiOff size={24} />
          </span>
          <span className="mode-text">
            <strong>오프라인 대전</strong>
            <span>AI 또는 친구와 이 기기에서 바로 플레이</span>
          </span>
          <span className="mode-cta">
            바로 플레이 <ArrowRight size={16} aria-hidden="true" />
          </span>
        </button>
      </div>
      </div>
      <HomeDice />
    </section>
  );
}

export function OfflineSelect({ navigate }: { navigate: Go }) {
  return (
    <section className="mode-select" aria-labelledby="offline-title">
      <h1 id="offline-title" className="lobby-title">
        오프라인 대전
      </h1>
      <div className="lobby-modes">
        <button type="button" className="mode-card mode-ai" onClick={() => navigate("play-setup")}>
          <span className="mode-icon" aria-hidden="true">
            <Bot size={26} />
          </span>
          <span className="mode-text">
            <strong>사람 vs AI</strong>
            <span>5단계 난이도의 AI와 1:1 대결</span>
          </span>
          <ArrowRight className="mode-arrow" size={22} aria-hidden="true" />
        </button>
        <button type="button" className="mode-card mode-local" onClick={() => navigate("pvp-setup")}>
          <span className="mode-icon" aria-hidden="true">
            <UsersRound size={26} />
          </span>
          <span className="mode-text">
            <strong>사람 vs 사람</strong>
            <span>한 기기에서 2~50명이 번갈아 플레이</span>
          </span>
          <ArrowRight className="mode-arrow" size={22} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

/** Honest placeholder: the online server is not connected, so nothing here pretends to matchmake. */
export function OnlineSoon({ navigate }: { navigate: Go }) {
  return (
    <section className="online-soon" aria-labelledby="online-title">
      <span className="online-soon-icon" aria-hidden="true">
        <Smartphone size={30} />
      </span>
      <h1 id="online-title">온라인 대전은 준비 중이에요</h1>
      <p>아직 게임 서버와 연결되어 있지 않아 다른 플레이어와 대전할 수 없어요. 준비가 끝나면 이곳에서 시작할 수 있어요.</p>
      <div className="online-soon-actions">
        <button type="button" className="primary" onClick={() => navigate("offline")}>
          오프라인 대전 하기 <ArrowRight size={16} />
        </button>
        <button type="button" className="secondary" onClick={() => navigate("home")}>
          홈으로
        </button>
      </div>
    </section>
  );
}
