#!/usr/bin/env node
/**
 * CI-1.2 automatic Worker release (D-100). Runs in the `worker-production` Environment after the main
 * "Test and deploy YachtLab" run (tests + Pages deploy) succeeded for HEAD_SHA.
 *
 * Order of checks — any "stop" exits 1 (visible red run, and it keeps later automatic runs stopped);
 * any "skip" exits 0 without touching Cloudflare:
 *   0. stop: this run is a re-run (releases are never retried), or the prepared artifact (built without credentials
 *      in the `prepare` job) does not match this commit and its recorded SHA-256 (SEC-1-04).
 *   1. stop: the release lock (worker-release-lock.mjs, SEC-1-03) finds a failed, re-run or mid-release cancelled
 *      release run after the last successful manual release; any history read error also stops.
 *   2. stop: the active 100% Worker is not a recorded release from this pipeline (dashboard deploy or rollback).
 *   3. skip: no Worker input changed between the active release commit and HEAD_SHA (UI/docs-only change).
 *      stop: a guarded input changed (Worker config, DO migrations, runtime vars, economy policy) ⇒ manual release.
 *   4. skip: main moved past HEAD_SHA (the newer run releases it).
 *   5. wait until the live Pages build is HEAD_SHA (Pages first); stop after 10 minutes.
 *   6. release with scripts/ci/deploy-online-worker.mjs, which re-checks the active version, the live Pages build
 *      and the main tip right before writing, records the new version and runs the public checks.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { deployedCommit, planRelease } from "./worker-release-plan.mjs";
import { releaseLock } from "./worker-release-lock.mjs";
import { verify } from "./worker-artifact.mjs";

const worker = "yachtlab-online";
const pagesUrl = "https://oyueo-mm.github.io/YachtLab/version.json";
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, HEAD_SHA: head, GITHUB_TOKEN: ghToken, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId } = process.env;
const root = process.env.YL_REPO_ROOT ?? process.cwd(); // tests run against a throwaway repository
const prepared = process.env.RELEASE_DIR; // artifact of the credential-free prepare job
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

class Stop extends Error {}
class Skip extends Error {}
const summary = (lines) => {
  const text = ["### Automatic Worker release", "", ...lines, ""].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
};
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 });

async function getJson(url, label, headers = {}) {
  try {
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (response.ok) return await response.json();
  } catch {
    // Response bodies and fetch errors can include request or account details.
  }
  throw new Stop(`Could not read ${label}.`);
}

const github = (path) => getJson(`https://api.github.com/repos/${repo}${path}`, "the release run history", { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json" });

async function activeDeployment() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/deployments?per_page=1`;
  const response = await getJson(url, "Cloudflare deployment metadata", { Authorization: `Bearer ${token}` });
  const deployment = response?.result?.deployments?.[0];
  const version = deployment?.versions?.[0];
  if (!response?.success || deployment?.versions?.length !== 1 || version?.percentage !== 100 || !uuid.test(version?.version_id ?? "")) {
    throw new Stop("Expected one Cloudflare Worker version serving 100% of traffic (a gradual rollout or split needs the operator).");
  }
  return { version: version.version_id, message: deployment.annotations?.["workers/message"], trigger: deployment.annotations?.["workers/triggered_by"] };
}

try {
  if (!/^[0-9a-f]{32}$/.test(account ?? "") || !token) throw new Stop("The production environment credentials are required.");
  if (!/^[0-9a-f]{40}$/.test(head ?? "")) throw new Stop("HEAD_SHA must be the full commit of the successful main run.");

  if (process.env.GITHUB_RUN_ATTEMPT !== "1") throw new Stop("This is a re-run. Releases are never retried: investigate, then release once with the manual workflow.");
  let artifact;
  try {
    artifact = verify(prepared ?? "", head);
  } catch (error) {
    throw new Stop(`Prepared release rejected: ${error.message}`);
  }

  let lock;
  try {
    lock = await releaseLock(github, Number(runId));
  } catch (error) {
    throw new Stop(error instanceof Stop ? error.message : `Could not evaluate the release lock (${error.message}).`);
  }
  if (lock.locked) throw new Stop(`Automatic releases are stopped: ${lock.reason}. Investigate, then release once with the manual workflow.`);

  const active = await activeDeployment();
  const released = active.trigger === "rollback" ? null : deployedCommit(active.message);
  if (!released) throw new Stop(`The active Worker ${active.version} is not a recorded release of this pipeline (dashboard deploy or rollback). Use the manual workflow.`);
  if (git("cat-file", "-e", `${released}^{commit}`).status !== 0 || git("merge-base", "--is-ancestor", released, head).status !== 0) {
    throw new Stop(`The active release commit ${released} is not an ancestor of ${head}. Use the manual workflow.`);
  }
  const changed = git("diff", "--no-renames", "--name-only", released, head).stdout.split("\n").filter(Boolean);
  const plan = planRelease(changed, artifact.inputs);
  if (plan.kind === "none") throw new Skip(`No Worker input changed since the active release \`${released}\` (version \`${active.version}\`).`);
  if (plan.kind === "manual") throw new Stop(`Guarded Worker inputs changed (${plan.guarded.join(", ")}). Release this commit with the manual workflow after review.`);

  const tip = git("ls-remote", "origin", "refs/heads/main").stdout.trim().split(/\s+/)[0];
  if (tip !== head) throw new Skip(`main is now \`${tip}\`; its own run releases the Worker.`);

  let pages;
  for (const deadline = Date.now() + Number(process.env.YL_PAGES_WAIT_MS ?? 10 * 60_000); ; ) {
    pages = (await getJson(`${pagesUrl}?t=${Date.now()}`, "the live Pages build", { "Cache-Control": "no-cache" }))?.build ?? "";
    const commit = pages.split("-")[0];
    if (commit.length >= 7 && head.startsWith(commit)) break;
    if (Date.now() > deadline) throw new Stop(`The live Pages build is still \`${pages}\`, not ${head.slice(0, 7)}. Pages must be live before the Worker.`);
    await new Promise((done) => setTimeout(done, Number(process.env.YL_PAGES_POLL_MS ?? 20_000)));
  }

  summary([`- Commit: \`${head}\``, `- Worker inputs changed since \`${released}\`: ${plan.worker.map((f) => `\`${f}\``).join(", ")}`, `- Bundle (built without credentials): sha256 \`${artifact.bundle.sha256}\``, `- Live Pages build: \`${pages}\``, `- Rollback version: \`${active.version}\``]);
  const release = spawnSync(process.execPath, ["scripts/ci/deploy-online-worker.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, GITHUB_SHA: head, EXPECTED_WORKER_VERSION: active.version, PAGES_BUILD: pages, WORKER_BUNDLE: artifact.bundlePath, WORKER_BUNDLE_SHA256: artifact.bundle.sha256 },
    timeout: 600_000,
  });
  if (release.status !== 0) throw new Stop("The release step failed. Automatic releases stay stopped until a manual release succeeds.");
} catch (error) {
  if (error instanceof Skip) {
    summary([`- Skipped: ${error.message}`]);
  } else {
    const message = error instanceof Stop ? error.message : "The automatic release check failed.";
    summary([`- **Stopped:** ${message}`]);
    console.error(message);
    process.exitCode = 1;
  }
}
