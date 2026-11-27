import type { RoomSettings } from "./room";
import { validateNickname } from "../identity/nickname";
import type { OnlineAction } from "./protocol";
import { authHeader, session } from "../identity/account-client";
import type { PlayerView } from "./server-engine";
import type { AiSeat, ApiError, HoldState, JoinResponse, LobbyState, RematchOp, RematchState, RoomSummary, SeriesSummary, ServerMessage, SpectateState } from "./wire";
import type { PublicLook } from "../economy/live/catalog";
import type { MatchKind } from "../economy/live/config";

/**
 * Browser side of YachtLab Online (Phase 2): server address, saved seats, HTTP calls and a
 * self-healing WebSocket. Only renders what the server confirms; never decides dice or scores.
 */

/* ------------------------------------------------------------------ config ------------------------------------------------------------------ */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Where the online server is. Production builds read VITE_ONLINE_SERVER_URL (unset today, so the
 * deployed site keeps showing "준비 중"). For local development and tests a `?online-server=` query
 * parameter may point at a loopback address only, so a link can never send players to a foreign server.
 */
export function onlineServerUrl(): string | null {
  if (typeof location !== "undefined") {
    const q = new URLSearchParams(location.search).get("online-server");
    if (q) {
      try {
        const u = new URL(q);
        if ((u.protocol === "http:" || u.protocol === "ws:") && LOCAL_HOSTS.has(u.hostname)) return `http://${u.host}`;
      } catch {
        /* ignore */
      }
    }
  }
  const env = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ONLINE_SERVER_URL;
  if (env && /^https:\/\//.test(env)) return env.replace(/\/+$/, "");
  return null;
}

/** Invite link for a room, keeping the local server parameter when present. */
export function inviteLink(code: string): string {
  const url = new URL(location.href);
  const server = url.searchParams.get("online-server");
  url.search = "";
  if (server) url.searchParams.set("online-server", server);
  url.searchParams.set("room", code);
  url.hash = "online";
  return url.toString();
}

/**
 * Watch (spectator) link: `?watch=CODE&k=KEY#spectate`. The key is a read-only credential the players
 * created by allowing spectators; it never gives a seat and stops working when they turn spectating off.
 */
export function watchLink(code: string, key: string): string {
  const url = new URL(location.href);
  const server = url.searchParams.get("online-server");
  url.search = "";
  if (server) url.searchParams.set("online-server", server);
  url.searchParams.set("watch", code);
  url.searchParams.set("k", key);
  url.hash = "spectate";
  return url.toString();
}
export function watchFromUrl(): { code: string; key: string } | null {
  if (typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search);
  const code = q.get("watch"),
    key = q.get("k");
  return code && key && /^[A-Z2-9]{6}$/i.test(code) && /^[A-Za-z0-9_-]{16,64}$/.test(key) ? { code: code.toUpperCase(), key } : null;
}

/** Room code from the current URL (`?room=`), if any. */
export function roomFromUrl(): string | null {
  if (typeof location === "undefined") return null;
  const code = new URLSearchParams(location.search).get("room");
  return code && /^[A-Z2-9]{6}$/i.test(code) ? code.toUpperCase() : null;
}

/** Put (or remove) `?room=` in the address bar without adding a history entry. */
export function setRoomInUrl(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  history.replaceState(history.state, "", url.toString());
}

/* ------------------------------------------------------------------ seats ------------------------------------------------------------------ */

export type SavedSeat = { code: string; playerId: string; token: string; name: string; at: number };
const SEATS_KEY = "yachtlab.online.seats";
const NAME_KEY = "yachtlab.online.name";

const readSeats = (): Record<string, SavedSeat> => {
  try {
    const raw = JSON.parse(localStorage.getItem(SEATS_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
};
const writeSeats = (seats: Record<string, SavedSeat>) => {
  try {
    localStorage.setItem(SEATS_KEY, JSON.stringify(seats));
  } catch {
    /* private mode: the seat lives only in this tab */
  }
};
/** The seat token stays in this browser's storage only (never in the URL, never shown). */
const tabSeats = new Map<string, SavedSeat>();
export const savedSeat = (code: string): SavedSeat | null => tabSeats.get(code) ?? readSeats()[code] ?? null;
export function saveSeat(seat: SavedSeat) {
  const seats = readSeats();
  seats[seat.code] = seat;
  // keep the 10 most recent rooms
  const kept = Object.values(seats).sort((a, b) => b.at - a.at).slice(0, 10);
  writeSeats(Object.fromEntries(kept.map((s) => [s.code, s])));
  if (readSeats()[seat.code]?.token !== seat.token) tabSeats.set(seat.code, seat);
  else tabSeats.delete(seat.code);
}
export function forgetSeat(code: string) {
  tabSeats.delete(code);
  const seats = readSeats();
  delete seats[code];
  writeSeats(seats);
}
export const savedSeats = (): SavedSeat[] => Object.values(readSeats()).sort((a, b) => b.at - a.at);
/**
 * The player's nickname on this device (profile page is the only place it is edited). A missing or
 * no-longer-valid saved name is replaced by a generated default ("요트러" + 4 digits) and saved, so
 * every screen always has a name to use. Members: the account nickname is copied here on sign-in.
 */
export const savedName = (): string => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NAME_KEY);
  } catch {
    /* private mode */
  }
  const checked = raw ? validateNickname(raw) : null;
  if (checked?.ok) return checked.name;
  const made = defaultNickname();
  saveName(made);
  return made;
};
/** "요트러" + four random digits (always passes the nickname policy). */
export function defaultNickname(): string {
  const n = crypto.getRandomValues(new Uint16Array(1))[0] % 10000;
  return "요트러" + String(n).padStart(4, "0");
}
export const saveName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("yachtlab-nickname"));
};

