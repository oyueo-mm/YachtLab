/** A recording stand-in for the GitHub CLI used by the CI publish tests (no network). */
export const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs");
const { execFileSync } = require("child_process");
const file = process.env.FAKE_GH_STATE;
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const real = process.env.REAL_GIT;
state.calls.push(args.slice(0, 2).join(" ") + (args[0] === "workflow" ? " ref=" + opt("--ref") + " " + args.slice(args.indexOf("-f") + 1).join(" ") : ""));
if (args[0] === "pr" && args[1] === "list") { console.log(JSON.stringify(state.prs.filter((p) => !opt("--head") || p.head === opt("--head")).map(({ number, url }) => ({ number, url })))); }
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
