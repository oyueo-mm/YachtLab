/**
 * Online server settings, read from Worker variables (wrangler.toml `[vars]`, or `--var` in tests).
 * Defaults are conservative so a misconfigured deployment fails closed.
 */
export type OnlineConfig = {
  allowedOrigins: string[];
  /** Turn time limit; null = no limit. */
  turnTimeoutMs: number | null;
  /** Rooms alive at once (directory count). Creating beyond this returns 503. */
  maxRooms: number;
  createPerMinute: number;
  /** Rooms that may be created per UTC day (persisted). Bounds daily free-tier usage; fail-closed. */
  dailyRoomLimit: number;
  joinPerMinute: number;
  /** Rooms with no sockets are removed after this idle time. */
  lobbyIdleMs: number;
  finishedIdleMs: number;
  /** Idle time on a finished result screen while a player remains connected. */
  resultIdleMs: number;
  playingIdleMs: number;
  /** Every room is removed this long after creation, whatever its state (data retention). */
  maxAgeMs: number;
  /** Server AI matches per UTC day (a sub-budget of dailyRoomLimit). */
  dailyAiLimit: number;
};

export type ConfigVars = Partial<Record<
  "ALLOWED_ORIGINS" | "TURN_TIMEOUT_MS" | "MAX_ROOMS" | "DAILY_ROOM_LIMIT" | "CREATE_PER_MINUTE" | "JOIN_PER_MINUTE" | "LOBBY_IDLE_MS" | "FINISHED_IDLE_MS" | "RESULT_IDLE_MS" | "PLAYING_IDLE_MS" | "ROOM_MAX_AGE_MS" | "DAILY_AI_LIMIT",
  string
>>;

const num = (value: string | undefined, fallback: number, min = 0) => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
};

export function readConfig(env: ConfigVars): OnlineConfig {
  const turn = num(env.TURN_TIMEOUT_MS, 120_000);
  return {
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    turnTimeoutMs: turn >= 1000 ? turn : null,
    maxRooms: num(env.MAX_ROOMS, 50, 1),
    createPerMinute: num(env.CREATE_PER_MINUTE, 5, 1),
    dailyRoomLimit: num(env.DAILY_ROOM_LIMIT, 300, 1),
    joinPerMinute: num(env.JOIN_PER_MINUTE, 30, 1),
    lobbyIdleMs: num(env.LOBBY_IDLE_MS, 30 * 60_000, 1000),
    finishedIdleMs: num(env.FINISHED_IDLE_MS, 30 * 60_000, 1000),
    resultIdleMs: num(env.RESULT_IDLE_MS, 10 * 60_000, 1000),
    playingIdleMs: num(env.PLAYING_IDLE_MS, 24 * 3600_000, 1000),
    maxAgeMs: num(env.ROOM_MAX_AGE_MS, 48 * 3600_000, 1000),
    dailyAiLimit: num(env.DAILY_AI_LIMIT, 100, 0),
  };
}