/* ------------------------------------------------------------------- HTTP ------------------------------------------------------------------- */

export class OnlineApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
async function call<T>(base: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      // A signed-in player's seat is linked to the account (the server verifies the session itself).
      headers: body === undefined ? undefined : { "content-type": "application/json", ...authHeader() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new OnlineApiError("NETWORK", "서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.");
  }
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok || !data) throw new OnlineApiError((data as ApiError)?.error?.code ?? "SERVER", (data as ApiError)?.error?.message ?? "요청을 처리하지 못했어요.");
  return data as T;
}
/** A friend room for 2..20 players (the host picks the size; 2 = the classic 1:1 room). */
export const createRoom = (base: string, name: string, maxPlayers = 2, settings?: RoomSettings) => call<JoinResponse>(base, "/api/rooms", { name, maxPlayers, settings });
export const joinRoom = (base: string, code: string, name: string) => call<JoinResponse>(base, `/api/rooms/${code}/join`, { name });
export const roomSummary = (base: string, code: string) => call<RoomSummary>(base, `/api/rooms/${code}`);

/* ------------------------------------------------------------- features / public spectating ------------------------------------------------------------- */

export type Features = { quickMatch: boolean; publicSpectate: boolean; signIn: boolean; serverAi?: boolean; economy?: boolean; createSettings?: boolean; defaultTurnTimeoutMs?: number | null; backgroundMatch?: boolean; activity?: boolean; friendPublicSpectate?: boolean };
const featureCache = new Map<string, Promise<Features>>();
/** What the server offers. An older server (or the local Node dev server) answers 404: friend play only. */
export function serverFeatures(base: string): Promise<Features> {
  let p = featureCache.get(base);
  if (!p) {
    p = call<Features>(base, "/api/features").catch(() => ({ quickMatch: false, publicSpectate: false, signIn: false }));
    featureCache.set(base, p);
  }
  return p;
}
export type ServerActivity = {
  asOf: number;
  timezone: "UTC";
  waiting: number;
  activeUsers: number | null;
  playing: Record<MatchKind, number> | null;
  spectators: number | null;
  privatePlaying: number | null;
  completedToday: number | null;
  yachtsToday: number | null;
};
export const serverActivity = (base: string) => call<ServerActivity>(base, "/api/activity");

