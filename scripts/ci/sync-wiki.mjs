#!/usr/bin/env node
/**
 * CI-1: mirror the context pages of the CHECKED-OUT commit (the workflow checks out `main`) to the GitHub Wiki.
 *
 *   node scripts/ci/sync-wiki.mjs --remote <wiki git url> [--work-dir <dir>] [--branch master]
 *
 * The Wiki therefore shows what is MERGED on main (including merged snapshot PRs), never an unmerged PR branch.
 * Exit codes: 0 = synchronized or already current; 1 = the Wiki could not be read or written (actionable:
 * the Wiki must be initialized once by an admin, see docs/operations/CI-1-CONTEXT-SYNC-PROTECTION.md).
 * It never force-pushes: a concurrent Wiki edit makes the push fail and the next run mirrors again.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BOT = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];

/** Removes credentials embedded in any URL of a message (`https://user:secret@host` → `https://***@host`). */
export const redact = (text) => String(text).replace(/(\w+:\/\/)[^/\s@]+@/g, "$1***@");

export function syncWiki({ remote, branch = "master", cwd = process.cwd(), workDir }) {
  if (!remote) throw new Error("--remote 가 필요함");
  const own = !workDir;
  const dir = workDir ?? mkdtempSync(path.join(tmpdir(), "yachtlab-wiki-"));
  // SEC-1-09: the token travels as an HTTP header set through GIT_CONFIG_* (not in the URL, not in argv).
  const token = process.env.WIKI_TOKEN;
  const auth = token
    ? { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` }
    : {};
  const git = (args, options = {}) =>
    execFileSync("git", args, { cwd: options.cwd ?? dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...auth } }).trim();
  try {
    mkdirSync(dir, { recursive: true });
    let cloned = true;
    try {
      git(["clone", "--quiet", remote, dir], { cwd });
    } catch {
      cloned = false;
    }
    if (!cloned) {
      // An empty (never-written) wiki repository has nothing to clone; a missing one cannot be pushed to either.
      git(["init", "--quiet", `--initial-branch=${branch}`]);
      git(["remote", "add", "origin", remote]);
    }
    execFileSync("node", [path.join(cwd, "scripts/prepare-context-wiki.mjs"), dir], { cwd, stdio: ["ignore", "inherit", "inherit"] });
    git(["add", "-A"]);
    let changed = true;
    try {
      git(["diff", "--cached", "--quiet"]);
      changed = false;
    } catch {
      changed = true;
    }
    if (!changed) {
      console.log("GitHub Wiki already synchronized");
      return "unchanged";
    }
    git([...BOT, "commit", "--quiet", "-m", "Sync YachtLab context docs"]);
    try {
      git(["push", "--quiet", "origin", `HEAD:${branch}`]);
    } catch (error) {
      throw new Error(`Wiki push 실패: ${redact(String(error.stderr ?? error.message).trim().split("\n").pop())}`);
    }
    console.log(`GitHub Wiki updated (${cloned ? "clone" : "bootstrap"})`);
    return "updated";
  } finally {
    if (own) rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  try {
    const result = syncWiki({ remote: value("--remote"), branch: value("--branch"), workDir: value("--work-dir") });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Wiki\n${result}\n`);
  } catch (error) {
    console.error(`::error::Wiki 미러 실패 — Wiki가 한 번도 초기화되지 않았거나(첫 페이지 생성 필요) 쓰기 권한이 없음. ${redact(String(error.message).split("\n")[0])}`);
    process.exit(1);
  }
}
