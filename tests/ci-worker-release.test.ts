import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error plain ESM script without types
import { GUARDED, deployedCommit, planRelease, workerInputs } from "../scripts/ci/worker-release-plan.mjs";
// @ts-expect-error plain ESM script without types
import { releaseLock, LockReadError, MAX_PAGES, PER_PAGE } from "../scripts/ci/worker-release-lock.mjs";
// @ts-expect-error plain ESM script without types
import { prepare, verify } from "../scripts/ci/worker-artifact.mjs";
// @ts-expect-error plain ESM script without types
import { redact } from "../scripts/ci/sync-wiki.mjs";

/** CI-1.2 (D-100): automatic Worker release decisions. No network, no Cloudflare. */
const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts/ci/auto-deploy-online-worker.mjs");

describe("Worker inputs (esbuild bundle of worker/src/index.ts)", () => {
  it("contains the Worker and the shared code it runs, not UI-only modules", async () => {
    const inputs = await workerInputs();
    for (const f of ["worker/src/index.ts", "worker/src/hub.ts", "worker/wrangler.toml", "src/online/room.ts", "src/engine.ts", "src/economy/live/catalog.ts"]) expect(inputs).toContain(f);
    for (const f of ["src/App.tsx", "src/play/OnlineGame.tsx", "src/review/ReviewPage.tsx", "src/shell/MatchRewards.tsx", "index.html", "docs/context/DECISIONS.md"]) expect(inputs).not.toContain(f);
    // The bundle has no npm packages today, so a UI dependency bump is not a Worker change.
    expect(inputs).not.toContain("package-lock.json");
  });
});

describe("release plan", () => {
  const inputs = ["worker/src/index.ts", "worker/wrangler.toml", "worker/src/economy.ts", "src/online/room.ts", "src/economy/live/config.ts", "src/economy/live/catalog.ts"];
  it("skips UI and docs changes", () => {
    expect(planRelease(["src/App.tsx", "docs/x.md", "package-lock.json"], inputs)).toEqual({ kind: "none", worker: [], guarded: [] });
  });
  it("releases Worker and shared-code changes automatically", () => {
    expect(planRelease(["src/App.tsx", "src/online/room.ts", "src/economy/live/catalog.ts"], inputs)).toMatchObject({ kind: "auto", worker: ["src/online/room.ts", "src/economy/live/catalog.ts"] });
  });
  it("sends config, migrations, runtime vars and economy policy to the manual workflow", () => {
    for (const f of ["worker/wrangler.toml", "worker/src/economy.ts", "src/economy/live/config.ts"]) {
      expect(planRelease(["worker/src/index.ts", f], inputs)).toMatchObject({ kind: "manual", guarded: [f] });
    }
  });
  it("SEC-1 2차 INT-8: C5 grant engine, retention policy, the admin payout path and daily reward approval are guarded", () => {
    const files = ["worker/src/grants.ts", "worker/src/retention.ts", "src/economy/retention/policy.ts", "worker/src/admin/grant-port.ts", "worker/src/admin/roles.ts", "src/daily/contract.ts"];
    for (const f of files) expect(planRelease([f], [...inputs, f])).toMatchObject({ kind: "manual", guarded: [f] });
    // other admin / daily code stays on the automatic path
    for (const f of ["worker/src/admin/api.ts", "worker/src/daily-api.ts"]) expect(planRelease([f], [...inputs, f])).toMatchObject({ kind: "auto" });
  });
  it("every guarded pattern matches a real Worker input (no dead entries)", async () => {
    const real = await workerInputs();
    for (const re of GUARDED) expect(real.some((f) => re.test(f)), String(re)).toBe(true);
  }, 60_000);
  it("reads only this pipeline's release annotation", () => {
    const sha = "ddf208f1800e859afd61d330bd6ae322b207d5c5";
    expect(deployedCommit(`git:${sha} actions:46113118303/1`)).toBe(sha);
    for (const m of [undefined, "", "Rollback to 837e6a1e", `git:${sha}`, `git:${sha.slice(0, 7)} actions:1/1`]) expect(deployedCommit(m)).toBeNull();
  });
});