export type PublicRoom = { kind?: "random" | "friend"; status?: "playing"; participants?: number; rounds?: number; code: string; players: { name: string; score: number; look: PublicLook }[]; round: number; spectators: number; max: number };
export const publicRooms = (base: string) => call<{ rooms: PublicRoom[] }>(base, "/api/spectate/rooms").then((r) => r.rooms);
/** Ask for the watch key of a listed match (only while it is listed and has room for one more viewer). */
export const publicWatchKey = (base: string, code: string) => call<{ code: string; key: string }>(base, `/api/spectate/${code}/watch`, {});

/* ------------------------------------------------------------------ quick match ------------------------------------------------------------------ */

const DEVICE_KEY = "yachtlab.device";
const QUICK_KEY = "yachtlab.quickmatch";
const randomId = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
/** A random id of this browser (not secret): two tabs of one browser are never paired together. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{22,64}$/.test(id)) {
      id = randomId();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}
/** The wait in progress in this tab (survives a refresh; a tab is one ticket). */
export type PendingQuick = { ticket: string; name: string; spectate: boolean; at: number; base?: string; cancelling?: boolean };
export function pendingQuick(): PendingQuick | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(QUICK_KEY) ?? "null") as PendingQuick | null;
    return p && typeof p.ticket === "string" && Date.now() - p.at < 5 * 60_000 ? p : null;
  } catch {
    return null;
  }
}
function savePending(p: PendingQuick | null) {
  try {
    if (p) sessionStorage.setItem(QUICK_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(QUICK_KEY);
  } catch {
    /* private mode */
  }
}
export type QuickMatched = { code: string; playerId: string; token: string; name: string; opponent: string; public: boolean };
export type QuickEvents = {
  onQueued(since: number): void;
  onMatched(m: QuickMatched): void;
  onReconnect?(): void;
  onPairing?(): void;
  /** A final answer: refused, expired, server limit… (`room` = the match this player is already in). */
  onEnd(code: string, message: string, room?: string): void;
};

/**
 * Quick match: one WebSocket to the server's queue. Sends `alive` every 15 s (a silent socket is
 * dropped as a ghost), reconnects with the same ticket after a network drop or a refresh, and gives up
 * after 5 minutes. The server decides the pairing; this only shows it.
 */
export class QuickMatch {
  private ws: WebSocket | null = null;
  private alive: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private done = false;
  private attempts = 0;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private readonly auth = session();
  readonly pending: PendingQuick;
  constructor(
    private readonly base: string,
    opts: { name: string; spectate: boolean; resume?: PendingQuick | null; background?: boolean },
    private readonly events: QuickEvents,
  ) {
    this.background = opts.background === true;
    this.pending = opts.resume ?? { ticket: randomId(), name: opts.name, spectate: opts.spectate, at: Date.now(), base };
  }
  private readonly background: boolean;

  start() {
    savePending(this.pending);
    this.deadline = setTimeout(() => this.end("EXPIRED", "매칭 대기 시간이 끝났어요."), Math.max(0, this.pending.at + 5 * 60_000 + 15_000 - Date.now()));
    this.open();
  }

  private open() {
    if (this.done) return;
    const ws = new WebSocket(this.base.replace(/^http/, "ws") + "/ws/match");
    this.ws = ws;
    ws.onopen = () => {
      if (this.done) return;
      ws.send(JSON.stringify({
        t: this.pending.cancelling && this.background ? "cancel" : "queue",
        name: this.pending.name, ticket: this.pending.ticket, device: deviceId(), spectate: this.pending.spectate,
        ...(this.auth ? { session: this.auth } : {}),
        ...(this.background ? { v: 2 } : {}),
      }));
      this.alive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "alive" }));
      }, 15_000);
    };
    ws.onmessage = (e) => {
      if (this.done || this.ws !== ws) return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.t === "queued") {
        this.attempts = 0;
        if (!this.pending.cancelling) this.events.onQueued(Number(m.since) || Date.now());
      } else if (m.t === "pairing") {
        this.events.onPairing?.();
      } else if (m.t === "check") {
        if (!this.pending.cancelling) ws.send(JSON.stringify({ t: "ready", id: m.id, ...(this.auth ? { session: this.auth } : {}) }));
      } else if (m.t === "matched") {
        const match = m as unknown as QuickMatched;
        saveSeat({ ...match, at: Date.now() });
        this.finish();
        this.events.onMatched(match);
      } else if (m.t === "cancelled") {
        this.end("CANCELLED", "");
      } else if (m.t === "expired") {
        this.end("EXPIRED", String(m.message ?? "상대를 찾지 못했어요."));
      } else if (m.t === "error" && m.code !== "PAIRING") {
        this.end(String(m.code), String(m.message), typeof m.room === "string" ? m.room : undefined);
      }
    };
    ws.onclose = (event) => {
      if (this.ws !== ws || this.done) return;
      clearInterval(this.alive);
      if (event.code === 4010) return this.end("REPLACED", "다른 화면에서 매칭을 이어가고 있어요.");
      this.reconnect();
    };
  }
  private reconnect() {
    if (++this.attempts > 6) {
      this.stop();
      return this.events.onEnd("NETWORK", "서버와 연결이 끊어졌어요. 같은 매칭을 다시 확인할 수 있어요.");
    }
    this.events.onReconnect?.();
    this.retry = setTimeout(() => this.open(), Math.min(8000, 500 * 2 ** this.attempts));
  }
  private end(code: string, message: string, room?: string) {
    this.finish();
    this.events.onEnd(code, message, room);
  }
  private finish() {
    savePending(null);
    this.stop();
  }
  cancel() {
    if (this.done || this.pending.cancelling) return;
    if (!this.background) {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "cancel" }));
      this.end("CANCELLED", "");
      return;
    }
    this.pending.cancelling = true;
    savePending(this.pending);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "cancel", v: 2, ticket: this.pending.ticket, ...(this.auth ? { session: this.auth } : {}) }));
  }
  /** Preserve the ticket across browser refresh and recoverable network failures. */
  stop() {
    this.done = true;
    clearInterval(this.alive);
    clearTimeout(this.retry);
    clearTimeout(this.deadline);
    this.ws?.close();
  }
}

