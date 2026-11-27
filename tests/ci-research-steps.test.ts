import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_GH } from "./helpers/fake-gh";

/**
 * CI-1.1: every migrated research publish step is executed exactly as written in its workflow (the `run:` text),
 * in a temporary repository with a local bare origin and a recording `gh`, as the experiment would leave the
 * checkout: the report files plus unrelated downloaded artifacts and another experiment's report.
 * No experiment is run; this proves the shell text, quoting, wildcard, allowance and the CI-start step.
 */
const repoRoot = path.resolve(__dirname, "..");
const REAL_GIT = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd: string, ...args: string[]) => execFileSync(REAL_GIT, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv }).trim();

type Step = { file: string; job: string; publishRun: string; ciRun: string; branch: string; allow: string[] };
function collect(): Step[] {
  const dir = path.join(repoRoot, ".github/workflows");
  const out: Step[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && f !== "context-sync.yml")) {
    const text = readFileSync(path.join(dir, file), "utf8");
    for (const job of text.split(/\n(?=  [A-Za-z0-9_-]+:\n)/)) {
      if (!job.includes("publish-generated.mjs publish")) continue;
      const run = /        run: \|\n((?:          .*\n?)+)/.exec(job.slice(job.indexOf("id: publish")))?.[1] ?? "";
      const publishRun = run.split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
      const ciRun = /Start the required CI on the research report PR[\s\S]*?\n {8}run: (.+)(?:\n|$)/.exec(job)?.[1] ?? "";
      out.push({
        file,
        job: /^\s*([A-Za-z0-9_-]+):/.exec(job)?.[1] ?? "?",
        publishRun,
        ciRun,
        branch: /--branch (automation\/research-[a-z0-9-]+)/.exec(publishRun)?.[1] ?? "",
        allow: [...publishRun.matchAll(/--allow "([^"]+)"/g)].map((m) => m[1]),
      });
    }
  }
  return out;
}

let root: string, bin: string;
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "ci11-"));
  bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), FAKE_GH);
  chmodSync(path.join(bin, "gh"), 0o755);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const steps = collect();

describe("migrated research publish steps, executed as written", () => {
  it("collects every step with both scripts", () => {
    expect(steps).toHaveLength(30);
    for (const s of steps) { expect(s.publishRun, s.file).toContain("publish-generated.mjs publish"); expect(s.ciRun, s.file).toContain("ensure-ci"); }
  });

  it.each(steps.map((s) => [`${s.file} › ${s.job} → ${s.branch}`, s] as const))("%s", (_name, step) => {
    const id = step.branch.replace(/\W/g, "_");
    const origin = path.join(root, `${id}.git`);
    const work = path.join(root, id);
    const stateFile = path.join(root, `${id}-gh.json`);
    writeFileSync(stateFile, JSON.stringify({ prs: [], runs: [], calls: [], closed: [], nextPr: 1 }));
    git(root, "init", "--quiet", "--bare", "-b", "main", origin);
    git(root, "clone", "--quiet", origin, work);
    git(work, "checkout", "-q", "-b", "main");
    mkdirSync(path.join(work, "scripts/ci"), { recursive: true });
    copyFileSync(path.join(repoRoot, "scripts/ci/publish-generated.mjs"), path.join(work, "scripts/ci/publish-generated.mjs"));
    mkdirSync(path.join(work, "docs/context/_generated"), { recursive: true });
    writeFileSync(path.join(work, "docs/context/DECISIONS.md"), "# hand written\n");
    git(work, "add", "-A");
    git(work, "commit", "-qm", "init");
    git(work, "push", "-q", "origin", "main");
    const mainSha = git(work, "rev-parse", "HEAD");

    // what the experiment leaves behind: its report(s) …
    const reports = step.allow.map((a) => a.replace("*", "200K"));
    for (const r of reports) writeFileSync(path.join(work, r), `# report ${r}\n`);
    // … plus downloaded artifacts and another experiment's report, which must never be published
    mkdirSync(path.join(work, "training/results"), { recursive: true });
    writeFileSync(path.join(work, "training/results/summary.json"), "{}\n");
    writeFileSync(path.join(work, "docs/context/_generated/SOMEONE-ELSES-LATEST.md"), "other\n");

    const env = {
      ...gitEnv,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_GH_STATE: stateFile,
      REAL_GIT,
      GH_TOKEN: "fake",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "oyueo-mm/YachtLab",
      GITHUB_RUN_ID: "123456",
      GITHUB_OUTPUT: path.join(root, `${id}-out.txt`),
      PUBLISH_GENERATED_POLL_MS: "5",
    };
    writeFileSync(env.GITHUB_OUTPUT, "");
    const published = spawnSync("bash", ["-e", "-c", step.publishRun], { cwd: work, env, encoding: "utf8" });
    expect(published.status, published.stderr + published.stdout).toBe(0);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(state.prs).toHaveLength(1);
    expect(state.prs[0].head).toBe(step.branch);
    expect(state.prs[0].body).toContain("actions/runs/123456");
    git(work, "fetch", "-q", "origin", step.branch);
    const published_files = git(work, "diff", "--name-only", mainSha, `origin/${step.branch}`).split("\n").sort();
    expect(published_files).toEqual([...reports].sort());
    expect(git(work, "rev-parse", `origin/${step.branch}^`)).toBe(mainSha);
    expect(git(work, "ls-remote", "origin", "refs/heads/main").split(/\s+/)[0]).toBe(mainSha); // main untouched

    // the CI-start step, as written, with the PR head it would receive
    const headSha = /^head_sha=(.+)$/m.exec(readFileSync(env.GITHUB_OUTPUT, "utf8"))?.[1] ?? "";
    expect(headSha).toMatch(/^[0-9a-f]{40}$/);
    const ci = spawnSync("bash", ["-e", "-c", step.ciRun], { cwd: work, env: { ...env, HEAD_SHA: headSha }, encoding: "utf8" });
    expect(ci.status, ci.stderr + ci.stdout).toBe(0);
    expect(JSON.parse(readFileSync(stateFile, "utf8")).calls).toContain(`workflow run ref=${step.branch} full=false`);

    // re-running the identical step publishes nothing new and opens no second PR
    const again = spawnSync("bash", ["-e", "-c", step.publishRun], { cwd: work, env, encoding: "utf8" });
    expect(again.status, again.stderr).toBe(0);
    const after = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(after.prs).toHaveLength(1);
    expect(git(work, "ls-remote", "origin", `refs/heads/${step.branch}`).split(/\s+/)[0]).toBe(headSha);
  }, 60000);
});
