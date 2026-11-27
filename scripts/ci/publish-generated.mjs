#!/usr/bin/env node
/**
 * CI-1: publish regenerated documentation through an automation branch and ONE pull request, never by
 * pushing to main. Written for GitHub Actions with the job's own GITHUB_TOKEN (no PAT, no GitHub App).
 *
 *   node scripts/ci/publish-generated.mjs publish --branch automation/context-sync \
 *        --allow docs/context/_generated/ --title "chore(context): ..." [--skip-volatile-only ...]
 *   node scripts/ci/publish-generated.mjs ensure-ci --branch automation/context-sync --sha <sha>
 *
 * publish — compares the generator's working-tree output with origin/main and
 *   1. refuses (exit 1) when ANYTHING outside --allow changed, so a generator bug can never touch
 *      hand-written context, decisions, code or workflows;
 *   2. builds the commit with git plumbing (temporary index) on top of the CURRENT origin/main — the branch is
 *      a pure function of main, so a re-run or a concurrent run can lose nothing; it is replaced with
 *      --force-with-lease against the tip it observed (a competing writer makes the push fail loudly);
 *   3. does nothing when the result equals main (and closes a now-pointless PR), or equals the branch
 *      that already exists on top of the current main (idempotent re-run);
 *   4. creates the PR, or edits the already open one (never a second one for the same branch).
 * ensure-ci — a PR opened with GITHUB_TOKEN does not start `pull_request` workflows, so the required
 *   `ci-result` check would never appear. This starts the real deploy.yml (workflow_dispatch is the one
 *   event GITHUB_TOKEN may trigger) on the automation branch, unless a run for that exact commit exists,
 *   and fails if no run shows up. Nothing is bypassed: the same jobs run and report on the PR head commit.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BRANCH_PATTERN = /^automation\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Only `automation/...` may ever be written; main, release or contributors' branches never. */
export function assertAutomationBranch(branch) {
  if (typeof branch !== "string" || !BRANCH_PATTERN.test(branch) || branch.includes("..") || branch.endsWith(".lock")) {
    throw new Error(`브랜치 이름이 automation/<이름> 규칙에 맞지 않음: ${JSON.stringify(branch)}`);
  }
  return branch;
}

/** `allow` entries: a directory prefix ending in "/" or one exact file. Traversal / absolute / .git are never allowed. */
export function isAllowedPath(file, allow) {
  if (typeof file !== "string" || file === "" || file.startsWith("/") || file.includes("\\") || file.includes("\0")) return false;
  const segments = file.split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.toLowerCase() === ".git")) return false;
  return allow.some((entry) => {
    if (entry.endsWith("/")) return file.startsWith(entry) && file.length > entry.length;
    // one `*` wildcard per file name (never across directories): docs/context/_generated/FRONTIER-*.md
    if (entry.includes("*")) return globToRegExp(entry).test(file);
    return file === entry;
  });
}

function globToRegExp(entry) {
  return new RegExp("^" + entry.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
}

/** The fields that change with every commit / CI run, listed by the caller; everything else is "structural". */
export function sameWithoutKeys(a, b, keys) {
  const strip = (value) => {
    const copy = { ...value };
    for (const key of keys) delete copy[key];
    return JSON.stringify(copy);
  };
  return strip(a) === strip(b);
}

function parseArgs(argv) {
  const [first, ...rest] = argv;
  const command = first && !first.startsWith("--") ? first : "publish";
  const tokens = command === first ? rest : argv;
  const options = { allow: [] };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) throw new Error(`알 수 없는 인자: ${token}`);
    const key = token.slice(2);
    if (["skip-volatile-only", "force-redispatch", "dry-run", "scope-to-allow", "preserve-history"].includes(key)) options[key] = true;
    else if (key === "allow") options.allow.push(tokens[++i]);
    else options[key] = tokens[++i];
  }
  return { command, options };
}

