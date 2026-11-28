import { api, session } from "./account-client";

/**
 * Friends & invites API (members only). Players are addressed by friend code ("YL…"); recent opponents and
 * room members also by account id, which the SERVER binds to a code (SOC-1). Nothing here searches by
 * nickname to decide who someone is. Contract for the global friend panel: docs/online/SOC-1-SOCIAL.md.
 */
/** "unknown" (SOC-1): the server could not tell yet (presence restarted, network) — never shown as offline. */
export type FriendStatus = "online" | "playing" | "offline" | "unknown";
export type FriendEntry = { code: string; nickname: string; since: number; status: FriendStatus };
export type Pending = { code: string; nickname: string; at: number };
export type SocialSettings = { presence: "friends" | "hidden"; pinsVisibility: "public" | "friends" | "private" };
export type FriendData = { me: { code: string; nickname: string; settings?: SocialSettings }; friends: FriendEntry[]; incoming: Pending[]; outgoing: Pending[]; blocked: { code: string; nickname: string }[]; presence?: "v2" };
export type SearchResult = { code: string; nickname: string; relation: "self" | "friend" | "incoming" | "outgoing" | "blocked" | "none" };
export type RoomInvite = { id: string; from: { code: string; nickname: string }; room: string; at: number; expires: number };
export type SentInvite = { id: string; to: { code: string; nickname: string }; room: string; at: number; expires: number; state: "pending" | "accepted" | "declined" | "expired" | "cancelled"; kind: "room" | "challenge" };
export type Versus = { games: number; wins: number; losses: number; draws: number };
export type FriendProfile = { code: string; nickname: string; joinedAt: number; online: { games: number; wins: number; losses: number; draws: number; best: number | null; average: number | null }; relation?: SearchResult["relation"]; versus?: Versus; pins?: string[] };
export type Seat = { code: string; playerId: string; token: string };

/** One id per browser tab (presence is per tab / device: closing one tab never hides another). */
export function tabId(): string {
  const make = () => "t" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join("");
  try {
    let id = sessionStorage.getItem("yachtlab.tab-id");
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      id = make();
      sessionStorage.setItem("yachtlab.tab-id", id);
    }
    return id;
  } catch {
    return (memoTab ??= make());
  }
}
let memoTab: string | undefined;

export const friends = (server: string) => api<FriendData>(server, "/api/me/friends");
export const searchFriends = (server: string, query: string) => api<{ results: SearchResult[] }>(server, "/api/me/friends/search", { body: { query } }).then((r) => r.results);
export const friendAction = (server: string, action: "request" | "accept" | "decline" | "cancel" | "remove" | "block" | "unblock", code: string) => api<{ status?: string; ok?: boolean }>(server, "/api/me/friends/" + action, { body: { code } });
export const friendProfile = (server: string, code: string) => api<FriendProfile>(server, "/api/me/friends/profile?code=" + encodeURIComponent(code));
/** Inbox check = this tab's presence heartbeat. `sent` exists on Workers with SOC-1 only. */
export const inbox = (server: string) => api<{ requests: number; invites: RoomInvite[]; sent?: SentInvite[] }>(server, "/api/me/inbox?device=" + encodeURIComponent(tabId()));
export const declineInvite = (server: string, id: string) => api<{ ok: boolean }>(server, "/api/me/invites/decline", { body: { id } });
export const acceptInvite = (server: string, id: string) => api<Seat>(server, "/api/me/invites/accept", { body: { id } });
export const cancelInvite = (server: string, id: string) => api<{ ok: boolean }>(server, "/api/me/invites/cancel", { body: { id } });
export const inviteFriends = (server: string, room: string, codes: string[]) => api<{ results: Record<string, string> }>(server, `/api/rooms/${room}/invite`, { body: { friends: codes } }).then((r) => r.results);
/**
 * Direct challenge (SOC-1): a 1:1 friend room seating me + an invite. `status:"pending"` = a challenge to
 * this friend is still open (no new room; use the seat saved on this device, or cancel it). Errors:
 * BUSY (friend visibly playing), NOT_FRIEND, RATE_LIMITED, room creation limits.
 */
export const challengeFriend = (server: string, code: string) => api<({ status: "sent" } & Seat & { invite: SentInvite | null }) | { status: "pending"; invite: SentInvite }>(server, "/api/me/friends/challenge", { body: { code } });
export const friendSettings = (server: string) => api<{ settings: SocialSettings }>(server, "/api/me/friends/settings").then((r) => r.settings);
export const setFriendSettings = (server: string, patch: Partial<SocialSettings>) => api<{ settings: SocialSettings }>(server, "/api/me/friends/settings", { body: patch }).then((r) => r.settings);
export const serverPins = (server: string) => api<{ pins: string[]; visibility: SocialSettings["pinsVisibility"]; max: number }>(server, "/api/me/profile/pins");
export const saveServerPins = (server: string, ids: string[]) => api<{ pins: string[] }>(server, "/api/me/profile/pins", { body: { ids } }).then((r) => r.pins);

/** This tab is going away (pagehide): friends stop seeing it at once; other tabs / devices are unaffected. */
export function presenceGoodbye(server: string) {
  const s = session();
  if (!s) return;
  try {
    void fetch(server.replace(/\/$/, "") + "/api/me/presence", { method: "POST", keepalive: true, headers: { "content-type": "application/json", authorization: "Bearer " + s }, body: JSON.stringify({ device: tabId(), state: "offline" }) }).catch(() => undefined);
  } catch {
    /* best effort: the 2.5-minute TTL ends it anyway */
  }
}

/** Shareable friend link: opens the friends page with the code filled in (the code is public by design). */
export function friendLink(code: string, base = typeof location !== "undefined" ? location.origin + location.pathname : ""): string {
  return `${base}?friend=${encodeURIComponent(code)}#friends`;
}
/** The `?friend=` code of a shared link, normalised like the server does (or null). */
export function linkedFriendCode(search = typeof location !== "undefined" ? location.search : ""): string | null {
  const raw = new URLSearchParams(search).get("friend");
  if (!raw) return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, "");
  const body = (c.startsWith("YL") && c.length === 10 ? c.slice(2) : c).replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(body) ? "YL" + body : null;
}
