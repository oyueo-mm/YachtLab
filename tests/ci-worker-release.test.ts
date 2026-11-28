import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error plain ESM script without types
import { deployedCommit, planRelease, stoppedByFailure, workerInputs } from "../scripts/ci/worker-release-plan.mjs";

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
  it("reads only this pipeline's release annotation", () => {
    const sha = "ddf208f1800e859afd61d330bd6ae322b207d5c5";
    expect(deployedCommit(`git:${sha} actions:46113118303/1`)).toBe(sha);
    for (const m of [undefined, "", "Rollback to 837e6a1e", `git:${sha}`, `git:${sha.slice(0, 7)} actions:1/1`]) expect(deployedCommit(m)).toBeNull();
  });
  it("stays stopped after a failed automatic run until a later manual release succeeds", () => {
    const run = (id: number, at: string, conclusion: string, status = "completed") => ({ id, created_at: at, conclusion, status });
    const failedAuto = [run(3, "2026-11-28T03:00:00Z", "failure"), run(2, "2026-11-28T02:00:00Z", "success")];
    expect(stoppedByFailure(failedAuto, [], 9)).toMatchObject({ id: 3 });
    expect(stoppedByFailure(failedAuto, [run(7, "2026-11-28T02:30:00Z", "success")], 9)).toMatchObject({ id: 3 });
    expect(stoppedByFailure(failedAuto, [run(8, "2026-11-28T04:00:00Z", "success")], 9)).toBeNull();
    expect(stoppedByFailure(failedAuto, [run(8, "2026-11-28T04:00:00Z", "failure")], 9)).toMatchObject({ id: 3 });
    // cancelled/skipped runs and the current run do not count
    expect(stoppedByFailure([run(9, "2026-11-28T05:00:00Z", "failure", "in_progress"), run(4, "2026-11-28T04:00:00Z", "cancelled"), run(2, "2026-11-28T02:00:00Z", "success")], [], 9)).toBeNull();
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
    expect(auto).not.toMatch(/contents: write|deployments: write|actions: write/);
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
    write("scripts/ci/deploy-online-worker.mjs", 'import { writeFileSync } from "node:fs";\nwriteFileSync("released.json", JSON.stringify({ sha: process.env.GITHUB_SHA, rollback: process.env.EXPECTED_WORKER_VERSION, pages: process.env.PAGES_BUILD }));\nprocess.exit(Number(process.env.FAKE_RELEASE_EXIT ?? 0));\n');
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
        : u.includes("deploy-online-worker-auto.yml") ? { workflow_runs: s.auto ?? [] }
        : u.includes("deploy-online-worker.yml") ? { workflow_runs: s.manual ?? [] }
        : u.includes("version.json") ? { build: s.pages }
        : null;
      return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
    };`)}`;
  function run(r: ReturnType<typeof repo>, head: string, state: Record<string, unknown>, extra: Record<string, string> = {}) {
    const out = spawnSync(process.execPath, ["--import", PRELOAD, SCRIPT], {
      cwd: r.dir, encoding: "utf8",
      env: { ...process.env, YL_REPO_ROOT: r.dir, HEAD_SHA: head, CLOUDFLARE_ACCOUNT_ID: "0".repeat(32), CLOUDFLARE_API_TOKEN: "t", GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "99", GITHUB_STEP_SUMMARY: "", YL_PAGES_POLL_MS: "10", YL_PAGES_WAIT_MS: "200", FAKE_STATE: JSON.stringify(state), ...extra },
    });
    const releasedFile = join(r.dir, "released.json");
    return { code: out.status, text: out.stdout + out.stderr, released: existsSync(releasedFile) ? JSON.parse(readFileSync(releasedFile, "utf8")) : null };
  }
  const msg = (sha: string) => `git:${sha} actions:1/1`;

  it("skips a UI-only commit without releasing", () => {
    const r = repo(); r.setMain(r.ui);
    const out = run(r, r.ui, { message: msg(r.base), pages: r.ui.slice(0, 7) + "-x" });
    expect(out.code).toBe(0); expect(out.text).toContain("No Worker input changed"); expect(out.released).toBeNull();
  });
  it("releases a shared-code change once Pages for the same commit is live", () => {
    const r = repo(); r.setMain(r.shared);
    const out = run(r, r.shared, { message: msg(r.base), pages: r.shared.slice(0, 7) + "-x" });
    expect(out.code).toBe(0);
    expect(out.released).toEqual({ sha: r.shared, rollback: "a765423b-ffd4-4197-8c3c-a205378ea6cf", pages: r.shared.slice(0, 7) + "-x" });
  });
  it("waits for Pages and stops when it never arrives", () => {
    const r = repo(); r.setMain(r.shared);
    const out = run(r, r.shared, { message: msg(r.base), pages: r.ui.slice(0, 7) + "-x" });
    expect(out.code).toBe(1); expect(out.text).toContain("Pages must be live before the Worker"); expect(out.released).toBeNull();
  });
  it("skips when main has moved on (the newer run releases)", () => {
    const r = repo(); r.setMain(r.config);
    const out = run(r, r.shared, { message: msg(r.base), pages: r.shared.slice(0, 7) + "-x" });
    expect(out.code).toBe(0); expect(out.text).toContain("its own run releases the Worker"); expect(out.released).toBeNull();
  });
  it("stops on guarded config changes, rollbacks and earlier failures", () => {
    const r = repo(); r.setMain(r.config);
    const pages = r.config.slice(0, 7) + "-x";
    expect(run(r, r.config, { message: msg(r.base), pages }).text).toContain("Guarded Worker inputs changed (worker/wrangler.toml)");
    expect(run(r, r.config, { message: "Rollback", pages }).text).toContain("not a recorded release");
    expect(run(r, r.config, { message: msg(r.base), trigger: "rollback", pages }).text).toContain("not a recorded release");
    const failed = run(r, r.config, { message: msg(r.shared), pages, auto: [{ id: 5, status: "completed", conclusion: "failure", created_at: "2026-11-28T01:00:00Z" }] });
    expect(failed.code).toBe(1); expect(failed.text).toContain("Automatic releases are stopped"); expect(failed.released).toBeNull();
  });
  it("reports a failed release step as a stop", () => {
    const r = repo(); r.setMain(r.shared);
    const out = run(r, r.shared, { message: msg(r.base), pages: r.shared.slice(0, 7) + "-x" }, { FAKE_RELEASE_EXIT: "1" });
    expect(out.code).toBe(1); expect(out.text).toContain("Automatic releases stay stopped");
  });
});
