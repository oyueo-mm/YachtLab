import { ArrowRight, Backpack, Bot, Dices, Globe, ListChecks, Smartphone, Store, Trophy, UserRound, UsersRound } from "lucide-react";
import { DieIcon } from "../Dice";
import type { Route } from "../routes";
import { tutorialSeen } from "../play/Tutorial";
import { useInbox } from "./Friends";

type Go = (route: Route) => void;

/**
 * Home = game-start lobby: a title, one line, and two modes. Online play (invite a friend) is the
 * main card; offline play (AI / same device) is the second card. Research tools stay behind "연구실".
 */
export function Lobby({ navigate }: { navigate: Go }) {
  const box = useInbox();
  return (
    <section className="lobby lobby-v3" aria-labelledby="lobby-title">
      <div className="lobby-hero">
        <span className="lobby-dice" aria-hidden="true">
          <DieIcon value={5} />
          <DieIcon value={6} />
        </span>
        <h1 id="lobby-title">요트다이스를 플레이해보세요</h1>
        <p>AI와 대결하거나 친구와 함께 즐겨보세요.</p>
      </div>
      <button type="button" className="secondary lobby-tutorial" onClick={() => navigate("tutorial")}>
        {tutorialSeen() ? "튜토리얼 다시 보기" : "처음이라면 · 한 차례 연습하기"}
      </button>
      <div className="lobby-modes">
        <button type="button" className="mode-card mode-online mode-primary mode-main" onClick={() => navigate("online")}>
          <span className="mode-icon" aria-hidden="true">
            <Globe size={26} />
          </span>
          <span className="mode-text">
            <strong>온라인 대전</strong>
            <span>빠른 대전 · 친구 대전 · 관전방</span>
          </span>
          <span className="mode-cta">
            온라인 대전하기 <ArrowRight size={16} aria-hidden="true" />
          </span>
        </button>
        <button type="button" className="mode-card mode-offline mode-sub" onClick={() => navigate("offline")}>
          <span className="mode-icon" aria-hidden="true">
            <Dices size={22} />
          </span>
          <span className="mode-text">
            <strong>오프라인 대전</strong>
            <span>AI 대전 · 한 기기에서 함께</span>
          </span>
          <ArrowRight className="mode-arrow" size={20} aria-hidden="true" />
        </button>
      </div>
      <nav className="lobby-menu" aria-label="내 메뉴">
        {(
          [
            ["shop", "상점", Store],
            ["inventory", "인벤토리", Backpack],
            ["quests", "퀘스트", ListChecks],
            ["achievements", "업적", Trophy],
            ["friends", "친구", UsersRound],
            ["profile", "프로필", UserRound],
          ] as const
        ).map(([route, label, Icon]) => (
          <button key={route} type="button" className="lobby-menu-item" onClick={() => navigate(route)}>
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
            {route === "friends" && box.requests + box.invites.length > 0 && (
              <b className="menu-badge" aria-label={`새 알림 ${box.requests + box.invites.length}개`}>
                {box.requests + box.invites.length}
              </b>
            )}
          </button>
        ))}
      </nav>
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

/** Only for a build without an online server address (local preview): nothing here pretends to matchmake. */
export function OnlineSoon({ navigate }: { navigate: Go }) {
  return (
    <section className="online-soon" aria-labelledby="online-title">
      <span className="online-soon-icon" aria-hidden="true">
        <Smartphone size={30} />
      </span>
      <h1 id="online-title">온라인 서버에 연결되어 있지 않아요</h1>
      <p>이 화면에는 온라인 대전 서버 주소가 설정되어 있지 않아 다른 플레이어와 대전할 수 없어요. 오프라인 대전을 이용해 주세요.</p>
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
