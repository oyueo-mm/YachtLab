#!/usr/bin/env node
/**
 * IndexNow notification after a production deploy (D-067).
 *
 * 1. Verifies the live site (verify-site.mjs). Any error blocks the submission.
 * 2. Per endpoint (Bing, Naver) compares the live sitemap (loc + lastmod) with the lastmod that endpoint
 *    last accepted (state.json). No state yet ⇒ every sitemap URL is new (first run: all pages).
 *    New and changed URLs are submitted, URLs gone from the sitemap are submitted once as removed.
 * 3. Transient failures (network, 408/429/5xx) are retried with backoff inside the run; an endpoint that
 *    still fails keeps its old state, so the next run (next deploy, daily schedule or manual run) retries it.
 * 4. Appends every attempt to log.jsonl and writes a Markdown summary.
 *
 *   node scripts/seo/indexnow-submit.mjs --state <dir> [--mode changed|all] [--dry-run]
 *        [--endpoints bing,naver] [--expect-sitemap public/sitemap.xml --wait 900] [--summary <file>]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SITE, fetchWithRetry, fresh, isValidIndexNowKey, pendingUrls } from "./seo-lib.mjs";
import { CONFIG, verifySite } from "./verify-site.mjs";

export async function submitToEndpoint(endpoint, { host, key, keyLocation, urlList }, options = {}) {
  const { res, body, attempts, error } = await fetchWithRetry(
    endpoint,
    { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ host, key, keyLocation, urlList }) },
    { attempts: 5, baseDelayMs: 5000, ...options },
  );
  const status = res?.status ?? 0;
  return { ok: status === 200 || status === 202, status, attempts, error, response: body.slice(0, 500) };
}

export function applyResult(state, name, pending, current, result, now) {
  const entry = (state.endpoints[name] ??= { urls: {} });
  if (!result.ok) {
    entry.lastFailure = { at: now, status: result.status };
    return;
  }
  const live = new Map(current.map((e) => [e.loc, e.lastmod ?? ""]));
  for (const url of [...pending.added, ...pending.changed]) entry.urls[url] = live.get(url);
  for (const url of pending.removed) delete entry.urls[url];
  entry.lastSuccess = { at: now, status: result.status, count: pending.urls.length };
  delete entry.lastFailure;
}

export async function run({ base = SITE, stateDir, mode = "changed", dryRun = false, endpoints = Object.keys(CONFIG.endpoints), expectSitemap = null, waitSeconds = 0, summaryFile = null, context = {}, log = console.log }) {
  if (!isValidIndexNowKey(CONFIG.key)) throw new Error("invalid IndexNow key in scripts/seo/indexnow.json");
  mkdirSync(stateDir, { recursive: true });
  const stateFile = join(stateDir, "state.json");
  const logFile = join(stateDir, "log.jsonl");
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { version: 1, endpoints: {} };
  const now = new Date().toISOString();
  const lines = [];
  const record = (entry) => {
    const line = { at: now, mode, dryRun, ...context, ...entry };
    lines.push(line);
    if (!dryRun) appendFileSync(logFile, JSON.stringify(line) + "\n");
  };

  const report = await verifySite({ base, expectSitemap, waitSeconds, log });
  writeFileSync(join(stateDir, "last-verify.json"), JSON.stringify({ ...report, sitemap: undefined }, null, 2) + "\n");
  const summary = [`## IndexNow (${mode}${dryRun ? ", dry run" : ""})`, "", `Checked ${report.pages.length} sitemap URLs at ${report.checkedAt}.`, ""];
  for (const w of report.warnings) summary.push(`- ⚠️ ${w}`);
  if (report.errors.length) {
    for (const e of report.errors) summary.push(`- ❌ ${e}`);
    record({ result: "blocked", errors: report.errors });
    finish(summaryFile, summary, log);
    return { ok: false, blocked: true, lines };
  }
  const keyLocation = report.keys[CONFIG.keyLocation] ? CONFIG.keyLocation : CONFIG.fallbackKeyLocation;
  summary.push(`Key location: ${keyLocation}`);
  const current = report.entries;

  summary.push("", "| endpoint | new | changed | removed | result | attempts |", "|---|---:|---:|---:|---|---:|");
  let ok = true;
  for (const name of endpoints) {
    const endpoint = CONFIG.endpoints[name];
    if (!endpoint) throw new Error(`unknown endpoint ${name}`);
    const pending = pendingUrls(current, state.endpoints[name]?.urls, { all: mode === "all" });
    for (const url of pending.removed) {
      const { res } = await fetchWithRetry(fresh(base + url.slice(SITE.length)), {}, { attempts: 2 });
      if (res && res.status === 200) log(`note: ${url} left the sitemap but still answers 200`);
    }
    if (pending.urls.length === 0) {
      summary.push(`| ${name} | 0 | 0 | 0 | nothing to submit | 0 |`);
      record({ endpoint: name, result: "nothing", urls: [] });
      continue;
    }
    let result = { ok: true, status: "dry-run", attempts: 0, response: "" };
    if (!dryRun) result = await submitToEndpoint(endpoint, { host: CONFIG.host, key: CONFIG.key, keyLocation, urlList: pending.urls });
    if (!dryRun) applyResult(state, name, pending, current, result, now);
    ok &&= result.ok;
    summary.push(`| ${name} | ${pending.added.length} | ${pending.changed.length} | ${pending.removed.length} | ${result.ok ? "✅" : "❌"} ${result.status}${result.error ? " " + result.error : ""} | ${result.attempts} |`);
    record({ endpoint: name, result: result.ok ? "accepted" : "failed", status: result.status, attempts: result.attempts, error: result.error ?? undefined, response: result.response || undefined, keyLocation, added: pending.added, changed: pending.changed, removed: pending.removed });
    log(`${name}: ${result.ok ? "accepted" : "FAILED"} ${result.status} (${pending.urls.length} URLs, ${result.attempts} attempts) ${result.response}`);
  }
  if (!dryRun) {
    state.sitemap = CONFIG.sitemap;
    state.updatedAt = now;
    writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");
  }
  summary.push("", "<details><summary>Sitemap URLs</summary>", "", ...current.map((e) => `- ${e.loc} — lastmod ${e.lastmod}`), "", "</details>");
  finish(summaryFile, summary, log);
  return { ok, lines, state };
}

function finish(summaryFile, summary, log) {
  const text = summary.join("\n") + "\n";
  if (summaryFile) appendFileSync(summaryFile, text);
  else log(text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : null;
  };
  const expect = arg("--expect-sitemap");
  const result = await run({
    base: arg("--base") ?? SITE,
    stateDir: arg("--state") ?? ".seo-state",
    mode: arg("--mode") ?? "changed",
    dryRun: process.argv.includes("--dry-run"),
    endpoints: (arg("--endpoints") ?? Object.keys(CONFIG.endpoints).join(",")).split(",").map((s) => s.trim()).filter(Boolean),
    expectSitemap: expect && existsSync(expect) ? readFileSync(expect, "utf8") : null,
    waitSeconds: Number(arg("--wait") ?? 0),
    summaryFile: arg("--summary") ?? process.env.GITHUB_STEP_SUMMARY ?? null,
    context: { sha: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined, trigger: process.env.GITHUB_EVENT_NAME },
  });
  process.exit(result.ok ? 0 : 1);
}

