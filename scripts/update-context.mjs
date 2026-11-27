import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const read = (file) => readFile(path.join(root, file), "utf8");
const git = (args) => { try { return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 }).trim(); } catch { return ""; } };
const list = async (dir, suffix = "") => (await readdir(path.join(root, dir))).filter((p) => p.endsWith(suffix)).sort();
const extractQuoted = (source, regex, label) => { const found = source.match(regex); if (!found) throw Error("맥락 추출에 실패함: " + label); return [...found[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]); };
const md = (str) => str.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const asLine = (xs) => xs.join(" · ");
const source = await Promise.all([read("src/ai.ts"), read("src/engine.ts"), read("package.json")]);
const algorithms = extractQuoted(source[0], /const allAlgorithms = \[([\s\S]*?)\] as const;/, "AI 목록");
const categories = extractQuoted(source[1], /export const categories = \[([\s\S]*?)\] as const;/, "점수 카테고리");
const pkg = JSON.parse(source[2]);
const workflows = await list(".github/workflows", ".yml");
const docFiles = await list("docs/context", ".md");
const recent = git(["log", "-n", "70", "--pretty=format:%h%x09%as%x09%s"]).split("\n").filter(Boolean).filter((line) => !/chore\(context\):|automation\/context-sync/i.test(line)).slice(0, 10).map((line) => { const [sha, date, ...subject] = line.split("\t"); return { sha, date, subject: subject.join(" ") }; });

const repo = process.env.GITHUB_REPOSITORY ?? "oyueo-mm/YachtLab";
let runs = [], runStatus = "이 환경에서 자동 실행 상태 조회 생략";
if (!checkOnly && process.env.GITHUB_TOKEN) {
  try {
    const response = await fetch("https://api.github.com/repos/" + repo + "/actions/runs?per_page=30", {
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + process.env.GITHUB_TOKEN, "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw Error("HTTP " + response.status);
    const json = await response.json();
    const filtered = (json.workflow_runs ?? []).filter((r) => r.name !== "Context sync" && r.status === "completed");
    const distinct = new Map();
    for (const r of filtered) if (!distinct.has(r.name)) distinct.set(r.name, { name: r.name, status: r.conclusion ?? "unknown", head: (r.head_sha ?? "").slice(0, 10), url: r.html_url });
    runs = [...distinct.values()].slice(0, 8);
    runStatus = "GitHub Actions에서 완료된 실행 중 워크플로별 최근 1건을 조회";
  } catch (error) { runStatus = "조회 실패: " + String(error).slice(0, 180); }
}

const manifest = {
  schema: 1,
  sourceOfTruth: "https://github.com/" + repo + "/blob/main/docs/context/README.md",
  inputFiles: ["src/ai.ts", "src/engine.ts", "package.json"],
  runtime: pkg.type ?? "unknown",
  npmScripts: pkg.scripts,
  algorithms, categories,
  documentation: docFiles,
  workflowFiles: workflows,
  recentSourceCommits: recent,
  recentWorkflowRuns: runs,
  workflowQuery: runStatus,
  disclaimer: "코드와 저장소 메타데이터의 자동 색인. 알고리즘 성능 결과 및 새 대화 내용은 자동 해석/수집하지 않음.",
};
const textLines = [
  "# YachtLab 현재 코드 상태 (자동 생성)",
  "",
  "> 이 문서는 GitHub Actions 또는 node scripts/update-context.mjs --write 실행으로 생성됨. 수동으로 수정하지 마세요.",
  "> **성능 주장은 여기서 생성하지 않습니다.** 자세한 출처와 한계는 [검증 결과](../RESULTS.md)를 확인하세요.",
  "",
  "## 코드에서 확인한 게임 설정",
  "",
  "- 게임 규칙: [src/engine.ts](../../../src/engine.ts) (여기에는 12개 카테고리, 상단 63점 +35, 스트레이트 15/30점 등 계산 코드가 있음).",
  "- 선언된 카테고리 수: **" + categories.length + "개**.",
  "- 카테고리: " + asLine(categories) + ".",
  "- package.json: " + (pkg.name ?? "unknown") + " / " + (pkg.version ?? "unknown") + " / " + (pkg.type ?? "unknown") + ".",
  "",
  "## 실제 소스에서 읽은 AI 모델 목록",
  "",
  "| 모델 | 소스 확인 |",
  "|---|---|",
  ...algorithms.map((name) => "| " + md(name) + " | [src/ai.ts](../../../src/ai.ts) |"),
  "",
  "- 나열된 모델 수: **" + algorithms.length + "개**. 이는 소스에서 선언된 목록이며, 조건부 등록 여부 및 실제 모델 평가 결과를 뜻하지 않음.",
  "- 연구용 별도 탐색/학습 모듈은 공개 AI 목록에 포함되지 않을 수 있음. [기법 도감](../TECHNIQUES.md) 참고.",
  "",
  "## 저장소에서 발견한 워크플로",
  "",
  ...workflows.map((f) => "- [" + f + "](../../../.github/workflows/" + f + ")"),
  "",
  "## 맥락 허브의 보존된 문서",
  "",
  ...docFiles.map((f) => "- [" + f + "](../" + f + ")"),
  "",
  "## 최근 Git 커밋 (맥락 자동 커밋 제외)",
  "",
  "| 커밋 | 날짜 (Git 기록) | 설명 |",
  "|---|---|---|",
  ...recent.map((r) => "| [" + r.sha + "](https://github.com/" + repo + "/commit/" + r.sha + ") | " + md(r.date) + " | " + md(r.subject) + " |"),
  "",
  "## 최근 GitHub Actions 상태",
  "",
  "- " + runStatus + ".",
  ...(runs.length ? ["", "| 워크플로 | 최근 완료 상태 | 커밋 |", "|---|---|---|", ...runs.map((r) => "| [" + md(r.name) + "](" + r.url + ") | " + md(r.status) + " | " + md(r.head) + " |")] : ["", "워크플로 실행 결과를 동기화하지 못했거나 조회를 생략함. GitHub Actions 페이지에서 확인할 것."]),
  "",
  "## 다음 채팅과 작업의 시작점",
  "",
  "1. [맥락 허브](../README.md) → [실험 결과](../RESULTS.md) → [연구 로드맵](../ROADMAP.md) → [기법 도감](../TECHNIQUES.md).",
  "2. 실제 코드를 다시 확인하고 작업할 것. 이 자동 문서는 코드 메타데이터의 스냅샷일 뿐 전체 파일을 대체하지 않음.",
  "3. 새 대화의 의사결정은 자동으로 수집되지 않음. 저장해야 한다면 [설계 결정](../DECISIONS.md)에 GitHub 커밋으로 기록할 것.",
  "",
];
const outputs = [
  ["docs/context/_generated/CURRENT_STATE.md", textLines.join("\n")],
  ["docs/context/_generated/manifest.json", JSON.stringify(manifest, null, 2) + "\n"],
];
for (const [filename, content] of outputs) {
  if (checkOnly) { if (!content.length || !content.includes("YachtLab") && filename.endsWith(".md")) throw Error("생성된 맥락 문서가 비어 있음"); continue; }
  await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
  const previous = await read(filename).catch(() => null);
  if (previous !== content) { await writeFile(path.join(root, filename), content, "utf8"); console.log("CONTEXT_UPDATED " + filename); }
  else console.log("CONTEXT_UNCHANGED " + filename);
}
console.log("CONTEXT_SUMMARY " + JSON.stringify({ mode: checkOnly ? "validate" : "write", algorithms: algorithms.length, categories: categories.length, workflows: workflows.length, commits: recent.length, actions: runs.length }));
