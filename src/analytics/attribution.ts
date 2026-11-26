/**
 * Campaign attribution (Phase 6, D-065): reads utm_* parameters once, keeps the first and the latest
 * touch on this device, then removes them from the address bar (the invite `?room=` stays, so an
 * invite link with UTM still opens the room). Only the campaign fields are kept — no IP, no user id,
 * no referrer path. The stored touches are what a future first-party event (see
 * docs/context/GROWTH-2026-11-26.md) would attach; nothing is sent anywhere by this module.
 */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type Touch = { source: string; medium: string; campaign: string; content?: string; term?: string; at: number };
export type Attribution = { first: Touch | null; last: Touch | null };

const KEY = "yachtlab.attribution.v1";
const clean = (v: string | null) => (v ?? "").trim().slice(0, 80).replace(/[^\p{L}\p{N}_.\-+ ]/gu, "");

export function parseTouch(search: string, now = Date.now()): Touch | null {
  const q = new URLSearchParams(search);
  const source = clean(q.get("utm_source"));
  if (!source) return null;
  const t: Touch = { source, medium: clean(q.get("utm_medium")) || "(none)", campaign: clean(q.get("utm_campaign")) || "(none)", at: now };
  const content = clean(q.get("utm_content"));
  const term = clean(q.get("utm_term"));
  if (content) t.content = content;
  if (term) t.term = term;
  return t;
}

export function readAttribution(): Attribution {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? "null") as Attribution | null;
    return r && typeof r === "object" ? { first: r.first ?? null, last: r.last ?? null } : { first: null, last: null };
  } catch {
    return { first: null, last: null };
  }
}

/** Record the touch in the current URL (if any) and strip utm_* from the address bar. */
export function captureAttribution(now = Date.now()): Attribution {
  const current = readAttribution();
  if (typeof location === "undefined") return current;
  const touch = parseTouch(location.search, now);
  if (!touch) return current;
  const next = { first: current.first ?? touch, last: touch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  const url = new URL(location.href);
  for (const k of UTM_KEYS) url.searchParams.delete(k);
  history.replaceState(history.state, "", url.pathname + (url.search === "?" ? "" : url.search) + url.hash);
  return next;
}

/** Builds a campaign link (admin/promo tool). Keeps an existing `room` and hash. */
export function campaignUrl(base: string, t: { source: string; medium: string; campaign: string; content?: string; room?: string }) {
  const url = new URL(base);
  if (t.room) url.searchParams.set("room", t.room.toUpperCase());
  url.searchParams.set("utm_source", t.source.trim());
  url.searchParams.set("utm_medium", t.medium.trim());
  url.searchParams.set("utm_campaign", t.campaign.trim());
  if (t.content?.trim()) url.searchParams.set("utm_content", t.content.trim());
  return url.toString();
}
