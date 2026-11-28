/**
 * A6 (SOC-1, 2026-11-28): the browser side of quick match around the C3 server queue.
 *
 *  - Countdown: after the server pairs two players the room already exists (the match is running, the
 *    turn timer is the room's usual 120 s), so the countdown is short (3 s, 5 s when a local AI game is
 *    being put aside) and can be skipped ("지금 입장"). It can not be declined: D-094 has no
 *    accept / decline, a declined pairing would be a forfeit for the other player.
 *  - Reload during the countdown: the matched seat is already saved (C3); this remembers "matched, not
 *    entered yet" per tab for 2 minutes so a reload enters the same match instead of losing it.
 *  - Several tabs: one tab per browser owns the wait (a localStorage lock with a heartbeat). Another tab
 *    shows "다른 탭에서 매칭 중" and can ask the owner to cancel (BroadcastChannel); it never opens a
 *    second ticket. The server's device / account duplicate check (C3) stays the authority across devices.
 */
export const MATCH_COUNTDOWN_MS = 3_000;
export const PRACTICE_COUNTDOWN_MS = 5_000;
export const MATCHED_KEEP_MS = 120_000;
export const LOCK_FRESH_MS = 20_000;
export const LOCK_BEAT_MS = 5_000;
const LOCK_KEY = "yachtlab.quick-lock.v1";
const MATCHED_KEY = "yachtlab.quick-matched.v1";

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
const safe = (get: () => KV | undefined): KV | null => {
  try {
    return get() ?? null;
  } catch {
    return null;
  }
};
const local = () => safe(() => (typeof localStorage !== "undefined" ? localStorage : undefined));
const session = () => safe(() => (typeof sessionStorage !== "undefined" ? sessionStorage : undefined));

/** Countdown for a pairing that just arrived (longer while a local AI game is being put aside). */
export const countdownFor = (localGameInProgress: boolean) => (localGameInProgress ? PRACTICE_COUNTDOWN_MS : MATCH_COUNTDOWN_MS);

/* ------------------------------------------------------------------- lock ------------------------------------------------------------------- */

export type MatchLock = { tab: string; at: number };
export function readLock(store: KV | null = local()): MatchLock | null {
  try {
    const v = JSON.parse(store?.getItem(LOCK_KEY) ?? "null") as MatchLock | null;
    return v && typeof v.tab === "string" && typeof v.at === "number" ? v : null;
  } catch {
    return null;
  }
}
/** Take the wait for this tab unless another tab holds a fresh lock. No storage (private mode): always ok. */
export function claimLock(tab: string, now: number, store: KV | null = local()): { ok: true } | { ok: false; holder: MatchLock } {
  if (!store) return { ok: true };
  const cur = readLock(store);
  if (cur && cur.tab !== tab && now - cur.at < LOCK_FRESH_MS) return { ok: false, holder: cur };
  store.setItem(LOCK_KEY, JSON.stringify({ tab, at: now }));
  return { ok: true };
}
export function beatLock(tab: string, now: number, store: KV | null = local()) {
  const cur = readLock(store);
  if (!store || (cur && cur.tab !== tab && now - cur.at < LOCK_FRESH_MS)) return false;
  store.setItem(LOCK_KEY, JSON.stringify({ tab, at: now }));
  return true;
}
export function releaseLock(tab: string, store: KV | null = local()) {
  if (readLock(store)?.tab === tab) store?.removeItem(LOCK_KEY);
}
/** Another tab is waiting right now (for the start button: "다른 탭에서 매칭 중"). */
export const otherTabWaiting = (tab: string, now: number, store: KV | null = local()) => {
  const cur = readLock(store);
  return !!cur && cur.tab !== tab && now - cur.at < LOCK_FRESH_MS;
};

/* ------------------------------------------------------- matched, not yet entered (per tab) ------------------------------------------------------- */

export type MatchedNote = { code: string; opponent: string; at: number };
export function rememberMatched(note: MatchedNote, store: KV | null = session()) {
  try {
    store?.setItem(MATCHED_KEY, JSON.stringify(note));
  } catch {
    /* private mode */
  }
}
export function matchedNotEntered(now: number, store: KV | null = session()): MatchedNote | null {
  try {
    const v = JSON.parse(store?.getItem(MATCHED_KEY) ?? "null") as MatchedNote | null;
    return v && typeof v.code === "string" && now - v.at < MATCHED_KEEP_MS ? v : null;
  } catch {
    return null;
  }
}
export function forgetMatched(store: KV | null = session()) {
  try {
    store?.removeItem(MATCHED_KEY);
  } catch {
    /* ignore */
  }
}

/* --------------------------------------------------------------- tab messages --------------------------------------------------------------- */

export type TabMessage = { t: "cancel-request"; from: string } | { t: "matched"; from: string; code: string } | { t: "ended"; from: string };
export function tabChannel(onMessage: (m: TabMessage) => void): { post(m: TabMessage): void; close(): void } {
  if (typeof BroadcastChannel === "undefined") return { post: () => undefined, close: () => undefined };
  const ch = new BroadcastChannel("yachtlab-match");
  ch.onmessage = (e) => onMessage(e.data as TabMessage);
  return { post: (m) => ch.postMessage(m), close: () => ch.close() };
}
