#!/usr/bin/env node
/**
 * Static search pages (Phase 7, D-062). One template for head / navigation / canonical / Open Graph /
 * breadcrumbs, so every page stays consistent. The generated HTML is committed under public/ (served
 * as-is by GitHub Pages, readable without JavaScript); tests/seo-pages.test.ts fails when the committed
 * files differ from this script's output.
 *
 *   node scripts/seo/build-pages.mjs          # write
 *   node scripts/seo/build-pages.mjs --check  # exit 1 when out of date
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES } from "./pages-content.mjs";
import { SITE, contentFingerprint, kstDate, renderSitemap } from "./seo-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export { SITE };
/** url path → { fingerprint, lastmod }: lastmod moves only when the indexed content changes (D-067). */
export const LEDGER_FILE = join(ROOT, "scripts/seo/lastmod.json");
/** Source of every sitemap page; the home page is the Vite entry, the rest come from this generator. */
export const sitemapSources = () => [
  ["", "index.html"],
  ...PAGES.map((p) => [p.path, `public/${p.path}index.html`]),
];
export const NAV = [
  ["", "홈"],
  ["guide/", "규칙"],
  ["scores/", "족보·점수판"],
  ["probability/", "확률 계산기"],
  ["strategy/", "전략"],
  ["ai/", "AI 대전"],
  ["multiplayer/", "친구 대전"],
  ["faq/", "FAQ"],
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function render(page) {
  const url = SITE + page.path;
  const up = "../".repeat(page.path.split("/").filter(Boolean).length);
  const crumbs = { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Online Yacht", item: SITE }, { "@type": "ListItem", position: 2, name: page.crumb, item: url }] };
  const graph = [crumbs, ...(page.jsonld ?? [])];
  const nav = NAV.map(([path, label]) => `<a href="${up}${path}"${path === page.path ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <link rel="canonical" href="${url}">
  <link rel="icon" href="${up}icons/favicon-48.png" type="image/png" sizes="48x48">
  <link rel="stylesheet" href="${up}site/page.css">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Online Yacht">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:title" content="${esc(page.ogTitle ?? page.title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}icons/share.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Online Yacht 워드마크와 주사위 눈이 들어간 돛단배 로고">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>
</head>
<body>
  <header class="site-top"><div class="top">
    <a class="brand" href="${up}"><img src="${up}icons/online-yacht-wordmark.svg" alt="Online Yacht 홈" width="139" height="32"></a>
    <a class="play" href="${up}#online">지금 플레이</a>
  </div>
  <nav class="site-nav" aria-label="사이트">${nav}</nav></header>
  <main>
${page.body.trim()}
  </main>
  <footer class="site-foot">
    <p>Online Yacht는 12칸 요트다이스(야추) 규칙을 쓰는 무료 웹 게임입니다. Hasbro의 Yahtzee® 공식 제품이 아니며 제휴 관계가 없습니다.</p>
    <p><a href="${up}">무료로 플레이</a> · <a href="${up}guide/">규칙</a> · <a href="${up}faq/">자주 묻는 질문</a></p>
  </footer>
</body>
</html>
`;
}

export function build({ check = false, today = kstDate() } = {}) {
  const stale = [];
  for (const page of PAGES) {
    const file = join(ROOT, "public", page.path, "index.html");
    const html = render(page);
    const old = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (old === html) continue;
    stale.push(page.path);
    if (!check) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, html);
    }
  }
  // Sitemap: home and every generated page (the guide is generated since 2026-11-26), with lastmod from the ledger.
  const ledger = existsSync(LEDGER_FILE) ? JSON.parse(readFileSync(LEDGER_FILE, "utf8")) : {};
  const next = {};
  for (const [path, source] of sitemapSources()) {
    const file = join(ROOT, source);
    // In check mode compare with what this run would have written (the page may be stale itself).
    const page = PAGES.find((p) => p.path === path);
    const html = page ? render(page) : readFileSync(file, "utf8");
    const fingerprint = contentFingerprint(html);
    const known = ledger[path];
    next[path] = known && known.fingerprint === fingerprint ? known : { fingerprint, lastmod: today };
  }
  const ledgerText = JSON.stringify(next, null, 2) + "\n";
  if (!existsSync(LEDGER_FILE) || readFileSync(LEDGER_FILE, "utf8") !== ledgerText) {
    stale.push("scripts/seo/lastmod.json");
    if (!check) writeFileSync(LEDGER_FILE, ledgerText);
  }
  const sitemap = renderSitemap(Object.entries(next).map(([path, { lastmod }]) => ({ loc: SITE + path, lastmod })));
  const sitemapFile = join(ROOT, "public/sitemap.xml");
  if (readFileSync(sitemapFile, "utf8") !== sitemap) {
    stale.push("sitemap.xml");
    if (!check) writeFileSync(sitemapFile, sitemap);
  }
  return stale;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const stale = build({ check });
  if (check && stale.length) {
    console.error("out of date: " + stale.join(", ") + " — run node scripts/seo/build-pages.mjs");
    process.exit(1);
  }
  console.log(stale.length ? (check ? "" : "wrote ") + stale.join(", ") : "up to date");
}
