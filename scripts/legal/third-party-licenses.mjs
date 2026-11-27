#!/usr/bin/env node
/**
 * Open-source notice data for the in-app license page (C4.3).
 *
 *   node scripts/legal/third-party-licenses.mjs          → writes src/legal/third-party-licenses.json
 *   node scripts/legal/third-party-licenses.mjs --check  → exits 1 when the committed file is stale
 *
 * Packages: every non-dev package in package-lock.json (what can end up in the browser bundle),
 * plus build tools whose own code is emitted into the bundle (BUNDLED_DEV), with the license text
 * shipped in its own node_modules folder. Ported sources: code whose logic
 * was ported from another open-source project (scripts/legal/ported-sources.json + license files).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "src/legal/third-party-licenses.json");
/** Dev dependencies that put their own code into the built site (Tailwind's preflight/base CSS). */
const BUNDLED_DEV = ["tailwindcss"];

function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  if (!file) throw new Error(`no license file in ${dir}`);
  return readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n").trim();
}

export function build() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const packages = [];
  for (const [path, info] of Object.entries(lock.packages)) {
    const name = path.replace(/^.*node_modules\//, "");
    if (!path || ((info.dev || info.devOptional) && !(BUNDLED_DEV.includes(name) && path === `node_modules/${name}`))) continue;
    const dir = join(root, path);
    if (!existsSync(dir)) throw new Error(`${name} is not installed (run npm ci)`);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    packages.push({
      name,
      version: info.version,
      license: info.license ?? pkg.license,
      homepage: (pkg.homepage ?? repo ?? "").replace(/^git\+/, "").replace(/\.git$/, "") || null,
      text: licenseText(dir),
    });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  const ported = JSON.parse(readFileSync(join(root, "scripts/legal/ported-sources.json"), "utf8")).map((p) => ({
    ...p,
    text: readFileSync(join(root, "scripts/legal/licenses", p.licenseFile), "utf8").replace(/\r\n/g, "\n").trim(),
    licenseFile: undefined,
  }));
  return JSON.stringify({ packages, ported }, null, 1) + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const next = build();
  if (process.argv.includes("--check")) {
    const current = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (current !== next) {
      console.error("src/legal/third-party-licenses.json is stale: run node scripts/legal/third-party-licenses.mjs");
      process.exit(1);
    }
    console.log("third-party licenses up to date");
  } else {
    writeFileSync(out, next);
    console.log("wrote", out);
  }
}
