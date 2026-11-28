#!/usr/bin/env node
/**
 * SEC-1-04 (D-102): the Worker bundle is built in a job WITHOUT production credentials and handed to the release job
 * as an artifact. The release job installs dependencies with --ignore-scripts, never rebuilds, and deploys exactly
 * the verified file (`wrangler deploy <bundle> --no-bundle`).
 *
 *   node scripts/ci/worker-artifact.mjs prepare <out dir> <head sha>   build + manifest (no secrets)
 *   node scripts/ci/worker-artifact.mjs verify  <dir> <head sha>       check manifest, commit and hash
 *
 * Manifest `release.json`: { schema, head, bundle: { file, sha256, bytes }, inputs: [...] }.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { workerInputs } from "./worker-release-plan.mjs";

export const SCHEMA = "yachtlab-worker-release-v1";
export const BUNDLE = "index.js";
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

export async function prepare(out, head, root = process.cwd()) {
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("A full commit SHA is required.");
  const bundleDir = join(out, "bundle");
  mkdirSync(bundleDir, { recursive: true });
  const build = spawnSync(join(root, "node_modules/.bin/wrangler"), ["deploy", "--dry-run", "--config", "worker/wrangler.toml", "--outdir", resolve(bundleDir)], {
    cwd: root, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, timeout: 300_000,
  });
  if (build.status !== 0) throw new Error("The Worker bundle could not be built.");
  const file = join(bundleDir, BUNDLE);
  const manifest = { schema: SCHEMA, head, bundle: { file: `bundle/${BUNDLE}`, sha256: sha256(file), bytes: readFileSync(file).length }, inputs: await workerInputs(root) };
  writeFileSync(join(out, "release.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/** @returns the manifest with an absolute bundle path; throws when anything does not match. */
export function verify(dir, head) {
  const path = join(dir, "release.json");
  if (!existsSync(path)) throw new Error("The prepared release manifest is missing.");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("The prepared release manifest is not valid JSON.");
  }
  if (manifest?.schema !== SCHEMA) throw new Error("Unknown prepared release format.");
  if (manifest.head !== head) throw new Error(`The prepared release was built from ${manifest.head}, not ${head}.`);
  if (manifest.bundle?.file !== `bundle/${BUNDLE}` || !/^[0-9a-f]{64}$/.test(manifest.bundle?.sha256 ?? "")) throw new Error("The prepared bundle entry is invalid.");
  const extra = readdirSync(join(dir, "bundle")).filter((f) => ![BUNDLE, `${BUNDLE}.map`, "README.md"].includes(f));
  if (extra.length) throw new Error(`Unexpected files in the prepared bundle: ${extra.join(", ")}.`);
  const bundle = join(dir, manifest.bundle.file);
  if (sha256(bundle) !== manifest.bundle.sha256) throw new Error("The prepared bundle does not match its recorded SHA-256.");
  if (!Array.isArray(manifest.inputs) || !manifest.inputs.includes("worker/src/index.ts")) throw new Error("The prepared Worker input list is invalid.");
  return { ...manifest, bundlePath: resolve(bundle) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, dir, head] = process.argv.slice(2);
  try {
    if (mode === "prepare") {
      const m = await prepare(dir, head);
      console.log(`Prepared ${m.bundle.file} sha256=${m.bundle.sha256} (${m.bundle.bytes} bytes) for ${m.head}`);
    } else if (mode === "verify") {
      const m = verify(dir, head);
      console.log(`Verified ${m.bundle.file} sha256=${m.bundle.sha256} for ${m.head}`);
    } else throw new Error("Usage: worker-artifact.mjs prepare|verify <dir> <head sha>");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
