import { ArrowRight, BookOpen, Bot, Dices, Globe, Smartphone, UsersRound } from "lucide-react";
import type { Route } from "../routes";

type Go = (route: Route) => void;

export function Lobby({ navigate }: { navigate: Go }) {
  return (
    <section className="lobby lobby-v3" aria-labelledby="lobby-title">
      <header className="lobby-hero">
        <h1 id="lobby-title">온라인 요트다이스</h1>
        <p>야추 다이스로도 불리는 요트다이스를 PC와 모바일에서 무료로 즐기세요. 친구와 온라인 멀티플레이를 하거나 혼자 AI에 도전할 수 있어요.</p>
      </header>
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
      {/* Users see the two help pages; every search page stays linked from them, the static index.html
          shell (no JavaScript) and the sitemap. */}
      <nav className="lobby-links" aria-label="도구와 안내">
        <a className="lobby-guide" href={`${import.meta.env.BASE_URL}guide/`}> <BookOpen size={17} aria-hidden="true" /> 규칙</a>
        <a href={`${import.meta.env.BASE_URL}faq/`}>자주 묻는 질문</a>
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
      <button type="button" className="secondary mode-practice" onClick={() => navigate("practice")}>
        <Dices size={18} aria-hidden="true" /> 한 차례 연습하기
      </button>
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
