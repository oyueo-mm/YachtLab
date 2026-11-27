import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM scripts without types
import { assertAutomationBranch, isAllowedPath, sameWithoutKeys } from "../scripts/ci/publish-generated.mjs";

/**
 * CI-1 scenarios 1–7, 10 against REAL git repositories (a local bare "origin" and a work clone) and a fake `gh`
 * that records its calls. These prove the script's logic; they do not prove GitHub's behaviour (see the ops guide).
 */
const SCRIPT = path.resolve(__dirname, "../scripts/ci/publish-generated.mjs");
const REAL_GIT = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const ALLOW = "docs/context/_generated/";
const MANIFEST = "docs/context/_generated/manifest.json";
const STATE = "docs/context/_generated/CURRENT_STATE.md";

const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const { execFileSync } = require("child_process");
const file = process.env.FAKE_GH_STATE;
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const real = process.env.REAL_GIT;
state.calls.push(args.slice(0, 2).join(" ") + (args[0] === "workflow" ? " ref=" + opt("--ref") + " " + args.slice(args.indexOf("-f") + 1).join(" ") : ""));
if (args[0] === "pr" && args[1] === "list") { console.log(JSON.stringify(state.prs.map(({ number, url }) => ({ number, url })))); }
else if (args[0] === "pr" && args[1] === "create" && process.env.FAKE_GH_REFUSE_CREATE) {
  console.error("pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)"); process.exit(1);
} else if (args[0] === "pr" && args[1] === "create") {
  const number = state.nextPr++; const url = "https://example.test/pull/" + number;
  state.prs.push({ number, url, head: opt("--head"), title: opt("--title"), body: fs.readFileSync(opt("--body-file"), "utf8") });
  console.log("created " + url); console.log(url);
} else if (args[0] === "pr" && args[1] === "edit") {
  const pr = state.prs.find((p) => String(p.number) === args[2]); pr.title = opt("--title"); pr.body = fs.readFileSync(opt("--body-file"), "utf8");
} else if (args[0] === "pr" && args[1] === "close") {
  const pr = state.prs.find((p) => String(p.number) === args[2]);
  state.closed.push({ number: pr.number, comment: opt("--comment") });
  if (args.includes("--delete-branch")) execFileSync(real, ["push", "--quiet", "origin", "--delete", pr.head]);
  state.prs = state.prs.filter((p) => p !== pr);
} else if (args[0] === "run" && args[1] === "list") { console.log(JSON.stringify(state.runs)); }
else if (args[0] === "workflow" && args[1] === "run") {
  if (!process.env.FAKE_GH_NO_RUN) {
    const line = execFileSync(real, ["ls-remote", "origin", "refs/heads/" + opt("--ref")], { encoding: "utf8" });
    state.runs.push({ databaseId: 100 + state.runs.length, headSha: line.split(/\\s+/)[0], event: "workflow_dispatch", status: "queued", conclusion: null });
  }
} else { console.error("fake gh: unsupported " + args.join(" ")); process.exit(2); }
save();
`;

// A git shim that lets a competing writer move the automation branch right after `ls-remote` read it (a concurrent run).
const GIT_SHIM = `#!/bin/bash
"$REAL_GIT" "$@"; rc=$?
if [ "$1" = "ls-remote" ] && [ -n "$RACE_FLAG" ] && [ -f "$RACE_FLAG" ]; then
  rm -f "$RACE_FLAG"
  ( cd "$RACE_CLONE" && "$REAL_GIT" -c user.name=racer -c user.email=r@example.test commit --allow-empty -qm "competing writer" && "$REAL_GIT" push -q -f origin HEAD:refs/heads/automation/context-sync ) >/dev/null 2>&1
