/**
 * Screen registry. `shell` picks the layout; `tier` groups features:
 *  - "core": regular game modes everyone plays (lobby, offline games, records)
 *  - "lab":  research/advanced tools (AI spectating, tournament, strategy analysis)
 * The tier is a structural boundary only (lab screens live in src/lab and load lazily) so they
 * could become an optional plan later. No payment, subscription or access control exists.
 */
import { LEGAL_VISIBLE, POLICY_ROUTES } from "./legal/release";

export type Route = "home" | "tutorial" | "practice" | "offline" | "online" | "online-room" | "spectate" | "play-setup" | "pvp-setup" | "play" | "pvp" | "solo" | "records" | "profile" | "account" | "shop" | "draw" | "inventory" | "quests" | "achievements" | "friends" | "lab" | "watch" | "tournament" | "analysis" | "dice-lab" | "economy-lab" | "cosmetics-lab" | "privacy" | "terms" | "policy" | "contact" | "licenses";
export type Shell = "lobby" | "game" | "lab" | "page";

export const routes: Record<Route, { title: string; shell: Shell; tier: "core" | "lab" }> = {
  home: { title: "온라인 요트다이스", shell: "lobby", tier: "core" },
  tutorial: { title: "튜토리얼", shell: "page", tier: "core" },
  practice: { title: "한 차례 연습하기", shell: "page", tier: "core" },
  offline: { title: "오프라인 대전", shell: "page", tier: "core" },
  online: { title: "온라인 대전", shell: "page", tier: "core" },
  "online-room": { title: "온라인 대전", shell: "game", tier: "core" },
  spectate: { title: "관전", shell: "game", tier: "core" },
  "play-setup": { title: "사람 vs AI 설정", shell: "page", tier: "core" },
  "pvp-setup": { title: "사람 vs 사람 설정", shell: "page", tier: "core" },
  play: { title: "사람 vs AI", shell: "game", tier: "core" },
  solo: { title: "1인 플레이", shell: "game", tier: "core" },
  pvp: { title: "사람 vs 사람", shell: "game", tier: "core" },
  records: { title: "내 기록", shell: "page", tier: "core" },
  account: { title: "계정 설정", shell: "page", tier: "core" },
  profile: { title: "프로필", shell: "page", tier: "core" },
  shop: { title: "상점", shell: "page", tier: "core" },
  draw: { title: "뽑기", shell: "page", tier: "core" },
  inventory: { title: "인벤토리", shell: "page", tier: "core" },
  quests: { title: "퀘스트", shell: "page", tier: "core" },
  achievements: { title: "업적", shell: "page", tier: "core" },
  friends: { title: "친구", shell: "page", tier: "core" },
  privacy: { title: "개인정보 처리방침", shell: "page", tier: "core" },
  terms: { title: "이용약관", shell: "page", tier: "core" },
  policy: { title: "운영 정책", shell: "page", tier: "core" },
  contact: { title: "문의·개인정보 권리 행사", shell: "page", tier: "core" },
  licenses: { title: "오픈소스 라이선스", shell: "page", tier: "core" },
  lab: { title: "연구실", shell: "lab", tier: "lab" },
  watch: { title: "AI 대전 관전", shell: "lab", tier: "lab" },
  tournament: { title: "AI 토너먼트", shell: "lab", tier: "lab" },
  analysis: { title: "전략 분석실", shell: "lab", tier: "lab" },
  "dice-lab": { title: "주사위 실험실", shell: "lab", tier: "lab" },
  "cosmetics-lab": { title: "꾸미기 미리보기", shell: "lab", tier: "lab" },
  "economy-lab": { title: "경제 연구실", shell: "lab", tier: "lab" },
};

export const labTools = ["watch", "tournament", "analysis", "dice-lab", "economy-lab", "cosmetics-lab"] as const satisfies readonly Route[];

export const isRoute = (value: string): value is Route => Object.prototype.hasOwnProperty.call(routes, value);
export const currentRoute = (): Route => {
  const id = location.hash.slice(1);
  // Draft policy pages do not exist in a production build until the operator releases them.
  if ((POLICY_ROUTES as readonly string[]).includes(id) && !LEGAL_VISIBLE) return "home";
  if (id !== "tutorial" && isRoute(id)) return id;
  // A watch link whose #spectate was dropped still opens the spectator screen.
  if (new URLSearchParams(location.search).get("watch")) return "spectate";
  // An invite link whose #online was dropped by a messenger still opens the online screen.
  if (/^[A-Z2-9]{6}$/i.test(new URLSearchParams(location.search).get("room") ?? "")) return "online";
  return "home";
};

/** The advanced product controls have an explicit research entry. This is a UI preference. */
export function researchToolsEnabled() {
  return typeof location !== "undefined" &&
    (new URLSearchParams(location.search).get("lab") === "1" || routes[currentRoute()].tier === "lab");
}