/** SEC-1-03: a fake GitHub API over the run history of both release workflows. */
type Run = { id: number; created_at: string; status: string; conclusion: string | null; run_attempt: number };
function fakeGitHub(auto: Run[], manual: Run[], jobsOf: Record<number, { name: string; conclusion: string | null; steps?: { name: string; started_at: string | null; conclusion: string | null }[] }[]> = {}) {
  const calls: string[] = [];
  const get = async (path: string) => {
    calls.push(path);
    const jobs = /^\/actions\/runs\/(\d+)\/jobs/.exec(path);
    if (jobs) return { jobs: jobsOf[Number(jobs[1])] ?? [] };
    const m = /^\/actions\/workflows\/([^/]+)\/runs\?(.*)$/.exec(path);
    if (!m) throw new Error("unexpected " + path);
    const q = new URLSearchParams(m[2]);
    let list = (m[1] === "deploy-online-worker.yml" ? manual : auto).slice().sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
    if (q.get("status") === "success") list = list.filter((r) => r.conclusion === "success");
    const created = q.get("created");
    if (created) list = list.filter((r) => Date.parse(r.created_at) > Date.parse(created.slice(1)));
    const per = Number(q.get("per_page")), page = Number(q.get("page"));
    return { workflow_runs: list.slice((page - 1) * per, page * per) };
  };
  return { get, calls };
}
const at = (minute: number) => new Date(Date.UTC(2026, 10, 28, 0, minute)).toISOString();
const run = (id: number, minute: number, conclusion: string | null, extra: Partial<Run> = {}): Run => ({ id, created_at: at(minute), status: "completed", conclusion, run_attempt: 1, ...extra });
const deployed = (ok = true) => [{ name: "deploy", conclusion: ok ? "success" : "skipped" }];
const releaseStep = (started: boolean) => [{ name: "release", conclusion: "cancelled", steps: [{ name: "Set up job", started_at: at(1), conclusion: "success" }, { name: "Plan, release and record the yachtlab-online Worker", started_at: started ? at(2) : null, conclusion: started ? "cancelled" : null }] }];

describe("release lock (SEC-1-03)", () => {
  it("is open when nothing failed after the last manual release", async () => {
    const { get } = fakeGitHub([run(10, 20, "success"), run(11, 21, "success")], [run(1, 10, "success")], { 1: deployed() });
    expect(await releaseLock(get, 99)).toMatchObject({ locked: false, recovery: { id: 1 } });
  });
  it("locks on a failed automatic run and is not cleared by any number of later successful (skip) runs", async () => {
    // a failure followed by more skip runs than one page of history used to hold
    const skips = Array.from({ length: PER_PAGE * 2 + 5 }, (_, i) => run(100 + i, 40 + i, "success"));
    const { get } = fakeGitHub([run(50, 30, "failure"), ...skips], [run(1, 10, "success")], { 1: deployed() });
    expect(await releaseLock(get, 999)).toMatchObject({ locked: true, run: { id: 50 } });
  });
  it("is cleared only by a later manual run whose deploy job succeeded", async () => {
    const failed = [run(50, 30, "failure")];
    expect((await releaseLock(fakeGitHub(failed, [run(2, 40, "success")], { 2: deployed() }).get, 99)).locked).toBe(false);
    // a green manual run that never deployed is not a recovery
    expect((await releaseLock(fakeGitHub(failed, [run(2, 40, "success")], { 2: deployed(false) }).get, 99)).locked).toBe(true);
    // a manual release before the failure does not clear it
    expect((await releaseLock(fakeGitHub(failed, [run(2, 20, "success")], { 2: deployed() }).get, 99)).locked).toBe(true);
    // a re-run manual release is never a recovery
    expect((await releaseLock(fakeGitHub(failed, [run(2, 40, "success", { run_attempt: 2 })], { 2: deployed() }).get, 99)).locked).toBe(true);
  });
  it("locks on re-runs, timeouts, start-up failures and failed manual runs", async () => {
    const manual = [run(1, 10, "success")], jobs = { 1: deployed() };
    for (const bad of [run(60, 30, "success", { run_attempt: 2 }), run(61, 30, "timed_out"), run(62, 30, "startup_failure")]) {
      expect((await releaseLock(fakeGitHub([bad], manual, jobs).get, 99)).locked).toBe(true);
    }
    expect((await releaseLock(fakeGitHub([], [...manual, run(3, 30, "failure")], jobs).get, 99)).locked).toBe(true);
  });
  it("treats a cancellation as evidence only once the release step had started", async () => {
    const manual = [run(1, 10, "success")];
    expect((await releaseLock(fakeGitHub([run(70, 30, "cancelled")], manual, { 1: deployed(), 70: releaseStep(false) }).get, 99)).locked).toBe(false);
    expect((await releaseLock(fakeGitHub([run(70, 30, "cancelled")], manual, { 1: deployed(), 70: releaseStep(true) }).get, 99)).locked).toBe(true);
  });
  it("ignores the current run and runs still in progress (serialized by the concurrency group)", async () => {
    const { get } = fakeGitHub([run(80, 30, "failure"), run(81, 31, null, { status: "in_progress" })], [run(1, 10, "success")], { 1: deployed() });
    expect((await releaseLock(get, 80)).locked).toBe(false);
  });
  it("fails closed on unreadable or oversized history", async () => {
    const many = Array.from({ length: MAX_PAGES * PER_PAGE + 1 }, (_, i) => run(1000 + i, 20 + i, "success"));
    await expect(releaseLock(fakeGitHub(many, [run(1, 10, "success")], { 1: deployed() }).get, 99)).rejects.toBeInstanceOf(LockReadError);
    await expect(releaseLock(async () => ({}), 99)).rejects.toBeInstanceOf(LockReadError);
    await expect(releaseLock(async () => { throw new Error("HTTP 500"); }, 99)).rejects.toThrow();
  });
  it("reads every page since the last manual release", async () => {
    const skips = Array.from({ length: PER_PAGE + 3 }, (_, i) => run(100 + i, 40 + i, "success"));
    const { get, calls } = fakeGitHub(skips, [run(1, 10, "success")], { 1: deployed() });
    await releaseLock(get, 9999);
    expect(calls.filter((c) => c.includes("deploy-online-worker-auto.yml") && c.includes("page=2"))).toHaveLength(1);
    expect(calls.every((c) => !c.includes("deploy-online-worker-auto.yml") || c.includes("created=%3E"))).toBe(true);
  });
});

