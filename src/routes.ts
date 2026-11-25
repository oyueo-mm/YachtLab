/**
 * Screen registry. `shell` picks the layout; `tier` groups features:
 *  - "core": regular game modes everyone plays (lobby, offline games, records)
 *  - "lab":  research/advanced tools (AI spectating, tournament, strategy analysis)
 * The tier is a structural boundary only (lab screens live in src/lab and load lazily) so they
 * could become an optional plan later. No payment, subscription or access control exists.
 */
export type Route = "home" | "tutorial" | "practice" | "offline" | "online" | "online-room" | "spectate" | "play-setup" | "pvp-setup" | "play" | "pvp" | "records" | "profile" | "account" | "shop" | "draw" | "inventory" | "quests" | "achievements" | "friends" | "lab" | "watch" | "tournament" | "analysis" | "dice-lab" | "economy-lab";
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
  lab: { title: "연구실", shell: "lab", tier: "lab" },
  watch: { title: "AI 대전 관전", shell: "lab", tier: "lab" },
  tournament: { title: "AI 토너먼트", shell: "lab", tier: "lab" },
  analysis: { title: "전략 분석실", shell: "lab", tier: "lab" },
  "dice-lab": { title: "주사위 실험실", shell: "lab", tier: "lab" },
  "economy-lab": { title: "경제 연구실", shell: "lab", tier: "lab" },
};

export const homeDescription = "친구나 AI와 무료로 요트다이스를 플레이하세요. 12칸 규칙과 족보, 상단 보너스, 초보 전략을 안내합니다.";
export const routeDescription: Partial<Record<Route, string>> = {
  online: "빠른 대전에서 상대를 만나거나 초대 링크로 친구와 온라인 요트다이스를 플레이하세요.",
  offline: "요트다이스 AI 대전, 한 기기에서 함께하는 로컬 대전, 반복 가능한 한 차례 연습을 시작하세요.",
  practice: "주사위를 굴리고 킵을 선택해 요트다이스에서 첫 점수를 기록하는 방법을 연습하세요.",
  records: "요트다이스 전적과 상세 통계, 완료한 경기의 리뷰와 기보를 확인하세요.",
  shop: "주사위·보드·프로필과 다양한 요트다이스 꾸미기 상품을 둘러보세요.",
  inventory: "보유한 요트다이스 꾸미기 상품의 외형을 확인하고 장착하거나 강화하세요.",
  draw: "주사위 다섯 개의 족보에 따른 게임 내 뽑기와 확률을 확인하세요.",
  quests: "일일·주간 요트다이스 퀘스트의 진행도와 보상을 확인하세요.",
};

export const labTools = ["watch", "tournament", "analysis", "dice-lab", "economy-lab"] as const satisfies readonly Route[];

export const isRoute = (value: string): value is Route => Object.prototype.hasOwnProperty.call(routes, value);
export const currentRoute = (): Route => {
  const id = location.hash.slice(1);
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
