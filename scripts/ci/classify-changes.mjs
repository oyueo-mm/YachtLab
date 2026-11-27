#!/usr/bin/env node
/**
 * Decides how much of the site pipeline a change needs (D-061). Prints `mode=<docs|seo|full>`.
 *
 *  - docs: only documentation (docs/**, *.md). No build, browser run or deploy.
 *  - seo:  only static search pages under public/ (HTML, sitemap, robots, page CSS) and the sitemap
 *          lastmod ledger (scripts/seo/lastmod.json). The site is built
 *          and the SEO + PWA browser checks run, then the site deploys (2–5 minutes).
 *  - full: anything else — and whenever the change list cannot be read (fail safe).
 *
 * Reads NUL-delimited git paths or a newline-delimited list.
 * Usage: node scripts/ci/classify-changes.mjs <file list path | -> ; empty list => full.
 */
import { readFileSync } from "node:fs";

export function classify(files) {
  const list = files.map((f) => f.trim()).filter(Boolean);
  if (list.length === 0 || list.some((f) => /^\.github\/workflows\//.test(f))) return "full";
  const docs = (f) =>
    /^docs\//.test(f) ||
    (/\.md$/i.test(f) && !/^(src|public|worker|server)\//.test(f));
  const seo = (f) =>
    /^public\/(?!pwa-worker|manifest|icons\/)[^]*\.(html|xml|txt|css)$/i.test(f) || f === "scripts/seo/lastmod.json";
  if (list.every(docs)) return "docs";
  if (list.every((f) => docs(f) || seo(f))) return "seo";
  return "full";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = process.argv[2] ?? "-";
  let text = "";
  try {
    text = readFileSync(source === "-" ? 0 : source, "utf8");
  } catch {
    text = "";
  }
  console.log(`mode=${classify(text.split(text.includes("\0") ? "\0" : /\r?\n/))}`);
}