function makeRunner(cwd, extraEnv = {}) {
  const run = (cmd, args, { input, env, allowFailure = false } = {}) => {
    try {
      return execFileSync(cmd, args, {
        cwd,
        encoding: "utf8",
        input,
        env: { ...process.env, ...extraEnv, ...env },
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      }).replace(/\n$/, "");
    } catch (error) {
      if (allowFailure) return null;
      const stderr = String(error.stderr ?? "").trim();
      throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} 실패: ${stderr || error.message}`);
    }
  };
  return { git: (args, options) => run("git", args, options), gh: (args, options) => run("gh", args, options) };
}

const splitNul = (text) => (text ? text.split("\0").filter(Boolean) : []);

/** Everything that differs between the working tree and HEAD (staged, unstaged, deleted, untracked). */
function workingTreeChanges(git) {
  const tracked = splitNul(git(["diff", "--no-renames", "--name-only", "-z", "HEAD"]));
  const untracked = splitNul(git(["ls-files", "--others", "--exclude-standard", "-z"]));
  return [...new Set([...tracked, ...untracked])].sort();
}

function buildTree(git, repoDir, baseSha, changed) {
  const dir = mkdtempSync(path.join(tmpdir(), "publish-generated-"));
  const env = { GIT_INDEX_FILE: path.join(dir, "index") };
  try {
    git(["read-tree", baseSha], { env });
    for (const file of changed) {
      const full = path.join(repoDir, file);
      if (existsSync(full) && lstatSync(full).isFile()) {
        const blob = git(["hash-object", "-w", "--", file]);
        const mode = lstatSync(full).mode & 0o111 ? "100755" : "100644";
        git(["update-index", "--add", "--cacheinfo", `${mode},${blob},${file}`], { env });
      } else {
        git(["update-index", "--force-remove", "--", file], { env });
      }
    }
    return git(["write-tree"], { env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function setOutputs(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v ?? ""}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
}

function summary(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
}

export function publish(options, cwd = process.cwd()) {
  const branch = assertAutomationBranch(options.branch);
  const baseName = options.base ?? "main";
  const allow = options.allow ?? [];
  if (allow.length === 0) throw new Error("--allow 가 하나 이상 필요함 (자동화가 수정할 수 있는 경로)");
  if (!options.title) throw new Error("--title 이 필요함");
  const { git, gh } = makeRunner(cwd, {
    GIT_AUTHOR_NAME: "github-actions[bot]",
    GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_COMMITTER_NAME: "github-actions[bot]",
    GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  });
  const remote = options.remote ?? "origin";

  // 1) Allowed paths only — anything else is a hard failure, before any git object is created.
  let changes = workingTreeChanges(git);
  // research jobs check out the whole repository and download artifacts: only the files the job may publish count.
  if (options["scope-to-allow"]) changes = changes.filter((file) => isAllowedPath(file, allow));
  if (options["preserve-history"]) return publishPreservingHistory(options, { git, gh, cwd, branch, baseName, allow, changes, remote });
  const forbidden = changes.filter((file) => !isAllowedPath(file, allow));
  if (forbidden.length > 0) {
    throw new Error(`허용 경로(${allow.join(", ")}) 밖의 파일이 변경되어 중단함 — 자동화는 아무것도 커밋하지 않음:\n  ${forbidden.join("\n  ")}`);
  }

  // 2) Base = the CURRENT main, not whatever the job checked out.
  git(["fetch", "--quiet", remote, `+refs/heads/${baseName}:refs/remotes/${remote}/${baseName}`]);
  const baseSha = git(["rev-parse", `refs/remotes/${remote}/${baseName}`]);
  const baseTree = git(["rev-parse", `${baseSha}^{tree}`]);
  const desiredTree = buildTree(git, cwd, baseSha, changes);

  const listed = gh(["pr", "list", "--head", branch, "--base", baseName, "--state", "open", "--json", "number,url", "--limit", "5"]);
  const openPrs = listed ? JSON.parse(listed) : [];
  if (openPrs.length > 1) throw new Error(`같은 브랜치의 열린 PR이 ${openPrs.length}개임: 하나만 남기고 닫아야 함`);
  const openPr = openPrs[0] ?? null;

  const remoteLine = git(["ls-remote", remote, `refs/heads/${branch}`]);
  const remoteSha = remoteLine ? remoteLine.split(/\s+/)[0] : null;

  // 3a) main already contains this output.
  if (desiredTree === baseTree) {
    if (openPr) {
      gh(["pr", "close", String(openPr.number), "--delete-branch", "--comment", `이 PR의 내용이 이미 ${baseName}에 있어 닫습니다. (자동 생성)`]);
      summary(`### 변경 없음\n\`${baseName}\`가 이미 최신 생성물을 포함하므로 열려 있던 PR #${openPr.number}을 닫았습니다.`);
      setOutputs({ action: "closed-stale", pr_url: openPr.url, head_sha: "", branch });
    } else {
      summary("### 변경 없음\n생성물이 main과 동일합니다. 커밋과 PR 갱신을 생략했습니다.");
      setOutputs({ action: "noop", pr_url: "", head_sha: "", branch });
    }
    return "noop";
  }

  // 3b) Only per-commit / per-run fields changed: refresh at most on schedule, unless a PR already needs the rebase.
  if (options["skip-volatile-only"] && !openPr && options["volatile-json"]) {
    const jsonPath = options["volatile-json"];
    const derived = (options.derived ? options.derived.split(",") : []).filter(Boolean);
    const keys = (options["volatile-keys"] ?? "").split(",").filter(Boolean);
    const onlyDerived = changes.every((file) => file === jsonPath || derived.includes(file));
    if (onlyDerived && changes.includes(jsonPath)) {
      const before = git(["show", `${baseSha}:${jsonPath}`], { allowFailure: true });
      const after = git(["show", `${desiredTree}:${jsonPath}`], { allowFailure: true });
      if (before && after && sameWithoutKeys(JSON.parse(before), JSON.parse(after), keys)) {
        summary(`### 변동 항목만 변경\n\`${keys.join(", ")}\` 외에는 같아 이번 실행에서는 PR을 만들지 않습니다. (예약 실행/수동 실행에서 갱신)`);
        setOutputs({ action: "skipped-volatile", pr_url: "", head_sha: "", branch });
        return "skipped-volatile";
      }
    }
  }

  // 4) Branch: reuse when identical and on the current main, otherwise rebuild it from main.
  let headSha = remoteSha;
  let branchChanged = false;
  const reusable = (() => {
    if (!remoteSha) return false;
    git(["fetch", "--quiet", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], { allowFailure: true });
    const tree = git(["rev-parse", `${remoteSha}^{tree}`], { allowFailure: true });
    const parent = git(["rev-parse", `${remoteSha}^`], { allowFailure: true });
    return tree === desiredTree && parent === baseSha;
  })();
  if (!reusable) {
    const message = `${options.title}\n\n자동 생성 (${path.basename(process.argv[1] ?? "publish-generated.mjs")}). 기준: ${baseName}@${baseSha}\n변경 파일:\n${changes.map((f) => `- ${f}`).join("\n")}\n`;
    headSha = git(["commit-tree", desiredTree, "-p", baseSha, "-m", message]);
    if (options["dry-run"]) {
      summary(`dry-run: ${changes.length}개 파일, 커밋 ${headSha} (push 안 함)`);
      setOutputs({ action: "dry-run", pr_url: openPr?.url ?? "", head_sha: headSha, branch });
      return "dry-run";
    }
    const lease = `--force-with-lease=refs/heads/${branch}:${remoteSha ?? ""}`;
    git(["push", "--quiet", lease, remote, `${headSha}:refs/heads/${branch}`]);
    branchChanged = true;
  }

  // 5) Exactly one PR.
  return upsertPr({ gh, options, openPr, branchChanged, branch, baseName, baseSha, headSha, allow, changes });
}

