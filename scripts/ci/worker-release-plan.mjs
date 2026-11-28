#!/usr/bin/env node
/**
 * CI-1.2: decides whether a main commit needs a production Worker release, and whether the automatic path may
 * do it (D-100). Pure functions are exported for tests; the CLI is used by deploy-online-worker-auto.yml.
 *
 *  - Worker inputs = every file esbuild bundles from worker/src/index.ts (type-only imports are erased, so a
 *    UI-only change to a shared type file does not count) + the Worker config; the dependency lock only when
 *    the bundle contains npm packages.
 *  - Guarded inputs need the manual release workflow: Worker config (bindings, Durable Object migrations,
 *    runtime vars such as kill switches or FRIEND_RESIDUE_CLEANUP) and the economy ledger/policy sources.
 *
 * Usage: node scripts/ci/worker-release-plan.mjs <deployed sha> <head sha>
 *   prints `worker=<none|auto|manual>` and the matching paths; exits 1 when the range cannot be read.
 */
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

/** Always Worker inputs even though esbuild does not report them. */
export const WORKER_EXTRA_INPUTS = ["worker/wrangler.toml", "worker/tsconfig.json"];
/** Added only when the bundle contains npm packages (today it bundles none: the lock only pins the toolchain). */
export const PACKAGE_INPUTS = ["package-lock.json", "package.json"];

/** Inputs whose change needs a reviewed manual release (D-100). */
export const GUARDED = [
  /^worker\/wrangler\.toml$/, // bindings, DO migrations, runtime vars (kill switches, cleanup flags)
  /^worker\/src\/economy\.ts$/, // ledger
  /^src\/economy\/live\/(config|rewards|draw)\.ts$/, // economy policy: rewards, prices, draw odds
];

export async function workerInputs(root = ROOT) {
  const { build } = await import("esbuild");
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["worker/src/index.ts"],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
    external: ["cloudflare:*", "node:*"],
    mainFields: ["module", "main"],
    conditions: ["workerd", "worker", "browser"],
  });
  const all = Object.keys(result.metafile.inputs).map((f) => relative(root, resolve(root, f)));
  const files = all.filter((f) => !f.startsWith("node_modules/") && !f.startsWith(".."));
  const packages = all.some((f) => f.startsWith("node_modules/")) ? PACKAGE_INPUTS : [];
  return [...new Set([...files, ...WORKER_EXTRA_INPUTS, ...packages])].sort();
}

/** @returns {{ kind: "none" | "auto" | "manual", worker: string[], guarded: string[] }} */
export function planRelease(changed, inputs) {
  const set = new Set(inputs);
  const worker = changed.filter((f) => set.has(f));
  const guarded = worker.filter((f) => GUARDED.some((re) => re.test(f)));
  return { kind: worker.length === 0 ? "none" : guarded.length ? "manual" : "auto", worker, guarded };
}

/** The deploy script annotates releases with `git:<sha> actions:<run>/<attempt>`. Anything else ⇒ null. */
export function deployedCommit(message) {
  const m = /^git:([0-9a-f]{40}) actions:\d+\/\d+$/.exec(message ?? "");
  return m ? m[1] : null;
}

/**
 * Stop rule: after a failed automatic run, automatic releases stay stopped until a manual release of the
 * Worker succeeds (D-100). Runs are GitHub workflow runs (newest first is not assumed).
 */
export function stoppedByFailure(autoRuns, manualRuns, currentRunId) {
  const done = (r) => r.status === "completed" && r.id !== currentRunId;
  const lastAuto = autoRuns.filter(done).filter((r) => r.conclusion === "success" || r.conclusion === "failure")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!lastAuto || lastAuto.conclusion !== "failure") return null;
  const cleared = manualRuns.some((r) => done(r) && r.conclusion === "success" && Date.parse(r.created_at) > Date.parse(lastAuto.created_at));
  return cleared ? null : lastAuto;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, to] = process.argv.slice(2);
  let changed;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", from, to], { cwd: ROOT, stdio: "ignore" });
    changed = execFileSync("git", ["diff", "--no-renames", "--name-only", from, to], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    console.error(`Cannot read the range ${from}..${to} (not an ancestor or missing history).`);
    process.exit(1);
  }
  const plan = planRelease(changed, await workerInputs());
  console.log(`worker=${plan.kind}`);
  for (const f of plan.worker) console.error(`${plan.guarded.includes(f) ? "guarded" : "worker "} ${f}`);
}
