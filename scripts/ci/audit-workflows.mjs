#!/usr/bin/env node
/**
 * CI-1: lists the workflows whose steps push straight to main. With main protected (PR required) every one of
 * them fails at its push step. Informational by default; `--strict` exits 1 while any remain, so Work/the
 * operator can run it right before enabling the ruleset.
 *
 *   node scripts/ci/audit-workflows.mjs [--strict] [--json]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** `git push origin HEAD:main`, `git push origin main`, `git push origin HEAD:refs/heads/main`, `git push -f origin HEAD:main` ... */
const MAIN_PUSH = /git\s+push\b[^\n#]*?\s(?:HEAD:(?:refs\/heads\/)?|\+?)main(?=\s|$|;|\)|")/;

export function findMainPushers(dir = ".github/workflows") {
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => {
      const lines = readFileSync(path.join(dir, name), "utf8").split("\n");
      const pushes = lines.map((text, index) => ({ line: index + 1, text: text.trim() })).filter(({ text }) => !text.startsWith("#") && MAIN_PUSH.test(text));
      return { workflow: name, pushes };
    })
    .filter((entry) => entry.pushes.length > 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = findMainPushers();
  if (process.argv.includes("--json")) console.log(JSON.stringify(found, null, 2));
  else {
    console.log(`Workflows that push directly to main: ${found.length}`);
    for (const entry of found) console.log(`- ${entry.workflow}: lines ${entry.pushes.map((p) => p.line).join(", ")}`);
  }
  if (process.argv.includes("--strict") && found.length > 0) process.exit(1);
}
