import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM scripts without types
import { classify } from "../scripts/ci/classify-changes.mjs";
// @ts-expect-error plain ESM scripts without types
import { findMainPushers } from "../scripts/ci/audit-workflows.mjs";
// @ts-expect-error plain ESM scripts without types
import { syncWiki } from "../scripts/ci/sync-wiki.mjs";

const repoRoot = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv }).trim();

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "ci1-flow-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("snapshot generator is stable once its own PR is merged (no PR → merge → PR loop)", () => {
  function fixture() {
    const dir = path.join(root, "repo");
    for (const [rel, text] of [
      ["src/ai.ts", 'export const allAlgorithms = [];\nconst allAlgorithms2 = 1;\n'],
      ["src/engine.ts", "export const x = 1;\n"],
      ["package.json", JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", scripts: { test: "x" } })],
      [".github/workflows/a.yml", "name: a\n"],
      ["docs/context/README.md", "# hub\n"],
    ]) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); }
    writeFileSync(path.join(dir, "src/ai.ts"), 'const allAlgorithms = ["Random", "DP Expert"] as const;\n');
    writeFileSync(path.join(dir, "src/engine.ts"), 'export const categories = ["aces", "choice"] as const;\n');
    git(dir, "init", "-q", "-b", "main");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "feat: first change");
    return dir;
  }
  const generate = (dir: string) => {
    const env = { ...gitEnv } as Record<string, string | undefined>;
    delete env.GITHUB_TOKEN;
    return execFileSync("node", [path.join(repoRoot, "scripts/update-context.mjs"), "--write"], { cwd: dir, encoding: "utf8", env });
  };
  const commitGenerated = (dir: string, subject: string) => { git(dir, "add", "-A"); git(dir, "commit", "-qm", subject); };

  for (const subject of ["chore(context): refresh repository snapshot (#5)", "Merge pull request #6 from oyueo-mm/automation/context-sync"]) {
    it(`merging the snapshot as "${subject.slice(0, 40)}…" leaves the next generation unchanged`, () => {
      const dir = fixture();
      expect(generate(dir)).toContain("CONTEXT_UPDATED");
      expect(readFileSync(path.join(dir, "docs/context/_generated/manifest.json"), "utf8")).toContain("feat: first change");
      commitGenerated(dir, subject);
      const second = generate(dir);
      expect(second).not.toContain("CONTEXT_UPDATED");
      expect(git(dir, "status", "--porcelain")).toBe("");
      expect(readFileSync(path.join(dir, "docs/context/_generated/CURRENT_STATE.md"), "utf8")).not.toContain(subject.slice(0, 20));
    });
  }
});

