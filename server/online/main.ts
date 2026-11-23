import { startOnlineServer } from "./server";

/** `npm run online:server` — local YachtLab Online server (development only; nothing is deployed). */
const env = process.env;
const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const running = await startOnlineServer({
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? "127.0.0.1",
  dataDir: env.ONLINE_DATA_DIR === "" ? null : env.ONLINE_DATA_DIR ?? ".online-data",
  allowedOrigins: list(env.ONLINE_ALLOWED_ORIGINS),
  turnTimeoutMs: env.ONLINE_TURN_TIMEOUT_MS !== undefined ? Number(env.ONLINE_TURN_TIMEOUT_MS) : 120_000,
  maxRooms: env.ONLINE_MAX_ROOMS ? Number(env.ONLINE_MAX_ROOMS) : undefined,
  log: (line) => console.log(new Date().toISOString(), line),
});
console.log(`YachtLab Online server: ${running.url}  (ws: ${running.url.replace(/^http/, "ws")}/ws/:code)`);
const stop = () => void running.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
