import { useEffect, useState } from "react";

declare const __BUILD_ID__: string;
/** This page's build (set by vite.config.ts; "dev" under the dev server and in unit tests). */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

let last = 0;
let latest: Promise<string | null> | null = null;
/** The build the server currently publishes (no cache), at most once every 10 minutes. */
function publishedBuild(): Promise<string | null> {
  if (BUILD_ID === "dev" || typeof fetch === "undefined") return Promise.resolve(null);
  if (latest && Date.now() - last < 10 * 60_000) return latest;
  last = Date.now();
  latest = fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((v: { build?: unknown } | null) => (typeof v?.build === "string" ? v.build : null))
    .catch(() => null);
  return latest;
}

/** True when a newer site was published than the one running in this tab (an old cached page). */
export function useUpdateAvailable(check: unknown): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let live = true;
    void publishedBuild().then((b) => live && setStale(!!b && b !== BUILD_ID));
    return () => {
      live = false;
    };
  }, [check]);
  return stale;
}