/** Creates the PR, or edits the open one. Shared by both publish modes. */
function upsertPr({ gh, options, openPr, branchChanged, branch, baseName, baseSha, headSha, allow, changes, footer = [] }) {
  const body = [
    options.note ?? "자동 생성 문서 갱신입니다.",
    "",
    `- 기준: \`${baseName}@${baseSha.slice(0, 10)}\` · 브랜치: \`${branch}\` (자동화 전용, 직접 수정하지 마세요)`,
    `- 변경 파일 ${changes.length}개 — 모두 허용 경로 \`${allow.join("`, `")}\` 안:`,
    ...changes.map((file) => `  - \`${file}\``),
    "- 이 PR은 `ci-result` 필수 체크가 통과해야 병합됩니다. 병합해도 같은 내용으로 새 PR이 다시 만들어지지 않습니다.",
    ...(footer.length ? footer : ["- 병합 전 `main`이 앞서면 워크플로가 이 브랜치를 최신 main 위에서 다시 만듭니다."]),
  ].join("\n");
  const tmp = mkdtempSync(path.join(tmpdir(), "publish-generated-body-"));
  const bodyFile = path.join(tmp, "body.md");
  try {
    appendFileSync(bodyFile, body + "\n");
    let prUrl = openPr?.url ?? "";
    let action;
    if (openPr) {
      if (branchChanged) gh(["pr", "edit", String(openPr.number), "--title", options.title, "--body-file", bodyFile]);
      action = branchChanged ? "updated" : "unchanged";
    } else {
      try {
        prUrl = gh(["pr", "create", "--base", baseName, "--head", branch, "--title", options.title, "--body-file", bodyFile]).split("\n").pop();
        action = "created";
      } catch (error) {
        if (/not permitted to create or approve pull requests/i.test(String(error.message))) {
          throw new Error(
            `PR 생성이 거부됨: 저장소 설정 'Allow GitHub Actions to create and approve pull requests'가 꺼져 있음 (Settings → Actions → General → Workflow permissions). 브랜치 ${branch}@${headSha.slice(0, 10)}는 이미 push되어 있으니 설정 후 워크플로를 다시 실행하면 PR만 만들어짐.`,
          );
        }
        // a parallel run of the same branch created it a moment ago: that PR is the one to use
        const again = JSON.parse(gh(["pr", "list", "--head", branch, "--base", baseName, "--state", "open", "--json", "number,url", "--limit", "5"]) || "[]")[0];
        if (!again || !/already exists/i.test(String(error.message))) throw error;
        gh(["pr", "edit", String(again.number), "--title", options.title, "--body-file", bodyFile]);
        prUrl = again.url;
        action = "updated";
      }
    }
    summary(`### 생성 문서 PR: ${action}\n${prUrl}\n\n브랜치 \`${branch}\` @ \`${headSha.slice(0, 10)}\` (기준 ${baseName}@${baseSha.slice(0, 10)}), 파일 ${changes.length}개`);
    setOutputs({ action, pr_url: prUrl, head_sha: headSha, branch });
    return action;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Research reports (CI-1.1): the branch is NEVER force-pushed. Every run adds a commit on top of the existing
 * unmerged branch (and merges the latest main into it), so an earlier run's unmerged result stays in the PR
 * history and a concurrent writer can only make the plain push fail — the retry then re-merges and loses nothing.
 * Tree = 3-way merge(main, branch) + this run's files; if main and the branch changed the same file differently
 * the run stops without touching the branch (nothing is lost; merge or close the open PR, then re-run).
 */
function publishPreservingHistory(options, { git, gh, cwd, branch, baseName, allow, changes, remote }) {
  const maxAttempts = Number(process.env.PUBLISH_GENERATED_ATTEMPTS ?? 6);
  const retryMs = Number(process.env.PUBLISH_GENERATED_RETRY_MS ?? 1500);
  const isAncestor = (a, b) => git(["merge-base", "--is-ancestor", a, b], { allowFailure: true }) !== null;
  if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
    git(["fetch", "--quiet", "--unshallow", "--no-tags", remote, `+refs/heads/${baseName}:refs/remotes/${remote}/${baseName}`]);
  }
  for (let attempt = 1; ; attempt += 1) {
    git(["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${baseName}:refs/remotes/${remote}/${baseName}`]);
    const baseSha = git(["rev-parse", `refs/remotes/${remote}/${baseName}`]);
    const baseTree = git(["rev-parse", `${baseSha}^{tree}`]);
    const listed = gh(["pr", "list", "--head", branch, "--base", baseName, "--state", "open", "--json", "number,url", "--limit", "5"]);
    const openPrs = listed ? JSON.parse(listed) : [];
    if (openPrs.length > 1) throw new Error(`같은 브랜치의 열린 PR이 ${openPrs.length}개임: 하나만 남기고 닫아야 함`);
    const openPr = openPrs[0] ?? null;
    const line = git(["ls-remote", remote, `refs/heads/${branch}`]);
    const tip = line ? line.split(/\s+/)[0] : null;
    if (tip) git(["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);

    let mergedTree = baseTree;
    const tipInMain = tip ? isAncestor(tip, baseSha) : false;
    if (tip && !tipInMain) {
      const merged = git(["merge-tree", "--write-tree", baseSha, tip], { allowFailure: true });
      if (merged === null) {
        throw new Error(
          `${branch}의 미병합 결과와 ${baseName}이 같은 파일을 서로 다르게 바꿨음. 아무것도 덮어쓰지 않고 중단함 — 열린 PR을 병합하거나 닫은 뒤 다시 실행하세요.`,
        );
      }
      mergedTree = merged.split("\n")[0];
    }
    const desiredTree = buildTree(git, cwd, mergedTree, changes);

    if (desiredTree === baseTree) {
      if (openPr) {
        gh(["pr", "close", String(openPr.number), "--delete-branch", "--comment", `이 PR의 내용이 이미 ${baseName}에 있어 닫습니다. (자동 생성)`]);
        summary(`### 변경 없음\n\`${baseName}\`가 이미 이 결과를 포함하므로 열려 있던 PR #${openPr.number}을 닫았습니다.`);
        setOutputs({ action: "closed-stale", pr_url: openPr.url, head_sha: "", branch });
        return "noop";
      }
      summary("### 변경 없음\n결과가 main과 동일합니다. 커밋과 PR 갱신을 생략했습니다.");
      setOutputs({ action: "noop", pr_url: "", head_sha: "", branch });
      return "noop";
    }

    let headSha = tip;
    let branchChanged = false;
    const reusable = tip && git(["rev-parse", `${tip}^{tree}`]) === desiredTree && isAncestor(baseSha, tip);
    if (!reusable) {
      const parents = tip && !tipInMain ? (isAncestor(baseSha, tip) ? [tip] : [tip, baseSha]) : [baseSha];
      const message = `${options.title}\n\n자동 생성 (research publish). 기준: ${baseName}@${baseSha}\n이번 실행의 파일:\n${changes.map((f) => `- ${f}`).join("\n") || "- (없음: main 반영만)"}\n`;
      headSha = git(["commit-tree", desiredTree, ...parents.flatMap((p) => ["-p", p]), "-m", message]);
      if (options["dry-run"]) {
        summary(`dry-run: ${changes.length}개 파일, 커밋 ${headSha} (push 안 함)`);
        setOutputs({ action: "dry-run", pr_url: openPr?.url ?? "", head_sha: headSha, branch });
        return "dry-run";
      }
      try {
        git(["push", "--quiet", remote, `${headSha}:refs/heads/${branch}`]); // plain push: fast-forward only
      } catch (error) {
        if (attempt >= maxAttempts) throw new Error(`${branch} push가 ${attempt}번 모두 실패: ${String(error.message).split("\n")[0]}`);
        sleepSync(Math.floor(retryMs * attempt * (0.5 + Math.random())));
        continue; // someone else advanced the branch (or main moved): redo the merge on top of it
      }
      branchChanged = true;
    }
    const prFiles = splitNul(git(["diff", "--no-renames", "--name-only", "-z", baseSha, headSha]));
    return upsertPr({
      gh, options, openPr, branchChanged, branch, baseName, baseSha, headSha, allow, changes: prFiles,
      footer: ["- 이 브랜치는 강제 푸시 없이 기록을 쌓으며 갱신됩니다. 같은 연구를 다시 실행해도 이전 미병합 결과 커밋이 이 PR 기록에 남고, 최신 main이 병합되어 있습니다."],
    });
  }
}

export async function ensureCi(options, cwd = process.cwd()) {
  const branch = assertAutomationBranch(options.branch);
  const sha = options.sha;
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("--sha 는 40자리 커밋 해시여야 함");
  const workflow = options.workflow ?? "deploy.yml";
  const waitSeconds = Number(options["wait-seconds"] ?? 90);
  const pollMs = Number(process.env.PUBLISH_GENERATED_POLL_MS ?? 5000);
  const { gh } = makeRunner(cwd);
  const runsFor = () =>
    JSON.parse(gh(["run", "list", "--workflow", workflow, "--branch", branch, "--limit", "30", "--json", "databaseId,headSha,event,status,conclusion"]) || "[]").filter(
      (run) => run.headSha === sha,
    );
  const existing = runsFor();
  const healthy = existing.some((run) => run.status !== "completed" || run.conclusion === "success");
  if (existing.length > 0 && (!options["force-redispatch"] || healthy)) {
    summary(`### 필수 CI\n\`${sha.slice(0, 10)}\`에 대한 ${workflow} 실행이 이미 있음 (${existing.map((r) => `${r.event}:${r.status}/${r.conclusion ?? "-"}`).join(", ")}). 새로 시작하지 않습니다.`);
    return "exists";
  }
  gh(["workflow", "run", workflow, "--ref", branch, "-f", "full=false"]);
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const runs = runsFor();
    if (runs.length > 0 && runs.some((r) => !existing.some((e) => e.databaseId === r.databaseId))) {
      summary(`### 필수 CI\n\`${sha.slice(0, 10)}\`에서 ${workflow}를 workflow_dispatch로 시작했습니다. 결과는 PR의 \`ci-result\` 체크로 보고됩니다.`);
      return "dispatched";
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`${workflow} 실행을 시작했지만 ${waitSeconds}초 안에 ${sha.slice(0, 10)}의 실행이 보이지 않음. 필수 체크 없이는 병합할 수 없으므로 Context sync를 다시 실행(workflow_dispatch)하세요.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    if (command === "publish") publish(options);
    else if (command === "ensure-ci") await ensureCi(options);
    else throw new Error(`알 수 없는 명령: ${command}`);
  } catch (error) {
    console.error(`::error::${String(error.message).split("\n")[0]}`);
    console.error(String(error.message));
    process.exit(1);
  }
}
