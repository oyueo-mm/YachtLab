#!/usr/bin/env node
/**
 * Checks the search-facing state of the site (D-067): every sitemap URL answers 200 HTML with a
 * self canonical, no noindex, a title/description/h1 and valid JSON-LD; the page's own stylesheets,
 * scripts, icons and images load; the IndexNow key and the Google/Naver ownership tokens are served.
 *
 *   node scripts/seo/verify-site.mjs                                  # production
 *   node scripts/seo/verify-site.mjs --base http://127.0.0.1:4173/YachtLab/ --no-host-root   # a local build
 *   node scripts/seo/verify-site.mjs --expect-sitemap public/sitemap.xml --wait 900          # after a deploy
 *   options: --json <file> (report), --no-resources
 * Exit code 1 when any error is found.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, HOST_ROOT, checkPage, contentFingerprint, extractMeta, fetchWithRetry, fresh, parseSitemap, subresources } from "./seo-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const CONFIG = JSON.parse(readFileSync(join(ROOT, "scripts/seo/indexnow.json"), "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function verifySite({ base = SITE, hostRoot = base === SITE, resources = true, expectSitemap = null, waitSeconds = 0, log = console.log } = {}) {
  const toFetch = (url) => (url.startsWith(SITE) ? base + url.slice(SITE.length) : url);
  const errors = [];
  const warnings = [];
  const pages = [];

  // 1. Sitemap (optionally wait until the CDN serves the expected one).
  let sitemapXml = "";
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const { res, body, error } = await fetchWithRetry(fresh(toFetch(SITE + "sitemap.xml")));
    sitemapXml = body;
    if (!res || res.status !== 200) {
      errors.push(`sitemap: ${res ? "HTTP " + res.status : error}`);
      break;
    }
    if (!/xml/.test(res.headers.get("content-type") ?? "")) errors.push(`sitemap content-type ${res.headers.get("content-type")}`);
    if (!expectSitemap || body === expectSitemap) break;
    if (Date.now() >= deadline) {
      warnings.push("live sitemap still differs from the expected build after waiting; continuing with the live one");
      break;
    }
    log("waiting for the deployed sitemap to reach the CDN…");
    await sleep(20000);
  }
  let entries = [];
  try {
    entries = parseSitemap(sitemapXml);
  } catch (error) {
    errors.push(`sitemap: ${error.message}`);
  }
  if (entries.length === 0 && !errors.length) errors.push("sitemap has no URLs");
  const seen = new Set();
  for (const { loc, lastmod } of entries) {
    if (seen.has(loc)) errors.push(`sitemap: duplicate ${loc}`);
    seen.add(loc);
    if (!loc.startsWith(SITE)) errors.push(`sitemap: ${loc} is outside ${SITE}`);
    if (!lastmod || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+([+-]\d{2}:\d{2}|Z))?$/.test(lastmod)) errors.push(`sitemap: ${loc} has no W3C lastmod`);
  }

  // 2. Pages and their resources.
  const checkedResources = new Map();
  for (const { loc, lastmod } of entries) {
    const { res, body, error } = await fetchWithRetry(fresh(toFetch(loc)));
    const problems = res ? checkPage(loc, res, body) : [`fetch failed: ${error}`];
    const meta = res?.status === 200 ? extractMeta(body) : null;
    const failedResources = [];
    if (res?.status === 200 && resources) {
      for (const url of subresources(body, toFetch(loc))) {
        if (!checkedResources.has(url)) {
          const r = await fetchWithRetry(url, {}, { attempts: 3 });
          checkedResources.set(url, r.res ? r.res.status : 0);
        }
        if (checkedResources.get(url) !== 200) failedResources.push(`${url} → ${checkedResources.get(url) || "network error"}`);
      }
    }
    for (const p of problems) errors.push(`${loc}: ${p}`);
    for (const r of failedResources) errors.push(`${loc}: resource ${r}`);
    pages.push({
      loc, lastmod, fingerprint: meta ? contentFingerprint(body) : null,
      status: res?.status ?? 0, title: meta?.title ?? null, canonical: meta?.canonical ?? null,
      robots: meta?.robots ?? "", problems: [...problems, ...failedResources],
    });
    if (loc === SITE && meta && meta.googleVerification !== CONFIG.googleSiteVerification) errors.push("home: Google Search Console verification meta tag is missing or changed");
  }

  // 3. IndexNow key (project copy) and host-root files.
  const keyChecks = [[CONFIG.fallbackKeyLocation, true]];
  if (hostRoot) keyChecks.unshift([CONFIG.keyLocation, true]);
  const keys = {};
  for (const [url] of keyChecks) {
    const { res, body } = await fetchWithRetry(fresh(toFetch(url)));
    keys[url] = !!res && res.status === 200 && body.trim() === CONFIG.key;
    if (!keys[url]) (url === CONFIG.keyLocation ? warnings : errors).push(`IndexNow key not served at ${url} (${res ? "HTTP " + res.status : "network error"})`);
  }
  if (hostRoot) {
    for (const { url, contains } of CONFIG.hostRootChecks) {
      const { res, body } = await fetchWithRetry(fresh(url));
      if (!res || res.status !== 200 || !body.includes(contains)) errors.push(`ownership file ${url} is not served (${res ? "HTTP " + res.status : "network error"})`);
    }
    const { res, body } = await fetchWithRetry(fresh(HOST_ROOT + "robots.txt"));
    if (!res || res.status !== 200) warnings.push(`host robots.txt: ${res ? "HTTP " + res.status : "network error"}`);
    else {
      if (!body.includes(`Sitemap: ${CONFIG.sitemap}`)) warnings.push("host robots.txt does not list the sitemap");
      if (/^\s*Disallow:\s*\/\s*$/im.test(body)) errors.push("host robots.txt disallows the whole host");
    }
  }
  return { checkedAt: new Date().toISOString(), base, entries, pages, keys, resources: Object.fromEntries(checkedResources), errors, warnings, sitemap: sitemapXml };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : null;
  };
  const base = arg("--base") ?? SITE;
  const expect = arg("--expect-sitemap");
  const report = await verifySite({
    base: base.endsWith("/") ? base : base + "/",
    hostRoot: !process.argv.includes("--no-host-root") && base === SITE,
    resources: !process.argv.includes("--no-resources"),
    expectSitemap: expect ? readFileSync(expect, "utf8") : null,
    waitSeconds: Number(arg("--wait") ?? 0),
  });
  if (arg("--json")) writeFileSync(arg("--json"), JSON.stringify(report, null, 2));
  for (const page of report.pages) console.log(`${page.problems.length ? "✗" : "✓"} ${page.status} ${page.loc} lastmod=${page.lastmod}${page.problems.length ? " — " + page.problems.join("; ") : ""}`);
  console.log(`resources checked: ${Object.keys(report.resources).length}, keys: ${JSON.stringify(report.keys)}`);
  for (const w of report.warnings) console.log("warning: " + w);
  for (const e of report.errors) console.error("error: " + e);
  process.exit(report.errors.length ? 1 : 0);
}
