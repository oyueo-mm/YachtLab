import { api } from "./account-client";

/** Friends & invites API (members only). Players are addressed by friend code ("YL…"). */
export type FriendStatus = "online" | "playing" | "offline";
export type FriendEntry = { code: string; nickname: string; since: number; status: FriendStatus };
export type Pending = { code: string; nickname: string; at: number };
export type FriendData = { me: { code: string; nickname: string }; friends: FriendEntry[]; incoming: Pending[]; outgoing: Pending[]; blocked: { code: string; nickname: string }[] };
export type SearchResult = { code: string; nickname: string; relation: "self" | "friend" | "incoming" | "outgoing" | "blocked" | "none" };
export type RoomInvite = { id: string; from: { code: string; nickname: string }; room: string; at: number; expires: number };
export type FriendProfile = { code: string; nickname: string; joinedAt: number; online: { games: number; wins: number; losses: number; draws: number; best: number | null; average: number | null } };

export const friends = (server: string) => api<FriendData>(server, "/api/me/friends");
export const searchFriends = (server: string, query: string) => api<{ results: SearchResult[] }>(server, "/api/me/friends/search", { body: { query } }).then((r) => r.results);
export const friendAction = (server: string, action: "request" | "accept" | "decline" | "cancel" | "remove" | "block" | "unblock", code: string) => api<{ status?: string; ok?: boolean }>(server, "/api/me/friends/" + action, { body: { code } });
export const friendProfile = (server: string, code: string) => api<FriendProfile>(server, "/api/me/friends/profile?code=" + encodeURIComponent(code));
export const inbox = (server: string) => api<{ requests: number; invites: RoomInvite[] }>(server, "/api/me/inbox");
export const declineInvite = (server: string, id: string) => api<{ ok: boolean }>(server, "/api/me/invites/decline", { body: { id } });
export const acceptInvite = (server: string, id: string) => api<{ code: string; playerId: string; token: string }>(server, "/api/me/invites/accept", { body: { id } });
export const inviteFriends = (server: string, room: string, codes: string[]) => api<{ results: Record<string, string> }>(server, `/api/rooms/${room}/invite`, { body: { friends: codes } }).then((r) => r.results);
