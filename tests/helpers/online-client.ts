import WebSocket from "ws";
import type { PlayerView } from "../../src/online";
import type { ServerMessage } from "../../src/online/wire";

export const ORIGIN = "http://127.0.0.1:5173";
const sockets: WebSocket[] = [];
/** Terminate every socket opened by test clients (call in afterEach). */
export const closeAllClients = () => sockets.splice(0).forEach((s) => s.terminate());

export async function api(base: string, path: string, body?: unknown, origin = ORIGIN) {
  const res = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, any> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* empty or non-JSON */
  }
  return { status: res.status, body: parsed };
}

/** Minimal test client: records every message, lets tests await a predicate. */
export class Client {
  messages: ServerMessage[] = [];
  view: PlayerView | null = null;
  ws: WebSocket;
  closed: { code: number } | null = null;
  private waiters: { test: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  private n = 0;
  constructor(base: string | { url: string }, code: string, origin = ORIGIN) {
    const url = typeof base === "string" ? base : base.url;
    this.ws = new WebSocket(url.replace("http", "ws") + "/ws/" + code, { origin });
    sockets.push(this.ws);
    this.ws.on("message", (data) => {
      const m = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(m);
      if (m.t === "welcome" || m.t === "view") this.view = m.view;
      this.waiters = this.waiters.filter((w) => (w.test(m) ? (w.resolve(m), false) : true));
    });
    this.ws.on("close", (code) => (this.closed = { code }));
  }
  opened() {
    return new Promise<void>((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }
  next(test: (m: ServerMessage) => boolean, ms = 3000) {
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for message")), ms);
      this.waiters.push({ test, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }
  async hello(token: string, since?: number) {
    await this.opened();
    const welcome = this.next((m) => m.t === "welcome" || m.t === "error");
    this.ws.send(JSON.stringify({ t: "hello", token, since }));
    return welcome;
  }
  async cmd(action: unknown, id = `c${++this.n}-${Math.random().toString(36).slice(2, 8)}`, v?: number) {
    const ack = this.next((m) => m.t === "ack" && m.id === id);
    this.ws.send(JSON.stringify({ t: "cmd", id, v, action }));
    return (await ack) as Extract<ServerMessage, { t: "ack" }>;
  }
  async settled() {
    // Views are sent right after the ack; give the socket a moment to deliver them.
    await new Promise((r) => setTimeout(r, 20));
  }
}

