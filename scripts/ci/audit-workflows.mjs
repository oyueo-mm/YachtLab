#!/usr/bin/env node
/**
 * CI-1: lists the workflows whose steps push straight to main. With main protected (PR required) every one of
 * them fails at its push step. Informational by default; `--strict` exits 1 while any remain, so Work/the
 * operator can run it right before enabling the ruleset.
 *
 * CI-1.2: also audits how the research workflows start. Large research may only run on an explicit
 * `workflow_dispatch`: no `push`/`schedule` trigger, jobs that a pull request can run never hold a write
 * permission, and every publishing job is dispatch-only. `--strict` fails on any violation.
 *
 *   node scripts/ci/audit-workflows.mjs [--strict] [--json]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** `git push origin HEAD:main`, `git push origin main`, `git push origin HEAD:refs/heads/main`, `git push -f origin HEAD:main` ... */
const MAIN_PUSH = /git\s+push\b[^\n#]*?\s(?:HEAD:(?:refs\/heads\/)?|\+?)main(?=\s|$|;|\)|")/;

export function findMainPushers(dir = ".github/workflows") {
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => {
      const lines = readFileSync(path.join(dir, name), "utf8").split("\n");
      const pushes = lines.map((text, index) => ({ line: index + 1, text: text.trim() })).filter(({ text }) => !text.startsWith("#") && MAIN_PUSH.test(text));
      return { workflow: name, pushes };
    })
    .filter((entry) => entry.pushes.length > 0);
}

/** Research workflows = every workflow that publishes through publish-generated.mjs, plus these that never published. */
export const RESEARCH_WITHOUT_PUBLISH = ["competitive-research.yml", "confirm-v2.yml", "integrated-research.yml", "tabular-zoo.yml"];

/** Minimal structural reader for this repository's workflow style (no YAML dependency). */
export function parseWorkflow(text) {
  const lines = text.split("\n");
  const onAt = lines.findIndex((l) => l === "on:" || l.startsWith("on:"));
  const triggers = [];
  for (let i = onAt + 1; i < lines.length && !/^\S/.test(lines[i]); i += 1) {
    const m = /^ {2}([A-Za-z_]+):/.exec(lines[i]);
    if (m) triggers.push(m[1]);
  }
  const jobsAt = lines.indexOf("jobs:");
  const heads = [];
  for (let i = jobsAt + 1; i < lines.length; i += 1) if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) heads.push(i);
  heads.push(lines.length);
  const jobs = heads.slice(0, -1).map((start, k) => {
    const block = lines.slice(start, heads[k + 1]);
    const text = block.join("\n");
    const needsLine = block.find((l) => /^ {4}needs:/.test(l)) ?? "";
    const needs = needsLine.replace(/^ {4}needs:\s*/, "").replace(/[[\]]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
    const ifLine = block.find((l) => /^ {4}if:/.test(l));
    const permAt = block.findIndex((l) => l === "    permissions:");
    const perms = {};
    if (permAt >= 0) for (let i = permAt + 1; i < block.length && /^ {6}/.test(block[i]); i += 1) {
      const m = /^ {6}([a-z-]+):\s*(\w+)/.exec(block[i]);
      if (m) perms[m[1]] = m[2];
    }
    return { name: /^ {2}([A-Za-z0-9_-]+):/.exec(block[0])[1], needs, if: ifLine ? ifLine.replace(/^ {4}if:\s*/, "") : null, perms, publishes: text.includes("publish-generated.mjs publish") };
  });
  return { triggers, jobs };
}

/** Which jobs a pull request would run: no `if` that demands workflow_dispatch, and every needed job runs too. */
export function pullRequestJobs(jobs) {
  const cache = new Map();
  const byName = new Map(jobs.map((j) => [j.name, j]));
  const runs = (name) => {
    if (cache.has(name)) return cache.get(name);
    cache.set(name, false); // cycles never run
    const job = byName.get(name);
    const ok = !(job.if && /workflow_dispatch|!= 'pull_request'|== 'push'|== 'schedule'/.test(job.if)) && job.needs.every((n) => !byName.has(n) || runs(n));
    cache.set(name, ok);
    return ok;
  };
  return jobs.filter((j) => runs(j.name));
}

export function auditResearchStart(dir = ".github/workflows") {
  const problems = [];
  for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    if (name === "context-sync.yml") continue;
    const text = readFileSync(path.join(dir, name), "utf8");
    if (!text.includes("publish-generated.mjs publish") && !RESEARCH_WITHOUT_PUBLISH.includes(name)) continue;
    const { triggers, jobs } = parseWorkflow(text);
    for (const t of triggers) if (!["pull_request", "workflow_dispatch"].includes(t)) problems.push(`${name}: trigger '${t}' can start research without an explicit dispatch`);
    for (const job of pullRequestJobs(jobs)) {
      const writes = Object.entries(job.perms).filter(([, v]) => v === "write").map(([k]) => k);
      if (writes.length) problems.push(`${name}/${job.name}: runs on pull requests but has write permission (${writes.join(", ")})`);
      if (job.publishes) problems.push(`${name}/${job.name}: publishes but a pull request can run it`);
    }
    for (const job of jobs.filter((j) => j.publishes)) if (!job.if || !/workflow_dispatch/.test(job.if)) problems.push(`${name}/${job.name}: publishing job is not restricted to workflow_dispatch`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = findMainPushers();
  const starts = auditResearchStart();
  if (process.argv.includes("--json")) console.log(JSON.stringify({ mainPushers: found, researchStart: starts }, null, 2));
  else {
    console.log(`Workflows that push directly to main: ${found.length}`);
    for (const entry of found) console.log(`- ${entry.workflow}: lines ${entry.pushes.map((p) => p.line).join(", ")}`);
    console.log(`Research workflows that can start without an explicit workflow_dispatch, or give pull requests write access: ${starts.length}`);
    for (const problem of starts) console.log(`- ${problem}`);
  }
  if (process.argv.includes("--strict") && (found.length > 0 || starts.length > 0)) process.exit(1);
}
