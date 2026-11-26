#!/usr/bin/env node
/**
 * Keeps the hashed assets of recent deployments in a new Pages build (D-067).
 *
 * GitHub Pages replaces the whole site on every deploy, and the entry bundle's name changes on every build
 * (the build id is compiled in). A crawler that fetched the HTML before a deploy and renders it after —
 * Google renders in a separate, later step — then gets 404 for the old CSS/JS, which Search Console reports
 * as "page resources couldn't be loaded". An open tab of the previous build hits the same 404 on a lazy chunk.
 *
 * This copies the previous generations' assets (listed in the live asset-history.json, plus the live
 * sw.js lists and index.html) into the new build, for 14 days and at least the last 3 generations, and
 * writes the updated asset-history.json. Network failures only warn: the deploy never depends on them.
 *
 *   node scripts/seo/retain-assets.mjs dist-pages [--site https://oyueo-mm.github.io/YachtLab/]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SITE, fetchWithRetry } from "./seo-lib.mjs";

const KEEP_DAYS = 14;
const KEEP_MIN = 3;
const KEEP_MAX = 30;

export function assetsOf({ swJs = "", indexHtml = "" }) {
  const files = new Set();
  for (const name of ["ASSETS", "OPTIONAL_ASSETS"]) {
    const m = swJs.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`));
    if (m) for (const f of JSON.parse(m[1])) if (/^assets\//.test(f)) files.add(f);
  }
  for (const m of indexHtml.matchAll(/(?:src|href)="(?:\/YachtLab\/|\.\/)?(assets\/[^"?#]+)"/g)) files.add(m[1]);
  return [...files].sort();
}

/** History newest first; keeps generations younger than KEEP_DAYS, never fewer than KEEP_MIN. */
export function pruneHistory(history, now = Date.now()) {
  const seen = new Set();
  const unique = history.filter((g) => g && g.build && !seen.has(g.build) && seen.add(g.build));
  return unique.filter((g, i) => i < KEEP_MIN || now - Date.parse(g.at) <= KEEP_DAYS * 86400000).slice(0, KEEP_MAX);
}

export async function retain(dist, { site = SITE, now = new Date(), fetchImpl = fetch, log = console.log } = {}) {
  const get = async (path) => {
    const { res, body } = await fetchWithRetry(`${site}${path}?retain=${now.getTime().toString(36)}`, {}, { attempts: 3, fetchImpl });
    return res && res.status === 200 ? body : null;
  };
  const ownBuild = JSON.parse(readFileSync(join(dist, "version.json"), "utf8")).build;
  const own = assetsOf({ swJs: readFileSync(join(dist, "sw.js"), "utf8"), indexHtml: readFileSync(join(dist, "index.html"), "utf8") });
  let previous = [];
  const liveHistory = await get("asset-history.json");
  try {
    previous = liveHistory ? JSON.parse(liveHistory).generations ?? [] : [];
  } catch {
    previous = [];
  }
  const liveVersion = await get("version.json");
  const [liveSw, liveIndex] = await Promise.all([get("sw.js"), get("")]);
  if (liveVersion && liveSw && liveIndex) {
    const build = JSON.parse(liveVersion).build;
    if (!previous.some((g) => g.build === build)) previous.unshift({ build, at: now.toISOString(), files: assetsOf({ swJs: liveSw, indexHtml: liveIndex }) });
  } else log("warning: could not read the live build; only asset-history.json is used");

  const kept = pruneHistory(previous.filter((g) => g.build !== ownBuild), now.getTime());
  const generations = [{ build: ownBuild, at: now.toISOString(), files: own }, ...kept];
  const present = new Set(readdirSync(join(dist, "assets")).map((f) => "assets/" + f));
  let copied = 0;
  const missing = [];
  for (const file of new Set(kept.flatMap((g) => g.files))) {
    if (present.has(file)) continue;
    // Bytes, not text: assets can be binary (.wasm).
    let bytes = null;
    for (let attempt = 0; attempt < 3 && !bytes; attempt++) {
      try {
        const res = await fetchImpl(`${site}${file}`, { signal: AbortSignal.timeout(30000) });
        if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
        else if (res.status < 500 && res.status !== 429) break;
      } catch {
        // retry
      }
    }
    if (!bytes) {
      missing.push(file);
      continue;
    }
    const target = join(dist, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    present.add(file);
    copied++;
  }
  // Keep generations' lists to the files that really exist in this build.
  for (const g of kept) g.files = g.files.filter((f) => present.has(f));
  writeFileSync(join(dist, "asset-history.json"), JSON.stringify({ generations }, null, 2) + "\n");
  log(`asset retention: ${kept.length} previous generation(s), ${copied} file(s) copied, ${missing.length} unavailable${missing.length ? ": " + missing.join(", ") : ""}`);
  return { kept: kept.length, copied, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dist = process.argv[2] ?? "dist-pages";
  const i = process.argv.indexOf("--site");
  if (!existsSync(join(dist, "version.json"))) {
    console.error(`${dist} is not a built site`);
    process.exit(1);
  }
  try {
    await retain(dist, { site: i > 0 ? process.argv[i + 1] : SITE });
  } catch (error) {
    // Never block a deploy on the previous deployment's state.
    console.log(`warning: asset retention skipped: ${error.message}`);
  }
}
