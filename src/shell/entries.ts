import { useEffect, useState } from "react";
import { serverFeatures, type Features } from "../online/client";
import { isRoute, type Route } from "../routes";

/**
 * UI-1 entry registry for features owned by other tracks (2026-11-28). An entry is shown only when
 *   1. its route exists in this build (the owning PR is merged), and
 *   2. the server reports its feature flag as `true` in /api/features (flag off or old Worker → hidden), and
 *   3. sign-in is present when the feature is members-only.
 * So nothing appears for a feature whose flag is off, and merging a track's PR does not by itself expose it.
 * Placement rules (docs/context/UI-1-GAME-UX-2026-11-28.md §11): the header gains nothing new; the side menu
 * lists entries in their group; the home page shows at most one small "오늘" row under the two mode cards.
 */
export type EntryId = "daily" | "rewards" | "mailbox" | "suggestions";
export type FeatureFlag = "daily" | "retention" | "mailbox" | "feedback";
export type Entry = { id: EntryId; title: string; group: "게임" | "활동" | "소식"; flag: FeatureFlag; member: boolean; home?: string };

export const ENTRIES: readonly Entry[] = [
  // LIVE-1 #142 — features.daily (DAILY flag + secret + sign-in on the Worker)
  { id: "daily", title: "오늘의 요트", group: "게임", flag: "daily", member: false, home: "오늘의 요트 · 퍼즐" },
  // C5 #140 — attendance, activity streak, weekly streak, reward inbox, codes. Needs features.retention (requested).
  { id: "rewards", title: "출석·보상", group: "활동", flag: "retention", member: true, home: "출석·보상" },
  // ADMIN-1 #141 — notices + messages (rewards converge on the C5 inbox). Needs features.mailbox (requested).
  { id: "mailbox", title: "알림함", group: "소식", flag: "mailbox", member: true },
  // FEEDBACK-1 #141 — suggestion board. Needs features.feedback (requested; today only an internal flag).
  { id: "suggestions", title: "서비스 제안", group: "소식", flag: "feedback", member: true },
];

type FlagSource = Partial<Record<FeatureFlag, unknown>>;
export function visibleEntries(features: FlagSource | null, signedIn: boolean, has: (id: string) => boolean = isRoute): Entry[] {
  if (!features) return [];
  return ENTRIES.filter((e) => has(e.id) && features[e.flag] === true && (!e.member || signedIn));
}

/** /api/features once per server (cached by serverFeatures); null while loading or without a server. */
export function useServerFeatures(server: string | null) {
  const [features, setFeatures] = useState<(Features & FlagSource) | null>(null);
  useEffect(() => {
    if (!server) return setFeatures(null);
    let live = true;
    void serverFeatures(server).then((f) => live && setFeatures(f as Features & FlagSource));
    return () => { live = false; };
  }, [server]);
  return features;
}

export const asRoute = (id: EntryId) => id as string as Route;
