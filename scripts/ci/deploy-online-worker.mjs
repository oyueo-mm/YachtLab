import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

class ReleaseError extends Error {}

const worker = "yachtlab-online";
const pagesUrl = "https://oyueo-mm.github.io/YachtLab/version.json";
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const commit = process.env.GITHUB_SHA;
const pagesBuild = process.env.PAGES_BUILD;
const previousVersion = process.env.EXPECTED_WORKER_VERSION;
// SEC-1-04: the bundle built and hashed by the credential-free job; this job never builds.
const bundle = process.env.WORKER_BUNDLE;
const bundleSha256 = process.env.WORKER_BUNDLE_SHA256;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const message = `git:${commit} actions:${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}`;

async function getJson(url, label, headers = {}) {
  try {
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (response.ok) return await response.json();
  } catch {
    // Response bodies and fetch errors can include request or account details.
  }
  throw new ReleaseError(`Could not read ${label}.`);
}

async function activeDeployment() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/deployments?per_page=1`;
  const response = await getJson(url, "Cloudflare deployment metadata", { Authorization: `Bearer ${token}` });
  const deployment = response?.result?.deployments?.[0];
  const version = deployment?.versions?.[0];
  if (!response?.success || !uuid.test(deployment?.id) || deployment.versions.length !== 1 ||
      version?.percentage !== 100 || !uuid.test(version?.version_id)) {
    throw new ReleaseError("Expected one valid Cloudflare Worker version serving 100% of traffic.");
  }
  return { id: deployment.id, version: version.version_id, message: deployment.annotations?.["workers/message"] };
}

function mainHead() {
  const result = spawnSync("git", ["ls-remote", "origin", "refs/heads/main"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 15_000,
  });
  return result.status === 0 ? result.stdout.trim().split(/\s+/)[0] : undefined;
}

let writeAttempted = false;
try {
  if (!/^[0-9a-f]{32}$/.test(account) || !token) throw new ReleaseError("The production environment credentials are required.");
  if (!/^[0-9a-f]{40}$/.test(commit) || !uuid.test(previousVersion) || !/^[0-9a-f]{7,40}-[0-9a-z]+$/.test(pagesBuild)) {
    throw new ReleaseError("The approved commit, rollback version and Pages build are required.");
  }

  if (!bundle || !/^[0-9a-f]{64}$/.test(bundleSha256 ?? "")) throw new ReleaseError("A verified prebuilt Worker bundle is required.");
  const before = await activeDeployment();
  if (before.version !== previousVersion) throw new ReleaseError("The active Worker version changed after review.");
  const pages = await getJson(pagesUrl, "the live Pages build", { "Cache-Control": "no-cache" });
  if (pages?.build !== pagesBuild) throw new ReleaseError("The live Pages build changed after review.");
  if (mainHead() !== commit) throw new ReleaseError("The reviewed commit is no longer the tip of main, or main could not be verified.");

  let actual;
  try {
    actual = createHash("sha256").update(readFileSync(bundle)).digest("hex");
  } catch {
    actual = "";
  }
  if (actual !== bundleSha256) throw new ReleaseError("The prebuilt Worker bundle changed after verification.");

  writeAttempted = true;
  const deploy = spawnSync("node_modules/.bin/wrangler", [
    "deploy", bundle, "--no-bundle", "--config", "worker/wrangler.toml", "--keep-vars", "--strict", "--message", message,
  ], {
    // Wrangler can print resolved variable values or upstream errors. Retain only verified metadata below.
    stdio: "ignore",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
    timeout: 300_000,
  });
  const after = await activeDeployment();
  if (after.id !== before.id && after.version !== before.version && after.message === message) {
    const summary = [
      "### Cloudflare Worker deployment",
      "",
      `- Commit: \`${commit}\``,
      `- Reviewed Pages build: \`${pagesBuild}\``,
      `- Bundle sha256 (built without credentials): \`${bundleSha256}\``,
      `- Deployment: \`${after.id}\``,
      `- Active Worker version (100%): \`${after.version}\``,
      `- Previous deployment / rollback version: \`${before.id}\` / \`${before.version}\``,
      "",
    ].join("\n");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    console.log(summary);
  } else {
    throw new ReleaseError("The deployment could not be matched to this run in Cloudflare.");
  }
  if (deploy.status !== 0) throw new ReleaseError("Wrangler exited unsuccessfully after the deployment was recorded.");

  const workerUrl = "https://yachtlab-online.hoho96385210.workers.dev";
  const [health, features, auth, currentPages] = await Promise.all([
    getJson(workerUrl + "/healthz", "Worker health"),
    getJson(workerUrl + "/api/features", "Worker features"),
    getJson(workerUrl + "/api/auth/config", "Worker login configuration"),
    getJson(pagesUrl, "the live Pages build", { "Cache-Control": "no-cache" }),
  ]);
  if (health?.ok !== true || features?.signIn !== true || features?.economy !== true || auth?.google !== true) {
    throw new ReleaseError("The deployed Worker did not report the expected public health and feature flags.");
  }
  if (currentPages?.build !== pagesBuild) throw new ReleaseError("The Pages build changed during the release. Check its compatibility.");
  console.log("Public Worker health and feature checks passed.");
} catch (error) {
  console.error(error instanceof ReleaseError ? error.message : "The Worker release check failed.");
  if (writeAttempted) console.error("A write was attempted. Inspect Cloudflare Deployments and follow the runbook before any retry.");
  process.exitCode = 1;
}
