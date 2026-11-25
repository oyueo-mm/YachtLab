/**
 * Screen registry. `shell` picks the layout; `tier` groups features:
 *  - "core": regular game modes everyone plays (lobby, offline games, records)
 *  - "lab":  research/advanced tools (AI spectating, tournament, strategy analysis)
 * The tier is a structural boundary only (lab screens live in src/lab and load lazily) so they
 * could become an optional plan later. No payment, subscription or access control exists.
 */
export type Route = "home" | "tutorial" | "offline" | "online" | "online-room" | "spectate" | "play-setup" | "pvp-setup" | "play" | "pvp" | "records" | "profile" | "shop" | "inventory" | "quests" | "achievements" | "friends" | "lab" | "watch" | "tournament" | "analysis" | "dice-lab" | "economy-lab";
export type Shell = "lobby" | "game" | "lab" | "page";

export const routes: Record<Route, { title: string; shell: Shell; tier: "core" | "lab" }> = {
  home: { title: "YachtLab", shell: "lobby", tier: "core" },
  tutorial: { title: "한 차례 연습하기", shell: "page", tier: "core" },
  offline: { title: "오프라인 대전", shell: "page", tier: "core" },
  online: { title: "온라인 대전", shell: "page", tier: "core" },
  "online-room": { title: "온라인 대전", shell: "game", tier: "core" },
  spectate: { title: "관전", shell: "game", tier: "core" },
  "play-setup": { title: "사람 vs AI 설정", shell: "page", tier: "core" },
  "pvp-setup": { title: "사람 vs 사람 설정", shell: "page", tier: "core" },
  play: { title: "사람 vs AI", shell: "game", tier: "core" },
  pvp: { title: "사람 vs 사람", shell: "game", tier: "core" },
  records: { title: "내 기록", shell: "page", tier: "core" },
  profile: { title: "프로필", shell: "page", tier: "core" },
  shop: { title: "상점", shell: "page", tier: "core" },
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

export const labTools = ["watch", "tournament", "analysis", "dice-lab", "economy-lab"] as const satisfies readonly Route[];

export const isRoute = (value: string): value is Route => Object.prototype.hasOwnProperty.call(routes, value);
export const currentRoute = (): Route => {
  const id = location.hash.slice(1);
  if (isRoute(id)) return id;
  // A watch link whose #spectate was dropped still opens the spectator screen.
  if (new URLSearchParams(location.search).get("watch")) return "spectate";
  // An invite link whose #online was dropped by a messenger still opens the online screen.
  if (/^[A-Z2-9]{6}$/i.test(new URLSearchParams(location.search).get("room") ?? "")) return "online";
  return "home";
};