/* ----------------------------------------------------------------- socket ----------------------------------------------------------------- */

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "closed";
export type Ack = Extract<ServerMessage, { t: "ack" }>;
export type ConnectionEvents = {
  /**
   * Full state. `live` is false for the catch-up sync after (re)connecting (no animations).
   * `hold` is the shared hold order of the turn (undefined when the server does not send it).
   */
  onView(view: PlayerView, live: boolean, hold: HoldState | null | undefined): void;
  onHold(hold: HoldState): void;
  /** A preset chat line / emote arrived live (never replayed). Optional for older screens. */
  onSaid?(from: string, id: string): void;
  /** Rematch state + running score of the room (welcome and every change). */
  onRematch?(rematch: RematchState, series: SeriesSummary): void;
  /** A non-fatal server notice (rate limit, rematch refused). */
  onNotice?(code: string, message: string, extra?: { id?: string; retryMs?: number }): void;
  /** Players: spectating consent / watch key / spectator count. */
  onSpectate?(state: SpectateState): void;
  /** Signed-in seats: playerId → public account id. */
  onMembers?(members: Record<string, string>): void;
  /** Spectators: how many are watching (from the spectator welcome). */
  onWatching?(spectators: number): void;
  /** Server-validated looks of the seats (equipped items), and how the room was made. */
  onLooks?(looks: Record<string, PublicLook>): void;
  onKind?(kind: MatchKind, ai: AiSeat | null): void;
  /** Host, ready flags and match settings (friend rooms). */
  onLobby?(lobby: LobbyState): void;
  /** `away`: absent players → ms left of their reconnect grace (server clock, converted on arrival). */
  onPresence(online: string[], away?: Record<string, number>): void;
  onStatus(status: ConnectionStatus): void;
  /** The seat is gone (bad token, left, room closed): stop and go back to the entry screen. */
  onFatal(message: string): void;
};