describe("prepared release artifact (SEC-1-04)", () => {
  it("builds the real Worker without credentials and rejects any mismatch", { timeout: 120_000 }, async () => {
    const out = mkdtempSync(join(tmpdir(), "yl-art-"));
    const head = "a".repeat(40);
    const m = await prepare(out, head, ROOT);
    expect(m.inputs).toContain("worker/src/index.ts");
    expect(verify(out, head)).toMatchObject({ head, bundle: { sha256: m.bundle.sha256 } });
    expect(() => verify(out, "b".repeat(40))).toThrow(/built from/);
    const tampered = mkdtempSync(join(tmpdir(), "yl-art-t-")); cpSync(out, tampered, { recursive: true });
    writeFileSync(join(tampered, "bundle/index.js"), readFileSync(join(out, "bundle/index.js"), "utf8") + "\n// injected");
    expect(() => verify(tampered, head)).toThrow(/SHA-256/);
    const extra = mkdtempSync(join(tmpdir(), "yl-art-x-")); cpSync(out, extra, { recursive: true });
    writeFileSync(join(extra, "bundle/evil.js"), "x");
    expect(() => verify(extra, head)).toThrow(/Unexpected files/);
    expect(() => verify(mkdtempSync(join(tmpdir(), "yl-art-e-")), head)).toThrow(/missing/);
  });
});

