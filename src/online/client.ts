import type { OnlineAction } from "./protocol";
import type { PlayerView } from "./server-engine";
import type { ApiError, JoinResponse, RoomSummary, ServerMessage } from "./wire";

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
export const savedSeat = (code: string): SavedSeat | null => readSeats()[code] ?? null;
export function saveSeat(seat: SavedSeat) {
  const seats = readSeats();
  seats[seat.code] = seat;
  // keep the 10 most recent rooms
  const kept = Object.values(seats).sort((a, b) => b.at - a.at).slice(0, 10);
  writeSeats(Object.fromEntries(kept.map((s) => [s.code, s])));
}
export function forgetSeat(code: string) {
  const seats = readSeats();
  delete seats[code];
  writeSeats(seats);
}
export const savedSeats = (): SavedSeat[] => Object.values(readSeats()).sort((a, b) => b.at - a.at);
export const savedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};
export const saveName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
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
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new OnlineApiError("NETWORK", "서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.");
  }
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok || !data) throw new OnlineApiError((data as ApiError)?.error?.code ?? "SERVER", (data as ApiError)?.error?.message ?? "요청을 처리하지 못했어요.");
  return data as T;
}
export const createRoom = (base: string, name: string) => call<JoinResponse>(base, "/api/rooms", { name });
export const joinRoom = (base: string, code: string, name: string) => call<JoinResponse>(base, `/api/rooms/${code}/join`, { name });
export const roomSummary = (base: string, code: string) => call<RoomSummary>(base, `/api/rooms/${code}`);

/* ----------------------------------------------------------------- socket ----------------------------------------------------------------- */

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "closed";
export type Ack = Extract<ServerMessage, { t: "ack" }>;
export type ConnectionEvents = {
  /** Full state. `live` is false for the catch-up sync after (re)connecting (no animations). */
  onView(view: PlayerView, live: boolean): void;
  onHold(playerId: string, keep: number[]): void;
  onPresence(online: string[]): void;
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

  constructor(
    private readonly base: string,
    private readonly code: string,
    private readonly token: string,
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
    document.addEventListener("visibilitychange", this.wake);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.heartbeat);
    window.removeEventListener("online", this.wake);
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
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", token: this.token, since: this.since }));
    ws.onmessage = (e) => {
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
      if (e.code === 4001 || e.code === 4002 || e.code === 4004) {
        this.stopped = true;
        this.setStatus("closed");
        this.events.onFatal(e.code === 4004 ? "방이 닫혔어요." : e.code === 4002 ? "방에서 나왔어요." : "이 방에 다시 들어갈 수 없어요. 참가 정보가 만료되었어요.");
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
        this.events.onView(msg.view, false);
        if (msg.hold) this.events.onHold(msg.hold.playerId, msg.hold.keep);
        // Commands whose ack was lost are sent again with the same id (applied at most once).
        for (const p of this.pending.values()) this.ws?.send(p.frame);
        return;
      case "view":
        this.since = msg.view.version;
        this.events.onView(msg.view, true);
        return;
      case "ack": {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.resolve(msg);
        return;
      }
      case "hold":
        this.events.onHold(msg.playerId, msg.keep);
        return;
      case "presence":
        this.events.onPresence(msg.online);
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

  /** Live hold preview for the opponent (best effort, never queued). */
  hold(keep: number[]) {
    if (this.ws?.readyState === WebSocket.OPEN && this.status === "online") this.ws.send(JSON.stringify({ t: "hold", keep }));
  }
}