describe("Wiki mirror (scenario 9) against a local bare wiki repository", () => {
  const NAMES = ["README", "RESULTS", "TECHNIQUES", "ROADMAP", "DECISIONS", "HANDOFF", "REFERENCES", "AUTOMATION"];
  function source(text = "v1") {
    const dir = path.join(root, "src-repo");
    mkdirSync(path.join(dir, "scripts"), { recursive: true });
    mkdirSync(path.join(dir, "docs/context/_generated"), { recursive: true });
    copyFileSync(path.join(repoRoot, "scripts/prepare-context-wiki.mjs"), path.join(dir, "scripts/prepare-context-wiki.mjs"));
    for (const name of NAMES) writeFileSync(path.join(dir, `docs/context/${name}.md`), `# ${name} ${text}\n`);
    writeFileSync(path.join(dir, "docs/context/_generated/CURRENT_STATE.md"), `# state ${text}\n`);
    return dir;
  }
  const wikiFiles = (remote: string) => {
    const check = path.join(root, "check-" + Math.random().toString(16).slice(2));
    git(root, "clone", "-q", remote, check);
    return { dir: check, files: readdirSync(check).filter((f) => f.endsWith(".md")).sort() };
  };

  it("bootstraps an empty wiki, is a no-op when current, and follows a merged change", () => {
    const remote = path.join(root, "wiki.git");
    git(root, "init", "-q", "--bare", "-b", "master", remote);
    const cwd = source("v1");
    expect(syncWiki({ remote, cwd })).toBe("updated");
    const first = wikiFiles(remote);
    expect(first.files).toContain("Home.md");
    expect(first.files).toContain("자동-현재-상태.md");
    expect(readFileSync(path.join(first.dir, "설계-결정.md"), "utf8")).toContain("DECISIONS v1");
    expect(syncWiki({ remote, cwd })).toBe("unchanged");
    const commitsBefore = git(first.dir, "rev-list", "--count", "HEAD");
    writeFileSync(path.join(cwd, "docs/context/_generated/CURRENT_STATE.md"), "# state v2 (merged snapshot)\n");
    expect(syncWiki({ remote, cwd })).toBe("updated");
    const second = wikiFiles(remote);
    expect(readFileSync(path.join(second.dir, "자동-현재-상태.md"), "utf8")).toContain("state v2");
    expect(Number(git(second.dir, "rev-list", "--count", "HEAD"))).toBe(Number(commitsBefore) + 1);
  });

  it("fails loudly (so a stale Wiki is visible) when the wiki repository does not exist", () => {
    expect(() => syncWiki({ remote: path.join(root, "missing.git"), cwd: source() })).toThrow(/Wiki push 실패/);
  });
});

