/**
 * Shared helpers for search-engine automation (D-067): content fingerprints for sitemap lastmod,
 * sitemap rendering/parsing, page metadata extraction and the checks run before an IndexNow submission.
 * Plain ESM without dependencies so it runs in Vitest, in the build scripts and in GitHub Actions.
 */
import { createHash } from "node:crypto";

export const SITE = "https://oyueo-mm.github.io/YachtLab/";
export const HOST = "oyueo-mm.github.io";
export const HOST_ROOT = `https://${HOST}/`;

const decode = (s) =>
  String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
const squash = (s) => decode(s).replace(/\s+/g, " ").trim();

/** Attribute value of the first tag matching `tagRe` (a regex source for the whole tag). */
function attrOf(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decode(m[2] ?? m[3] ?? "") : null;
}
function tags(html, tagName) {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) ?? [];
}
function metaContent(html, key, value) {
  for (const tag of tags(html, "meta")) if ((attrOf(tag, key) ?? "").toLowerCase() === value) return attrOf(tag, "content");
  return null;
}

/** Search-relevant metadata of one HTML document. */
export function extractMeta(html) {
  const links = tags(html, "link");
  const canonical = links.map((t) => (/\brel\s*=\s*["']?canonical/i.test(t) ? attrOf(t, "href") : null)).find(Boolean) ?? null;
  const robots = [metaContent(html, "name", "robots"), metaContent(html, "name", "googlebot"), metaContent(html, "name", "bingbot")]
    .filter(Boolean)
    .join(", ");
  const title = squash(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const jsonld = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim());
  return {
    title,
    description: metaContent(html, "name", "description"),
    canonical,
    robots,
    noindex: /\bnoindex\b|\bnone\b/i.test(robots),
    ogUrl: metaContent(html, "property", "og:url"),
    ogTitle: metaContent(html, "property", "og:title"),
    h1Count: (html.match(/<h1[\s>]/gi) ?? []).length,
    googleVerification: metaContent(html, "name", "google-site-verification"),
    naverVerification: metaContent(html, "name", "naver-site-verification"),
    jsonld,
  };
}

/**
 * Fingerprint of what a search engine indexes on a page: title, description, canonical, robots,
 * structured data and the text + link targets inside <main>. Shared navigation, footer, styles and
 * hashed asset names are left out, so a rebuild or a CSS change does not move lastmod.
 */
export function contentFingerprint(html) {
  const meta = extractMeta(html);
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  const body = main.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  const hrefs = [...body.matchAll(/<a\b[^>]*\shref\s*=\s*"([^"]*)"/gi)].map((m) => m[1].replace(/%BASE_URL%/g, "/YachtLab/"));
  const text = squash(body.replace(/<[^>]+>/g, " "));
  const parts = [meta.title, meta.description ?? "", meta.canonical ?? "", meta.robots, meta.jsonld.join("\n"), text, hrefs.join(" ")];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

/** YYYY-MM-DD in Korea time (the site's audience and the team's working day). */
export function kstDate(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

export function renderSitemap(entries) {
  const rows = entries.map(({ loc, lastmod }) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

export function parseSitemap(xml) {
  if (!/<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(xml)) throw new Error("not a sitemap 0.9 urlset");
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: decode(m[1].match(/<loc>([\s\S]*?)<\/loc>/)?.[1].trim() ?? ""),
    lastmod: m[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/)?.[1].trim() ?? null,
  }));
}

/** Same-site subresources a renderer loads for the page (stylesheets, icons, manifest, scripts, images). */
export function subresources(html, pageUrl) {
  const out = new Set();
  for (const tag of tags(html, "link")) {
    const rel = (attrOf(tag, "rel") ?? "").toLowerCase();
    if (/stylesheet|icon|manifest|modulepreload|preload/.test(rel) && attrOf(tag, "href")) out.add(attrOf(tag, "href"));
  }
  for (const tag of [...tags(html, "script"), ...tags(html, "img")]) if (attrOf(tag, "src")) out.add(attrOf(tag, "src"));
  return [...out]
    .filter((u) => !u.startsWith("data:"))
    .map((u) => new URL(u, pageUrl).href)
    .filter((u) => new URL(u).host === new URL(pageUrl).host);
}

/**
 * Problems with one sitemap URL's response. `res` is { status, headers: { get(name) }, url }, `html` its body.
 * Returns a list of human-readable problems (empty = OK).
 */
export function checkPage(loc, res, html) {
  const problems = [];
  if (res.status !== 200) return [`HTTP ${res.status}`];
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html/i.test(type)) problems.push(`content-type ${type || "(none)"}`);
  const xRobots = res.headers.get("x-robots-tag") ?? "";
  if (/noindex|none/i.test(xRobots)) problems.push(`X-Robots-Tag: ${xRobots}`);
  const meta = extractMeta(html);
  if (meta.noindex) problems.push(`meta robots: ${meta.robots}`);
  if (meta.canonical !== loc) problems.push(`canonical ${meta.canonical ?? "(none)"} ≠ ${loc}`);
  if (meta.ogUrl && meta.ogUrl !== loc) problems.push(`og:url ${meta.ogUrl} ≠ ${loc}`);
  if (meta.title.length < 10) problems.push(`title too short: "${meta.title}"`);
  if ((meta.description ?? "").length < 40) problems.push(`description missing or shorter than 40 characters`);
  if (meta.h1Count !== 1) problems.push(`${meta.h1Count} <h1> elements (expected 1)`);
  for (const block of meta.jsonld) {
    try {
      JSON.parse(block);
    } catch {
      problems.push("invalid JSON-LD");
    }
  }
  return problems;
}

/** IndexNow keys: 8–128 characters of a–z, A–Z, 0–9 and '-'. */
export const isValidIndexNowKey = (key) => /^[A-Za-z0-9-]{8,128}$/.test(key);

/**
 * Which URLs one endpoint still has to be told about. `submitted` maps url → lastmod last accepted
 * by that endpoint; `current` is the live sitemap. `all` resubmits every current URL.
 */
export function pendingUrls(current, submitted = {}, { all = false } = {}) {
  const live = new Map(current.map((e) => [e.loc, e.lastmod ?? ""]));
  const changed = [];
  const added = [];
  for (const [loc, lastmod] of live) {
    if (!(loc in submitted)) added.push(loc);
    else if (all || submitted[loc] !== lastmod) changed.push(loc);
  }
  const removed = Object.keys(submitted).filter((loc) => !live.has(loc));
  return { added, changed, removed, urls: [...added, ...changed, ...removed] };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Transient: network failure, 408, 425, 429 and 5xx. Everything else is final. */
export const isTransient = (status) => status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;

/**
 * fetch with exponential backoff on transient failures (honours Retry-After up to 60 s).
 * Returns { res, body, attempts, error } — never throws; res is null when every attempt failed at the network level.
 */
export async function fetchWithRetry(url, init = {}, { attempts = 5, baseDelayMs = 2000, timeoutMs = 20000, fetchImpl = fetch, wait = sleep } = {}) {
  let last = { res: null, body: "", attempts: 0, error: null };
  for (let i = 1; i <= attempts; i++) {
    let status = 0;
    try {
      const res = await fetchImpl(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(timeoutMs) });
      const body = await res.text();
      status = res.status;
      last = { res, body, attempts: i, error: null };
      if (!isTransient(status)) return last;
    } catch (error) {
      last = { res: null, body: "", attempts: i, error: String(error?.message ?? error) };
    }
    if (i === attempts) break;
    const retryAfter = Number(last.res?.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : baseDelayMs * 2 ** (i - 1));
  }
  return last;
}

/** Cache-busting variant of a URL so the Pages CDN (max-age=600) does not answer with the previous deployment. */
export const fresh = (url) => `${url}${url.includes("?") ? "&" : "?"}seo-check=${Date.now().toString(36)}`;
