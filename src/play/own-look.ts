import { useSyncExternalStore } from "react";
import { GUEST_LOOK, sanitizeLook, type PublicLook } from "../economy/live/catalog";
import { session } from "../identity/account-client";

/**
 * The signed-in player's own equipped look for screens without a server (offline AI, local games,
 * 1인 플레이). It comes from the account's economy snapshot (server-validated loadout) and is cached
 * on this device per account, so offline screens keep the look after a reload. Guests use the default
 * look. Presentation only: nothing here touches rules, dice values or AI.
 */
const KEY = "yachtlab.own-look.v1";
type Cached = { account: string; look: PublicLook };
const accountOf = (s: string | null) => (s ? s.split(".")[1] ?? null : null);
let current: PublicLook = read();
const listeners = new Set<() => void>();

function read(): PublicLook {
  try {
    const account = accountOf(session());
    if (!account) return GUEST_LOOK;
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Cached | null;
    return raw && raw.account === account ? sanitizeLook(raw.look) : GUEST_LOOK;
  } catch {
    return GUEST_LOOK;
  }
}
/** Called with the latest economy snapshot look (or null when signed out). */
export function setOwnLook(look: PublicLook | null) {
  const account = accountOf(session());
  // No snapshot yet (offline, server unreachable): a signed-in player keeps the cached look.
  const next = look && account ? sanitizeLook(look) : account ? read() : GUEST_LOOK;
  try {
    if (look && account) localStorage.setItem(KEY, JSON.stringify({ account, look: next } satisfies Cached));
    else if (!account) localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: memory only */
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  listeners.forEach((fn) => fn());
}
export const ownLook = () => current;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  const onSession = () => {
    current = read();
    fn();
  };
  window.addEventListener("yachtlab-session", onSession);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("yachtlab-session", onSession);
  };
};
export const useOwnLook = () => useSyncExternalStore(subscribe, ownLook, () => GUEST_LOOK);

/**
 * Board look for offline screens: only a board the player actually equipped changes the table; the
 * default board keeps each screen's original matte table exactly as before.
 */
export const equippedBoard = (look: PublicLook) => (look.board === GUEST_LOOK.board ? null : look);