const newId = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, "");

/**
 * One seat's socket. Reconnects with backoff, resumes from the last seen version (`since`), and
 * re-sends unacknowledged commands with the same id — the server's idempotency makes that safe.
 */
export class OnlineConnection {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private since = 0;
  private pending = new Map<string, { frame: string; resolve: (ack: Ack) => void }>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastMessage = 0;
  status: ConnectionStatus = "connecting";

  /** `token` = a seat (player); `{ watchKey }` = a read-only spectator. */
  constructor(
    private readonly base: string,
    private readonly code: string,
    private readonly token: string | { watchKey: string },
    private readonly events: ConnectionEvents,
  ) {}

  start() {
    this.stopped = false;
    this.open();
    this.heartbeat = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessage > 45_000) return this.ws.close();
      this.ws.send(JSON.stringify({ t: "ping" }));
    }, 20_000);
    window.addEventListener("online", this.wake);
    window.addEventListener("offline", this.lost);
    document.addEventListener("visibilitychange", this.wake);
  }

  /**
   * The device went offline: say so at once (buttons disabled, nothing "sent") instead of waiting for
   * the 45 s heartbeat; the socket reconnects when the device is back online.
   */
  private lost = () => {
    if (this.stopped || !this.ws) return;
    // Detach first: a close handshake on a dead network may take long to report.
    const ws = this.ws;
    this.ws = null;
    ws.close();
    this.setStatus("reconnecting");
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), 1000);
  };

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.heartbeat);
    window.removeEventListener("online", this.wake);
    window.removeEventListener("offline", this.lost);
    document.removeEventListener("visibilitychange", this.wake);
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }

  /** Coming back online / to the tab: reconnect immediately instead of waiting for the backoff. */
  private wake = () => {
    if (this.stopped || document.visibilityState === "hidden") return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      clearTimeout(this.retryTimer);
      this.attempt = 0;
      this.open();
    }
  };

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus(status);
  }

  private open() {
    if (this.stopped) return;
    const ws = new WebSocket(this.base.replace(/^http/, "ws") + "/ws/" + this.code);
    this.ws = ws;
    ws.onopen = () =>
      ws.send(JSON.stringify(typeof this.token === "string" ? { t: "hello", token: this.token, since: this.since } : { t: "watch", key: this.token.watchKey, since: this.since }));
    ws.onmessage = (e) => {
      if (this.ws !== ws || this.stopped) return;
      this.lastMessage = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      if (e.code === 4001 || e.code === 4002 || e.code === 4003 || e.code === 4004 || e.code === 4005) {
        this.stopped = true;
        this.setStatus("closed");
        this.events.onFatal(
          e.code === 4004
            ? "방이 닫혔어요."
            : e.code === 4002
              ? "방에서 나왔어요."
              : e.code === 4003
                ? "관전이 종료되었어요. 플레이어가 관전을 허용하지 않았거나 링크가 바뀌었어요."
                : e.code === 4005
                  ? "관전 인원이 가득 찼어요. 잠시 후 다시 시도해 주세요."
                  : "이 방에 다시 들어갈 수 없어요. 참가 정보가 만료되었어요.",
        );
        return;
      }
      this.setStatus("reconnecting");
      const delay = Math.min(10_000, 500 * 2 ** this.attempt++) * (0.8 + Math.random() * 0.4);
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  private receive(msg: ServerMessage) {
    switch (msg.t) {
      case "welcome":
        this.attempt = 0;
        this.since = msg.view.version;
        this.setStatus("online");
        this.events.onPresence(msg.online);
        this.events.onView(msg.view, false, msg.hold ?? null);
        if (msg.rematch && msg.series) this.events.onRematch?.(msg.rematch, msg.series);
        if (msg.spectate) this.events.onSpectate?.(msg.spectate);
        if (msg.members) this.events.onMembers?.(msg.members);
        if (msg.looks) this.events.onLooks?.(msg.looks);
        this.events.onKind?.(msg.kind ?? "friend", msg.ai ?? null);
        if (msg.lobby) this.events.onLobby?.(msg.lobby);
        // Commands whose ack was lost are sent again with the same id (applied at most once).
        for (const p of this.pending.values()) this.ws?.send(p.frame);
        return;
      case "watching":
        this.attempt = 0;
        this.since = msg.view.version;
        this.setStatus("online");
        this.events.onPresence(msg.online);
        this.events.onWatching?.(msg.spectators);
        if (msg.looks) this.events.onLooks?.(msg.looks);
        this.events.onKind?.(msg.kind ?? "friend", msg.ai ?? null);
        this.events.onView(msg.view, false, msg.hold ?? null);
        this.events.onRematch?.({ requests: [], declinedBy: null, departed: [], blocked: null }, msg.series);
        return;
      case "spectate":
        this.events.onSpectate?.(msg.spectate);
        return;
      case "members":
        this.events.onMembers?.(msg.members);
        return;
      case "looks":
        this.events.onLooks?.(msg.looks);
        return;
      case "lobby":
        this.events.onLobby?.(msg.lobby);
        return;
      case "view":
        this.since = msg.view.version;
        this.events.onView(msg.view, true, msg.hold);
        return;
      case "ack": {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.resolve(msg);
        return;
      }
      case "hold":
        this.events.onHold({ playerId: msg.playerId, keep: msg.keep, n: msg.n ?? 0 });
        return;
      case "presence":
        this.events.onPresence(msg.online, msg.away ? Object.fromEntries(Object.entries(msg.away).map(([id, ms]) => [id, Date.now() + ms])) : {});
        return;
      case "said":
        this.events.onSaid?.(msg.from, msg.id);
        return;
      case "rematch":
        this.events.onRematch?.(msg.rematch, msg.series);
        return;
      case "error":
        this.events.onNotice?.(msg.code, msg.message, { id: msg.id, retryMs: msg.retryMs });
        return;
      default:
        return;
    }
  }

  /** Send a game command; resolves with the server's ack (possibly after a reconnect). */
  command(action: OnlineAction, expectedVersion?: number): Promise<Ack> {
    const id = newId();
    const frame = JSON.stringify({ t: "cmd", id, ...(expectedVersion !== undefined ? { v: expectedVersion } : {}), action });
    return new Promise<Ack>((resolve) => {
      this.pending.set(id, { frame, resolve });
      if (this.ws?.readyState === WebSocket.OPEN && this.status === "online") this.ws.send(frame);
    });
  }

  private sendNow(frame: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN || this.status !== "online") return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }
  /** Preset chat / emote by catalog id (best effort, never queued: a stale greeting is worse than none). */
  say(id: string) {
    return this.sendNow({ t: "say", id });
  }
  rematch(op: RematchOp) {
    return this.sendNow({ t: "rematch", op });
  }
  /** Players: allow / stop spectators. */
  spectate(allow: boolean, visibility?: "private" | "invite" | "public") {
    return this.sendNow({ t: "spectate", allow, ...(visibility ? { visibility } : {}) });
  }
  /** Lobby: ready / not ready. */
  ready(ready: boolean) {
    return this.sendNow({ t: "ready", ready });
  }
  /** Host: match settings (mode and time limit). */
  settings(mode: "turns" | "simultaneous", timeoutMs: number | null) {
    return this.sendNow({ t: "settings", mode, timeoutMs });
  }
  /** Host: hand the host role to another player. */
  transferHost(to: string) {
    return this.sendNow({ t: "host", to });
  }
  /** Leave the finished room for good. */
  bye() {
    return this.sendNow({ t: "bye" });
  }

  /** Hold selection in selection order (best effort, never queued; the roll carries the real keep). */
  hold(keep: number[], n: number) {
    if (this.ws?.readyState === WebSocket.OPEN && this.status === "online") this.ws.send(JSON.stringify({ t: "hold", keep, n }));
  }
}
