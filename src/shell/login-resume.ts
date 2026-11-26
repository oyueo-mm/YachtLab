/**
 * Deferred sign-in (Phase 4, D-063): a guest browses the shop freely; a purchase, draw, upgrade or
 * equip asks to sign in first. Before leaving for the sign-in page the shop's view is saved here, and
 * restored when the player comes back. Nothing is bought automatically: the restored item opens with
 * the server's fresh price and balance, and the player confirms again.
 */
import type { Route } from "../routes";

const KEY = "yachtlab.login-resume.v1";
const MAX_AGE_MS = 20 * 60 * 1000;

export type ShopResume = {
  route: Extract<Route, "shop" | "draw" | "inventory">;
  cat: string | null;
  tier: string;
  price: string;
  item: string | null;
  scrollY: number;
  at: number;
};

export function saveResume(state: Omit<ShopResume, "at">) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...state, at: Date.now() }));
  } catch {
    /* private mode: the player just lands on the profile as before */
  }
}

/** Read without removing (the shop consumes it once it has applied it). */
export function peekResume(now = Date.now()): ShopResume | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as ShopResume;
    if (!r || typeof r.at !== "number" || now - r.at > MAX_AGE_MS || !["shop", "draw", "inventory"].includes(r.route)) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

export function clearResume() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