describe("workflow guardrails", () => {
  const auto = readFileSync(join(ROOT, ".github/workflows/deploy-online-worker-auto.yml"), "utf8");
  const manual = readFileSync(join(ROOT, ".github/workflows/deploy-online-worker.yml"), "utf8");
  it("runs only after a successful main push, in the production Environment, serialized with the manual path", () => {
    expect(auto).toMatch(/workflow_run:\n\s+workflows: \["Test and deploy YachtLab"\]/);
    expect(auto).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(auto).toContain("github.event.workflow_run.event == 'push'");
    expect(auto).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(auto).toContain("environment: worker-production");
    expect(auto).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    for (const wf of [auto, manual]) {
      expect(wf).toContain("group: yachtlab-online-worker-deploy");
      expect(wf).toContain("cancel-in-progress: false");
      expect(wf).toContain("vars.WORKER_PRODUCTION_DEPLOY_ENABLED");
    }
    expect(auto).toMatch(/^permissions: \{\}$/m);
    expect(auto).not.toContain("worker-production-approval");
  });
  it("keeps a separate operator approval for manual (high-risk) releases", () => {
    expect(manual).toMatch(/approve:\n\s+needs: verify[\s\S]*?environment: worker-production-approval/);
    expect(manual).toContain("required_reviewers");
    expect(manual).toMatch(/deploy:\n\s+needs: \[verify, approve\][\s\S]*?environment: worker-production\n/);
    // the approval job holds no Cloudflare credentials
    const approve = manual.slice(manual.indexOf("  approve:"), manual.indexOf("  deploy:"));
    expect(approve).not.toContain("secrets.");
    expect(auto).not.toMatch(/contents: write|deployments: write|actions: write/);
  });
  it("builds without credentials and releases only the verified artifact (SEC-1-04)", () => {
    const job = (wf: string, name: string, next?: string) => wf.slice(wf.indexOf(`  ${name}:`), next ? wf.indexOf(`  ${next}:`) : undefined);
    const prepareJob = job(auto, "prepare", "release"), releaseJob = job(auto, "release");
    const verifyJob = job(manual, "verify", "approve"), deployJob = job(manual, "deploy");
    for (const build of [prepareJob, verifyJob]) {
      expect(build).not.toContain("secrets.");
      expect(build).not.toContain("environment:");
      expect(build).toContain("worker-artifact.mjs prepare");
      expect(build).toContain("actions/upload-artifact");
    }
    for (const release of [releaseJob, deployJob]) {
      expect(release).toContain("npm ci --ignore-scripts");
      expect(release).not.toMatch(/run: npm ci\s*$|npm run build|npm test|wrangler deploy --dry-run|cache: npm/m);
      expect(release).toContain("actions/download-artifact");
    }
    expect(releaseJob).toContain('[ "$GITHUB_RUN_ATTEMPT" = 1 ]');
    expect(deployJob).toContain("worker-artifact.mjs verify");
  });
  it("keeps dispatch inputs and PR code away from shells and the live Worker (SEC-1-07/08/09)", () => {
    const wf = (f: string) => readFileSync(join(ROOT, ".github/workflows", f), "utf8");
    for (const f of ["competitive-research.yml", "confirm-v2.yml", "frontier-200k.yml", "v5-apex-research.yml"]) {
      const runs = wf(f).split("\n").filter((l) => /\$\{\{\s*(github\.event\.)?inputs\./.test(l) && !/^\s+[A-Z_]+: \$\{\{|^\s+(if|group|shard|ref):|fromJSON/.test(l));
      expect(runs, f).toEqual([]);
    }
    expect(wf("online-live-check.yml")).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(wf("context-wiki.yml")).not.toMatch(/x-access-token:\$\{/);
    expect(redact("fatal: unable to access 'https://x-access-token:ghs_secret@github.com/o/r.wiki.git/'")).not.toContain("ghs_secret");
  });
});

/**
 * The orchestrator end to end against a throwaway repository: Cloudflare, GitHub and Pages answers are stubbed
 * through a fetch preload, and the real release script is replaced by a recorder.
 */
describe("automatic release orchestrator", () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), "yl-auto-"));
    const write = (f: string, text: string) => { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), text); };
    sh(dir, "init", "-q", "-b", "main");
    sh(dir, "config", "user.email", "t@example.test"); sh(dir, "config", "user.name", "t");
    write("worker/src/index.ts", 'import { rule } from "../../src/shared";\nexport default { fetch: () => new Response(rule) };\n');
    write("worker/wrangler.toml", 'name = "x"\n');
    write("src/shared.ts", 'export const rule = "a";\n');
    write("src/ui.ts", 'export const ui = 1;\n');
    write("scripts/ci/deploy-online-worker.mjs", 'import { writeFileSync } from "node:fs";\nwriteFileSync("released.json", JSON.stringify({ sha: process.env.GITHUB_SHA, rollback: process.env.EXPECTED_WORKER_VERSION, pages: process.env.PAGES_BUILD, bundleSha: process.env.WORKER_BUNDLE_SHA256, bundle: process.env.WORKER_BUNDLE?.endsWith("bundle/index.js") }));\nprocess.exit(Number(process.env.FAKE_RELEASE_EXIT ?? 0));\n');
    const commit = (msg: string) => { sh(dir, "add", "-A"); sh(dir, "commit", "-qm", msg); return sh(dir, "rev-parse", "HEAD"); };
    const base = commit("base");
    write("src/ui.ts", 'export const ui = 2;\n'); const ui = commit("ui only");
    write("src/shared.ts", 'export const rule = "b";\n'); const shared = commit("shared rule");
    write("worker/wrangler.toml", 'name = "x"\n[vars]\nX = "1"\n'); const config = commit("config");
    const bare = mkdtempSync(join(tmpdir(), "yl-auto-origin-"));
    sh(bare, "init", "-q", "--bare");
    sh(dir, "remote", "add", "origin", bare);
    return { dir, base, ui, shared, config, setMain: (sha: string) => sh(dir, "push", "-qf", "origin", `${sha}:refs/heads/main`) };
  }
  const PRELOAD = `data:text/javascript,${encodeURIComponent(`
    const s = JSON.parse(process.env.FAKE_STATE);
    globalThis.fetch = async (url) => {
      const u = String(url);
      const body = u.includes("api.cloudflare.com") ? { success: true, result: { deployments: [{ id: "d", versions: [{ percentage: 100, version_id: "a765423b-ffd4-4197-8c3c-a205378ea6cf" }], annotations: { "workers/message": s.message, ...(s.trigger ? { "workers/triggered_by": s.trigger } : {}) } }] } }
        : u.includes("version.json") ? { build: s.pages }
        : u.includes("/jobs") ? { jobs: (s.jobs ?? {})[u.split("/actions/runs/")[1].split("/")[0]] ?? [] }
        : !u.includes("&page=1&") && !u.endsWith("&page=1") ? { workflow_runs: [] }
        : u.includes("deploy-online-worker-auto.yml") ? { workflow_runs: s.auto ?? [] }
        : u.includes("deploy-online-worker.yml") ? { workflow_runs: (s.manual ?? []).filter((r) => !u.includes("status=success") || r.conclusion === "success") }
        : u.includes("version.json") ? { build: s.pages }
        : null;
      return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
    };`)}`;
  /** What the credential-free prepare job would hand over for `head` (bundle content is irrelevant here). */
  async function artifact(r: ReturnType<typeof repo>, head: string) {
    const dir = mkdtempSync(join(tmpdir(), "yl-auto-art-"));
    mkdirSync(join(dir, "bundle"));
    writeFileSync(join(dir, "bundle/index.js"), "export default {};\n");
    const sha256 = createHash("sha256").update(readFileSync(join(dir, "bundle/index.js"))).digest("hex");
    writeFileSync(join(dir, "release.json"), JSON.stringify({ schema: "yachtlab-worker-release-v1", head, bundle: { file: "bundle/index.js", sha256, bytes: 19 }, inputs: await workerInputs(r.dir) }));
    return dir;
  }
  function run(r: ReturnType<typeof repo>, head: string, state: Record<string, unknown>, extra: Record<string, string> = {}, releaseDir?: string) {
    const out = spawnSync(process.execPath, ["--import", PRELOAD, SCRIPT], {
      cwd: r.dir, encoding: "utf8",
      env: { ...process.env, YL_REPO_ROOT: r.dir, HEAD_SHA: head, GITHUB_RUN_ATTEMPT: "1", RELEASE_DIR: releaseDir ?? "", CLOUDFLARE_ACCOUNT_ID: "0".repeat(32), CLOUDFLARE_API_TOKEN: "t", GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "99", GITHUB_STEP_SUMMARY: "", YL_PAGES_POLL_MS: "10", YL_PAGES_WAIT_MS: "200", FAKE_STATE: JSON.stringify(state), ...extra },
    });
    const releasedFile = join(r.dir, "released.json");
    return { code: out.status, text: out.stdout + out.stderr, released: existsSync(releasedFile) ? JSON.parse(readFileSync(releasedFile, "utf8")) : null };
  }
  const msg = (sha: string) => `git:${sha} actions:1/1`;

  it("skips a UI-only commit without releasing", async () => {
    const r = repo(); r.setMain(r.ui);
    const out = run(r, r.ui, { message: msg(r.base), pages: r.ui.slice(0, 7) + "-x" }, {}, await artifact(r, r.ui));
    expect(out.code).toBe(0); expect(out.text).toContain("No Worker input changed"); expect(out.released).toBeNull();
  });
  it("releases a shared-code change once Pages for the same commit is live", async () => {
    const r = repo(); r.setMain(r.shared);
    const out = run(r, r.shared, { message: msg(r.base), pages: r.shared.slice(0, 7) + "-x" }, {}, await artifact(r, r.shared));
    expect(out.code).toBe(0);
    expect(out.released).toMatchObject({ sha: r.shared, rollback: "a765423b-ffd4-4197-8c3c-a205378ea6cf", pages: r.shared.slice(0, 7) + "-x", bundle: true });
    expect(out.released.bundleSha).toMatch(/^[0-9a-f]{64}$/);
  });
  it("waits for Pages and stops when it never arrives", async () => {
    const r = repo(); r.setMain(r.shared);
    const out = run(r, r.shared, { message: msg(r.base), pages: r.ui.slice(0, 7) + "-x" }, {}, await artifact(r, r.shared));
    expect(out.code).toBe(1); expect(out.text).toContain("Pages must be live before the Worker"); expect(out.released).toBeNull();
  });
  it("skips when main has moved on (the newer run releases)", async () => {
    const r = repo(); r.setMain(r.config);
    const out = run(r, r.shared, { message: msg(r.base), pages: r.shared.slice(0, 7) + "-x" }, {}, await artifact(r, r.shared));
    expect(out.code).toBe(0); expect(out.text).toContain("its own run releases the Worker"); expect(out.released).toBeNull();
  });
  it("stops on guarded config changes, rollbacks and earlier failures", async () => {
    const r = repo(); r.setMain(r.config);
    const pages = r.config.slice(0, 7) + "-x";
    expect(run(r, r.config, { message: msg(r.base), pages }, {}, await artifact(r, r.config)).text).toContain("Guarded Worker inputs changed (worker/wrangler.toml)");
    expect(run(r, r.config, { message: "Rollback", pages }, {}, await artifact(r, r.config)).text).toContain("not a recorded release");
    expect(run(r, r.config, { message: msg(r.base), trigger: "rollback", pages }, {}, await artifact(r, r.config)).text).toContain("not a recorded release");
    const failed = run(r, r.config, { message: msg(r.shared), pages, auto: [{ id: 5, status: "completed", conclusion: "failure", created_at: "2026-11-28T01:00:00Z", run_attempt: 1 }] }, {}, await artifact(r, r.config));
    expect(failed.code).toBe(1); expect(failed.text).toContain("Automatic releases are stopped"); expect(failed.released).toBeNull();
  });
  it("reports a failed release step as a stop", async () => {
    const r = repo(); r.setMain(r.shared);
    const out = run(r, r.shared, { message: msg(r.base), pages: r.shared.slice(0, 7) + "-x" }, { FAKE_RELEASE_EXIT: "1" }, await artifact(r, r.shared));
    expect(out.code).toBe(1); expect(out.text).toContain("Automatic releases stay stopped");
  });
  it("stops on a re-run and on an artifact that is missing, for another commit or altered", async () => {
    const r = repo(); r.setMain(r.shared);
    const state = { message: msg(r.base), pages: r.shared.slice(0, 7) + "-x" };
    const good = await artifact(r, r.shared);
    const rerun = run(r, r.shared, state, { GITHUB_RUN_ATTEMPT: "2" }, good);
    expect(rerun.code).toBe(1); expect(rerun.text).toContain("re-run"); expect(rerun.released).toBeNull();
    expect(run(r, r.shared, state, {}, "").text).toContain("Prepared release rejected");
    expect(run(r, r.shared, state, {}, await artifact(r, r.base)).text).toContain("Prepared release rejected");
    writeFileSync(join(good, "bundle/index.js"), "tampered");
    const altered = run(r, r.shared, state, {}, good);
    expect(altered.code).toBe(1); expect(altered.text).toContain("SHA-256"); expect(altered.released).toBeNull();
  });
});