describe("workflow contracts for branch protection (static)", () => {
  const sync = read(".github/workflows/context-sync.yml");
  const wiki = read(".github/workflows/context-wiki.yml");
  const deploy = read(".github/workflows/deploy.yml");
  const workflows = readdirSync(path.join(repoRoot, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f));

  it("Context sync never pushes to main and never skips CI", () => {
    expect(sync).not.toMatch(/git push|HEAD:main|\s--force\s|\s-f\s+\+/);
    expect(sync).not.toMatch(/\[skip ci\]|\[ci skip\]|skip-checks/i);
    expect(sync).toMatch(/^permissions:\n {2}contents: read$/m);
    const job = sync.slice(sync.indexOf("\n  sync:"));
    expect(job).toMatch(/contents: write/);
    expect(job).toMatch(/pull-requests: write/);
    expect(job).toMatch(/actions: write/);
    expect(job).not.toMatch(/(?:issues|statuses|checks|packages|deployments|id-token|pages|security-events): write/);
    expect(job).toContain("--allow docs/context/_generated/");
    expect(job).toContain("ensure-ci");
  });
  it("a merged snapshot cannot start another sync", () => {
    expect(sync).toMatch(/push:\n {4}branches: \[main\]\n {4}# [^\n]*\n {4}paths-ignore:\n {6}- "docs\/context\/_generated\/\*\*"/);
    expect(sync).toMatch(/concurrency:[\s\S]*cancel-in-progress: false/);
  });
  it("secrets are never interpolated into scripts and PR-triggered jobs get no write token", () => {
    const check = sync.slice(sync.indexOf("\n  check:"), sync.indexOf("\n  sync:"));
    expect(check).not.toMatch(/secrets\.|contents: write/);
    expect(sync).not.toMatch(/run:[^\n]*\$\{\{\s*(?:inputs|github\.event\.)/);
    for (const name of workflows) expect(read(`.github/workflows/${name}`), name).not.toMatch(/pull_request_target/);
  });
  it("the Wiki runs from merged main only, as its own workflow", () => {
    expect(wiki).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
    expect(wiki).toMatch(/ref: main/);
    expect(wiki).not.toMatch(/pull_request/);
    expect(wiki).toContain('"docs/context/_generated/CURRENT_STATE.md"');
    expect(wiki).not.toMatch(/git push|HEAD:main/);
    expect(sync).not.toMatch(/\.wiki\.git/);
  });
  it("deploys only from main and keeps the single required check", () => {
    expect(deploy).toMatch(/\n {2}ci-result:\n/);
    const deployJob = deploy.slice(deploy.indexOf("\n  deploy:"));
    expect(deployJob).toContain("github.ref == 'refs/heads/main'");
    expect(deployJob).toMatch(/needs\.ci-result\.result == 'success'/);
    expect(deploy).toMatch(/pull_request:\n/);
    expect(deploy).toMatch(/workflow_dispatch:/);
  });
  it("only the documented research workflows still push to main; the protected-path workflows never do", () => {
    const pushers = findMainPushers(path.join(repoRoot, ".github/workflows")).map((e: { workflow: string }) => e.workflow);
    for (const name of ["context-sync.yml", "context-wiki.yml", "deploy.yml", "deploy-online-worker.yml", "seo-indexnow.yml", "online-live-check.yml", "gameplay-ui-smoke.yml"]) expect(pushers).not.toContain(name);
    // inventory guard: a NEW workflow must not add a direct main push (use scripts/ci/publish-generated.mjs)
    const legacy = read("docs/operations/CI-1-CONTEXT-SYNC-PROTECTION.md");
    for (const name of pushers) expect(legacy, `${name} must be listed in the CI-1 guide inventory`).toContain(name);
  });
});

describe("scope policy for the automation PR", () => {
  it("generated documentation only is a docs-mode change: the real ci-result passes without build, browser or deploy", () => {
    expect(classify(["docs/context/_generated/CURRENT_STATE.md", "docs/context/_generated/manifest.json"])).toBe("docs");
    expect(classify(["docs/context/_generated/NEW-LATEST.md"])).toBe("docs");
  });
  it("a snapshot that also touched code would not be docs-only", () => {
    expect(classify(["docs/context/_generated/manifest.json", "src/ai.ts"])).toBe("full");
  });
});

describe("deploy.yml scope step for a manual run on the automation branch (the real step text, executed)", () => {
  function scopeScript() {
    const text = read(".github/workflows/deploy.yml");
    const after = text.slice(text.indexOf("id: classify"));
    const block = after.slice(after.indexOf("run: |\n") + 8, after.indexOf("\n\n  unit:"));
    return block.split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
  }
  function scope(changed: string[], env: Record<string, string>) {
    const dir = path.join(root, "scope-repo");
    mkdirSync(path.join(dir, "scripts/ci"), { recursive: true });
    copyFileSync(path.join(repoRoot, "scripts/ci/classify-changes.mjs"), path.join(dir, "scripts/ci/classify-changes.mjs"));
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(path.join(dir, "app.ts"), "1\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "base");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD"); // what a full-depth checkout provides
    git(dir, "checkout", "-q", "-b", "automation/context-sync");
    for (const file of changed) { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), "x\n"); }
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "snapshot");
    const out = path.join(root, "gh-output");
    writeFileSync(out, "");
    execFileSync("bash", ["-e", "-c", scopeScript()], {
      cwd: dir,
      env: { ...gitEnv, GITHUB_OUTPUT: out, HEAD: git(dir, "rev-parse", "HEAD"), BASE: "", FORCE_FULL: "false", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readFileSync(out, "utf8").trim();
  }
  it("generated docs only → mode=docs (ci-result passes without build, browser or deploy)", () => {
    expect(scope(["docs/context/_generated/CURRENT_STATE.md"], { EVENT: "workflow_dispatch", GITHUB_REF: "refs/heads/automation/context-sync" })).toBe("mode=docs");
  });
  it("anything else on that branch → full (fail safe)", () => {
    expect(scope(["docs/context/_generated/a.md", "src/x.ts"], { EVENT: "workflow_dispatch", GITHUB_REF: "refs/heads/automation/context-sync" })).toBe("mode=full");
  });
  it("a forced-full manual run stays full", () => {
    expect(scope(["docs/context/_generated/a.md"], { EVENT: "workflow_dispatch", GITHUB_REF: "refs/heads/automation/context-sync", FORCE_FULL: "true" })).toBe("mode=full");
  });
});