fi
exit $rc
`;

let root: string, work: string, origin: string, bin: string, stateFile: string, outFile: string;
const git = (cwd: string, ...args: string[]) => execFileSync(REAL_GIT, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" } }).trim();
const write = (rel: string, text: string) => { mkdirSync(path.dirname(path.join(work, rel)), { recursive: true }); writeFileSync(path.join(work, rel), text); };
const gh = () => JSON.parse(readFileSync(stateFile, "utf8"));
const remoteSha = (ref: string) => git(work, "ls-remote", "origin", ref).split(/\s+/)[0] ?? "";

function manifest(structural: string, volatile: string) {
  return JSON.stringify({ schema: 1, algorithms: [structural], recentSourceCommits: [volatile], recentWorkflowRuns: [], workflowQuery: "q" }, null, 2) + "\n";
}

function run(command: string, args: string[], env: Record<string, string> = {}) {
  writeFileSync(outFile, "");
  const result = spawnSync("node", [SCRIPT, command, ...args], {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_GH_STATE: stateFile, REAL_GIT, GITHUB_OUTPUT: outFile, PUBLISH_GENERATED_POLL_MS: "5", ...env },
  });
  const outputs = Object.fromEntries(readFileSync(outFile, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, outputs };
}
const publish = (extra: string[] = [], env: Record<string, string> = {}) =>
  run("publish", ["--branch", "automation/context-sync", "--allow", ALLOW, "--title", "chore(context): refresh repository snapshot", "--volatile-json", MANIFEST, "--volatile-keys", "recentSourceCommits,recentWorkflowRuns,workflowQuery", "--derived", STATE, ...extra], env);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ci1-"));
  origin = path.join(root, "origin.git");
  work = path.join(root, "work");
  bin = path.join(root, "bin");
  stateFile = path.join(root, "gh-state.json");
  outFile = path.join(root, "out.txt");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "gh"), FAKE_GH);
  chmodSync(path.join(bin, "gh"), 0o755);
  writeFileSync(stateFile, JSON.stringify({ prs: [], runs: [], calls: [], closed: [], nextPr: 7 }));
  git(root, "init", "--quiet", "--bare", "-b", "main", origin);
  git(root, "clone", "--quiet", origin, work);
  git(work, "checkout", "-q", "-b", "main");
  write(MANIFEST, manifest("A", "c1"));
  write(STATE, "# state A c1\n");
  write("docs/context/DECISIONS.md", "# decisions (hand written)\n");
  write("src/app.ts", "export const x = 1;\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "init");
  git(work, "push", "-q", "origin", "main");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("pure guards", () => {
  it("accepts only automation/ branches", () => {
    expect(assertAutomationBranch("automation/context-sync")).toBe("automation/context-sync");
    for (const bad of ["main", "master", "claude/ci-1", "automation/", "automation/../main", "automation//x", "refs/heads/main", "", "automation/a b", "automation/x.lock"]) expect(() => assertAutomationBranch(bad)).toThrow();
  });
  it("allows generated paths only and refuses traversal", () => {
    const allow = [ALLOW];
    expect(isAllowedPath("docs/context/_generated/CURRENT_STATE.md", allow)).toBe(true);
    expect(isAllowedPath("docs/context/_generated/", allow)).toBe(false);
    for (const bad of ["docs/context/DECISIONS.md", "docs/context/_generatedX/a.md", "docs/context/_generated/../DECISIONS.md", "/docs/context/_generated/a", ".github/workflows/deploy.yml", "docs/context/_generated/.git/config", "src/ai.ts", "docs/context/_generated//a"]) expect(isAllowedPath(bad, allow)).toBe(false);
    expect(isAllowedPath("a/b.json", ["a/b.json"])).toBe(true);
  });
  it("separates structural from per-commit fields", () => {
    const a = JSON.parse(manifest("A", "c1")), volatile = JSON.parse(manifest("A", "c2")), structural = JSON.parse(manifest("B", "c1"));
    const keys = ["recentSourceCommits", "recentWorkflowRuns", "workflowQuery"];
    expect(sameWithoutKeys(a, volatile, keys)).toBe(true);
    expect(sameWithoutKeys(a, structural, keys)).toBe(false);
  });
});

describe("publish", () => {
  it("1. first run: one automation branch on top of main and one PR; main is untouched", () => {
    const mainBefore = remoteSha("refs/heads/main");
    write(MANIFEST, manifest("B", "c2"));
    write(STATE, "# state B c2\n");
    write("docs/context/_generated/NEW-LATEST.md", "new\n");
    const result = publish();
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs.action).toBe("created");
    expect(remoteSha("refs/heads/main")).toBe(mainBefore);
    const tip = remoteSha("refs/heads/automation/context-sync");
    expect(tip).toBe(result.outputs.head_sha);
    git(work, "fetch", "-q", "origin", "automation/context-sync");
    expect(git(work, "rev-parse", `${tip}^`)).toBe(mainBefore);
    expect(git(work, "diff", "--name-status", mainBefore, tip).split("\n").sort()).toEqual([`A\tdocs/context/_generated/NEW-LATEST.md`, `M\t${MANIFEST}`, `M\t${STATE}`].sort());
    expect(git(work, "log", "-1", "--format=%an <%ae>", tip)).toContain("github-actions[bot]");
    const state = gh();
    expect(state.prs).toHaveLength(1);
    expect(state.prs[0].title).toBe("chore(context): refresh repository snapshot");
    expect(state.prs[0].body).toContain("docs/context/_generated/NEW-LATEST.md");
    expect(state.calls.filter((c: string) => c === "pr create")).toHaveLength(1);
  });

  it("2. an existing PR is updated in place, never duplicated; an identical re-run changes nothing", () => {
    write(MANIFEST, manifest("B", "c2"));
    expect(publish().outputs.action).toBe("created");
    const first = remoteSha("refs/heads/automation/context-sync");
    const again = publish();
    expect(again.outputs.action).toBe("unchanged");
    expect(remoteSha("refs/heads/automation/context-sync")).toBe(first);
    expect(again.outputs.head_sha).toBe(first);
    write(MANIFEST, manifest("C", "c3"));
    const updated = publish();
    expect(updated.outputs.action).toBe("updated");
    expect(remoteSha("refs/heads/automation/context-sync")).not.toBe(first);
    const state = gh();
    expect(state.prs).toHaveLength(1);
    expect(state.calls.filter((c: string) => c === "pr create")).toHaveLength(1);
    expect(state.calls.filter((c: string) => c === "pr edit")).toHaveLength(1);
  });

  it("3. nothing to publish: no branch, no commit, no PR call", () => {
    const result = publish();
    expect(result.status).toBe(0);
    expect(result.outputs.action).toBe("noop");
    expect(remoteSha("refs/heads/automation/context-sync")).toBe("");
    expect(gh().calls.filter((c: string) => c.startsWith("pr create") || c.startsWith("pr edit"))).toHaveLength(0);
  });

  it("3b. main already contains the output: the now-pointless PR is closed and its branch removed", () => {
    write(MANIFEST, manifest("B", "c2"));
    publish();
    const tip = remoteSha("refs/heads/automation/context-sync");
    git(work, "fetch", "-q", "origin", "automation/context-sync");
    git(work, "push", "-q", "origin", `${tip}:refs/heads/main`); // the PR was merged (fast-forward)
    const result = publish(); // working tree still holds the same generated output
    expect(result.outputs.action).toBe("closed-stale");
    expect(remoteSha("refs/heads/automation/context-sync")).toBe("");
    expect(gh().prs).toHaveLength(0);
  });

  it("5/6. after the snapshot PR is merged, a re-run finds nothing to do — no PR chain", () => {
    write(MANIFEST, manifest("B", "c2"));
    publish();
    const tip = remoteSha("refs/heads/automation/context-sync");
    // GitHub merged it (merge commit, as this repository does) and closed the PR; the bot branch lingers.
    const merger = path.join(root, "merger");
    git(root, "clone", "--quiet", origin, merger);
    git(merger, "merge", "--no-ff", "-q", "-m", "Merge pull request #7 from oyueo-mm/automation/context-sync", `origin/automation/context-sync`);
    git(merger, "push", "-q", "origin", "HEAD:main");
    const state = gh();
    state.prs = [];
    writeFileSync(stateFile, JSON.stringify(state));
    write(MANIFEST, manifest("B", "c2")); // generator output equals what main now holds
    const result = publish();
    expect(result.outputs.action).toBe("noop");
    expect(gh().calls.filter((c: string) => c === "pr create")).toHaveLength(1);
  });

  it("4a. a main that moved on: the branch is rebuilt on the latest main (up to date), nothing lost", () => {
    write(MANIFEST, manifest("B", "c2"));
    publish();
    const old = remoteSha("refs/heads/automation/context-sync");
    git(work, "stash", "-q", "-u");
    write("src/app.ts", "export const x = 2;\n");
    git(work, "commit", "-qam", "feature merged to main");
    git(work, "push", "-q", "origin", "main");
    git(work, "stash", "pop", "-q");
    const result = publish();
    expect(result.outputs.action).toBe("updated");
    const tip = remoteSha("refs/heads/automation/context-sync");
    expect(tip).not.toBe(old);
    git(work, "fetch", "-q", "origin", "automation/context-sync");
    expect(git(work, "rev-parse", `${tip}^`)).toBe(remoteSha("refs/heads/main"));
    expect(git(work, "show", `${tip}:src/app.ts`)).toContain("x = 2");
    expect(gh().prs).toHaveLength(1);
  });

  it("4b. a competing writer between observe and push makes the push fail loudly and loses nothing; the re-run recovers", () => {
    write(MANIFEST, manifest("B", "c2"));
    publish();
    // a second clone used by the racer starts from the current automation branch
    const racer = path.join(root, "racer");
    git(root, "clone", "--quiet", "-b", "automation/context-sync", origin, racer);
    const flag = path.join(root, "race.flag");
    writeFileSync(flag, "1");
    writeFileSync(path.join(bin, "git"), GIT_SHIM);
    chmodSync(path.join(bin, "git"), 0o755);
    write(MANIFEST, manifest("C", "c3"));
    const raced = publish([], { RACE_FLAG: flag, RACE_CLONE: racer });
    expect(raced.status).toBe(1);
    expect(raced.stderr).toMatch(/stale info|rejected|실패/);
    const competing = remoteSha("refs/heads/automation/context-sync");
    expect(git(work, "log", "-1", "--format=%s", competing).length).toBeGreaterThan(0);
    // safe re-run
    const rerun = publish();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(rerun.outputs.action).toBe("updated");
    expect(gh().prs).toHaveLength(1);
  });

  it("7. any change outside the allowed generated paths aborts before anything is created", () => {
    write(MANIFEST, manifest("B", "c2"));
    write("docs/context/DECISIONS.md", "# overwritten by a buggy generator\n");
    const hand = publish();
    expect(hand.status).toBe(1);
    expect(hand.stderr).toContain("docs/context/DECISIONS.md");
    git(work, "checkout", "--", "docs/context/DECISIONS.md");
    write("scripts/evil.mjs", "x\n");
    const untracked = publish();
    expect(untracked.status).toBe(1);
    expect(untracked.stderr).toContain("scripts/evil.mjs");
    rmSync(path.join(work, "scripts"), { recursive: true });
    git(work, "rm", "-q", "src/app.ts");
    expect(publish().status).toBe(1);
    expect(remoteSha("refs/heads/automation/context-sync")).toBe("");
    expect(gh().calls.filter((c: string) => c.startsWith("pr "))).toEqual([]);
    expect(git(work, "ls-remote", "origin").includes("automation")).toBe(false);
  });

  it("refuses to write main or any non-automation branch", () => {
    write(MANIFEST, manifest("B", "c2"));
    const before = remoteSha("refs/heads/main");
    for (const branch of ["main", "claude/x"]) {
      const r = run("publish", ["--branch", branch, "--allow", ALLOW, "--title", "t"]);
      expect(r.status).toBe(1);
    }
    expect(remoteSha("refs/heads/main")).toBe(before);
  });

  it("push-triggered runs skip volatile-only changes unless a PR already exists", () => {
    write(MANIFEST, manifest("A", "c2")); // only recentSourceCommits moved
    write(STATE, "# state A c2\n");
    const skipped = publish(["--skip-volatile-only"]);
    expect(skipped.outputs.action).toBe("skipped-volatile");
    expect(remoteSha("refs/heads/automation/context-sync")).toBe("");
    // a structural change is proposed even on push
    write(MANIFEST, manifest("B", "c2"));
    expect(publish(["--skip-volatile-only"]).outputs.action).toBe("created");
    // with a PR open, volatile changes still refresh it (keeps it based on the latest main)
    write(MANIFEST, manifest("B", "c9"));
    expect(publish(["--skip-volatile-only"]).outputs.action).toBe("updated");
  });

  it("scheduled run publishes a volatile-only change", () => {
    write(MANIFEST, manifest("A", "c2"));
    write(STATE, "# state A c2\n");
    expect(publish().outputs.action).toBe("created");
  });

  it("explains the one admin setting when GitHub refuses to let Actions create pull requests, keeping the pushed branch", () => {
    write(MANIFEST, manifest("B", "c2"));
    const refused = publish([], { FAKE_GH_REFUSE_CREATE: "1" });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("Allow GitHub Actions to create and approve pull requests");
    expect(remoteSha("refs/heads/automation/context-sync")).not.toBe("");
    // after the admin enables the setting a plain re-run only creates the PR (branch reused, no new commit)
    const tip = remoteSha("refs/heads/automation/context-sync");
    const retry = publish();
    expect(retry.outputs.action).toBe("created");
    expect(remoteSha("refs/heads/automation/context-sync")).toBe(tip);
    expect(gh().prs).toHaveLength(1);
  });

  it("dry-run builds the commit without pushing or calling the PR API for writes", () => {
    write(MANIFEST, manifest("B", "c2"));
    const result = publish(["--dry-run"]);
    expect(result.outputs.action).toBe("dry-run");
    expect(remoteSha("refs/heads/automation/context-sync")).toBe("");
    expect(gh().calls.filter((c: string) => c === "pr create")).toHaveLength(0);
  });
});

describe("ensure-ci (the required check must exist on the PR head commit)", () => {
  const SHA = "a".repeat(40);
  const args = (extra: string[] = []) => ["--branch", "automation/context-sync", "--sha", SHA, "--wait-seconds", "1", ...extra];
  const setRuns = (runs: unknown[]) => writeFileSync(stateFile, JSON.stringify({ ...gh(), runs }));
  it("starts deploy.yml via workflow_dispatch on the automation branch when no run exists for the commit", () => {
    // register the commit as the branch tip so the fake can attach the run to it
    write(MANIFEST, manifest("B", "c2"));
    const created = publish();
    const sha = created.outputs.head_sha;
    const r = run("ensure-ci", ["--branch", "automation/context-sync", "--sha", sha, "--wait-seconds", "2"]);
    expect(r.status, r.stderr).toBe(0);
    expect(gh().calls).toContain("workflow run ref=automation/context-sync full=false");
    expect(gh().runs[0].event).toBe("workflow_dispatch");
  });
  it("does not start a second run when one already exists for that exact commit", () => {
    setRuns([{ databaseId: 1, headSha: SHA, event: "workflow_dispatch", status: "completed", conclusion: "success" }]);
    expect(run("ensure-ci", args()).status).toBe(0);
    expect(gh().calls.filter((c: string) => c.startsWith("workflow run"))).toHaveLength(0);
  });
  it("ignores runs of other commits", () => {
    setRuns([{ databaseId: 1, headSha: "b".repeat(40), event: "workflow_dispatch", status: "completed", conclusion: "success" }]);
    const r = run("ensure-ci", ["--branch", "automation/context-sync", "--sha", SHA, "--wait-seconds", "1"], { FAKE_GH_NO_RUN: "1" });
    expect(r.status).toBe(1); // dispatched, but no run appeared for SHA → loud failure instead of a PR stuck without checks
    expect(r.stderr).toContain("필수 체크");
    expect(gh().calls.filter((c: string) => c.startsWith("workflow run"))).toHaveLength(1);
  });
  it("manual re-run re-dispatches only when the existing run for the commit failed", () => {
    setRuns([{ databaseId: 1, headSha: SHA, event: "workflow_dispatch", status: "completed", conclusion: "failure" }]);
    run("ensure-ci", args(["--force-redispatch"]), { FAKE_GH_NO_RUN: "1" });
    expect(gh().calls.filter((c: string) => c.startsWith("workflow run"))).toHaveLength(1);
    setRuns([{ databaseId: 2, headSha: SHA, event: "workflow_dispatch", status: "completed", conclusion: "success" }]);
    writeFileSync(stateFile, JSON.stringify({ ...gh(), calls: [] }));
    run("ensure-ci", args(["--force-redispatch"]));
    expect(gh().calls.filter((c: string) => c.startsWith("workflow run"))).toHaveLength(0);
  });
  it("rejects non-automation branches and malformed commits", () => {
    expect(run("ensure-ci", ["--branch", "main", "--sha", SHA]).status).toBe(1);
    expect(run("ensure-ci", ["--branch", "automation/context-sync", "--sha", "HEAD"]).status).toBe(1);
    expect(existsSync(stateFile)).toBe(true);
  });
});
