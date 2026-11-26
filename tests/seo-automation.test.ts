import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain ESM module
import * as lib from "../scripts/seo/seo-lib.mjs";
// @ts-expect-error plain ESM module
import { assetsOf, pruneHistory } from "../scripts/seo/retain-assets.mjs";
// @ts-expect-error plain ESM build script
import { LEDGER_FILE, sitemapSources } from "../scripts/seo/build-pages.mjs";

const SITE = "https://oyueo-mm.github.io/YachtLab/";
const config = JSON.parse(readFileSync(new URL("../scripts/seo/indexnow.json", import.meta.url), "utf8"));

const page = (path: string, extra = "", body = "<p>본문</p>") => `<!doctype html><html><head>
<title>요트다이스 페이지 ${path || "home"}</title>
<meta name="description" content="요트다이스 검색 자동화 테스트 페이지의 설명입니다. 사십 글자를 넘기도록 충분히 깁니다.">
<link rel="canonical" href="${SITE}${path}"><meta property="og:url" content="${SITE}${path}">
<meta name="google-site-verification" content="${config.googleSiteVerification}" />
<link rel="stylesheet" href="/YachtLab/site/page.css">${extra}
</head><body><nav>메뉴</nav><main><h1>제목 ${path}</h1>${body}</main><footer>푸터</footer></body></html>`;

describe("content fingerprint and sitemap (D-067)", () => {
  it("ignores navigation, footer, styles and asset names but follows indexed content", () => {
    const base = lib.contentFingerprint(page("faq/"));
    expect(lib.contentFingerprint(page("faq/").replace("메뉴", "새 메뉴").replace("푸터", "새 푸터"))).toBe(base);
    expect(lib.contentFingerprint(page("faq/").replace("/YachtLab/site/page.css", "/YachtLab/assets/x-123.css"))).toBe(base);
    expect(lib.contentFingerprint(page("faq/", "", "<p>바뀐 본문</p>"))).not.toBe(base);
    expect(lib.contentFingerprint(page("faq/").replace("<title>", "<title>새 "))).not.toBe(base);
    expect(lib.contentFingerprint(page("faq/", '<meta name="robots" content="noindex">'))).not.toBe(base);
  });

  it("the committed ledger lists every sitemap page with a fingerprint and a W3C date", () => {
    const ledger = JSON.parse(readFileSync(LEDGER_FILE, "utf8"));
    const paths = sitemapSources().map(([p]: [string]) => p);
    expect(Object.keys(ledger)).toEqual(paths);
    expect(paths).toHaveLength(10);
    for (const [path, source] of sitemapSources() as [string, string][]) {
      expect(existsSync(new URL(`../${source}`, import.meta.url)), source).toBe(true);
      expect(ledger[path].lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ledger[path].fingerprint).toMatch(/^[0-9a-f]{16}$/);
    }
    const sitemap = lib.parseSitemap(readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8"));
    expect(sitemap).toEqual(paths.map((p: string) => ({ loc: SITE + p, lastmod: ledger[p].lastmod })));
  });

  it("renders and parses sitemaps symmetrically", () => {
    const entries = [{ loc: SITE, lastmod: "2026-11-26" }, { loc: SITE + "faq/", lastmod: "2026-11-27" }];
    expect(lib.parseSitemap(lib.renderSitemap(entries))).toEqual(entries);
    expect(() => lib.parseSitemap("<html></html>")).toThrow();
  });

  it("uses the Korean calendar day for lastmod", () => {
    expect(lib.kstDate(new Date("2026-11-26T15:30:00Z"))).toBe("2026-11-27");
    expect(lib.kstDate(new Date("2026-11-26T14:59:00Z"))).toBe("2026-11-26");
  });
});

describe("page checks", () => {
  const ok = { status: 200, headers: new Headers({ "content-type": "text/html; charset=utf-8" }) };
  it("accepts a correct page and reports canonical, noindex and metadata problems", () => {
    expect(lib.checkPage(SITE + "faq/", ok, page("faq/"))).toEqual([]);
    expect(lib.checkPage(SITE + "faq/", ok, page("ai/")).join()).toMatch(/canonical/);
    expect(lib.checkPage(SITE + "faq/", ok, page("faq/", '<meta name="robots" content="noindex, follow">')).join()).toMatch(/meta robots/);
    const tagged = { status: 200, headers: new Headers({ "content-type": "text/html", "x-robots-tag": "noindex" }) };
    expect(lib.checkPage(SITE + "faq/", tagged, page("faq/")).join()).toMatch(/X-Robots-Tag/);
    expect(lib.checkPage(SITE + "faq/", ok, page("faq/").replace(/<meta name="description"[^>]+>/, "")).join()).toMatch(/description/);
    expect(lib.checkPage(SITE + "faq/", { ...ok, status: 404 }, "")).toEqual(["HTTP 404"]);
  });
  it("lists same-site subresources only", () => {
    const html = page("faq/", '<script src="../tools/a.js"></script><img src="https://example.com/x.png"><link rel="icon" href="data:,">');
    expect(lib.subresources(html, SITE + "faq/")).toEqual([SITE + "site/page.css", SITE + "tools/a.js"]);
  });
  it("the home page and the 404 page keep their search directives", () => {
    const home = lib.extractMeta(readFileSync(new URL("../index.html", import.meta.url), "utf8"));
    expect(home.noindex).toBe(false);
    expect(home.canonical).toBe(SITE);
    expect(home.googleVerification).toBe(config.googleSiteVerification);
    expect(lib.extractMeta(readFileSync(new URL("../public/404.html", import.meta.url), "utf8")).noindex).toBe(true);
  });
});

describe("IndexNow key and change detection", () => {
  it("serves a valid key from the project and points the submission at the host root", () => {
    expect(lib.isValidIndexNowKey(config.key)).toBe(true);
    expect(readFileSync(new URL(`../public/${config.key}.txt`, import.meta.url), "utf8")).toBe(config.key);
    expect(config.keyLocation).toBe(`https://oyueo-mm.github.io/${config.key}.txt`);
    expect(config.fallbackKeyLocation).toBe(`${SITE}${config.key}.txt`);
    expect(Object.keys(config.endpoints)).toEqual(["bing", "naver"]);
    // Google is sitemap-only: no Indexing API endpoint is configured.
    expect(JSON.stringify(config)).not.toMatch(/indexing\.googleapis|google\.com\/ping/);
  });
  it("first run submits every URL, later runs only new, changed and removed ones", () => {
    const current = [
      { loc: SITE, lastmod: "2026-11-27", fingerprint: "home" },
      { loc: SITE + "faq/", lastmod: "2026-11-26", fingerprint: "faq" },
      { loc: SITE + "new/", lastmod: "2026-11-27", fingerprint: "new" },
    ];
    expect(lib.pendingUrls(current, undefined).added).toHaveLength(3);
    const submitted = Object.fromEntries(current.map(({ loc, lastmod, fingerprint }) => [loc, { lastmod, fingerprint }]));
    const p = lib.pendingUrls(current, {
      [SITE]: { ...submitted[SITE], lastmod: "2026-11-26" },
      [SITE + "faq/"]: submitted[SITE + "faq/"],
      [SITE + "old/"]: "2026-11-20",
    });
    expect(p).toEqual({ added: [SITE + "new/"], changed: [SITE], removed: [SITE + "old/"], urls: [SITE + "new/", SITE, SITE + "old/"] });
    expect(lib.pendingUrls(current, submitted).urls).toEqual([]);
    expect(lib.pendingUrls(current, submitted, { all: true }).urls).toHaveLength(3);
  });
  it("retries transient failures with backoff and stops on final answers", async () => {
    const statuses = [503, 429, 200];
    const fetchImpl = vi.fn(async () => new Response("x", { status: statuses.shift()! }));
    const waits: number[] = [];
    const r = await lib.fetchWithRetry("https://x/", {}, { fetchImpl, wait: async (ms: number) => void waits.push(ms), baseDelayMs: 100 });
    expect(r.res.status).toBe(200);
    expect(r.attempts).toBe(3);
    expect(waits).toEqual([100, 200]);
    const final = vi.fn(async () => new Response("bad key", { status: 403 }));
    expect((await lib.fetchWithRetry("https://x/", {}, { fetchImpl: final, wait: async () => {} })).attempts).toBe(1);
    const down = vi.fn(async () => { throw new Error("ECONNRESET"); });
    const failed = await lib.fetchWithRetry("https://x/", {}, { fetchImpl: down, wait: async () => {}, attempts: 3 });
    expect(failed.res).toBeNull();
    expect(failed.error).toMatch(/ECONNRESET/);
  });
});

describe("IndexNow run against a simulated site", () => {
  afterEach(() => vi.unstubAllGlobals());

  function site(paths: string[], lastmod: Record<string, string>, endpoint: (name: string) => number, bodyByPath: Record<string, string> = {}) {
    const posts: { name: string; body: { urlList: string[]; keyLocation: string; host: string; key: string } }[] = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = input.replace(/[?&]seo-check=[^&]*$/, "");
      for (const [name, ep] of Object.entries(config.endpoints) as [string, string][]) {
        if (url === ep) {
          posts.push({ name, body: JSON.parse(String(init?.body)) });
          return new Response("", { status: endpoint(name) });
        }
      }
      const html = { "content-type": "text/html; charset=utf-8" };
      if (url === SITE + "sitemap.xml") return new Response(lib.renderSitemap(paths.map((p) => ({ loc: SITE + p, lastmod: lastmod[p] }))), { headers: { "content-type": "application/xml" } });
      if (url === config.keyLocation || url === config.fallbackKeyLocation) return new Response(config.key, { headers: { "content-type": "text/plain" } });
      if (url === "https://oyueo-mm.github.io/robots.txt") return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${config.sitemap}\n`);
      if (url === config.hostRootChecks[0].url) return new Response(config.hostRootChecks[0].contains, { headers: html });
      if (url === SITE + "site/page.css") return new Response("body{}", { headers: { "content-type": "text/css" } });
      const path = url.slice(SITE.length);
      if (paths.includes(path)) return new Response(page(path, "", bodyByPath[path]), { headers: html });
      return new Response("not found", { status: 404, headers: html });
    });
    return posts;
  }

  it("submits all pages first, then only what changed, and retries a failed endpoint next time", async () => {
    // @ts-expect-error plain ESM module
    const { run } = await import("../scripts/seo/indexnow-submit.mjs");
    const stateDir = mkdtempSync(join(tmpdir(), "indexnow-"));
    const quiet = () => {};
    const eight = ["", "guide/", "faq/", "ai/", "multiplayer/", "strategy/", "scores/", "probability/"];
    const day1 = Object.fromEntries(eight.map((p) => [p, "2026-11-26"]));

    let posts = site(eight, day1, () => 200);
    const first = await run({ stateDir, log: quiet, summaryFile: join(stateDir, "summary.md") });
    expect(first.ok).toBe(true);
    expect(posts.map((p) => [p.name, p.body.urlList.length])).toEqual([["bing", 8], ["naver", 8]]);
    expect(posts[0].body).toMatchObject({ host: "oyueo-mm.github.io", key: config.key, keyLocation: config.keyLocation });

    posts = site(eight, day1, () => 200);
    await run({ stateDir, log: quiet });
    expect(posts).toEqual([]);

    // faq/ changes, ai/ is deleted, tools/ is new; Naver is briefly unavailable and then down.
    const day2 = { ...day1, "tools/": "2026-11-27" };
    const revisedContent = { "faq/": "<p>같은 날 보강된 질문과 답변</p>" };
    const next = eight.filter((p) => p !== "ai/").concat("tools/");
    let naverCalls = 0;
    posts = site(next, day2, (name) => (name === "naver" ? (++naverCalls, 503) : 200), revisedContent);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const pending = run({ stateDir, log: quiet });
    await vi.runAllTimersAsync();
    const second = await pending;
    vi.useRealTimers();
    expect(second.ok).toBe(false);
    expect(naverCalls).toBe(5);
    expect(posts.find((p) => p.name === "bing")!.body.urlList).toEqual([SITE + "tools/", SITE + "faq/", SITE + "ai/"]);

    // Next run: Bing has nothing left, Naver gets the same three URLs again.
    posts = site(next, day2, () => 202, revisedContent);
    expect((await run({ stateDir, log: quiet })).ok).toBe(true);
    expect(posts.map((p) => [p.name, p.body.urlList])).toEqual([["naver", [SITE + "tools/", SITE + "faq/", SITE + "ai/"]]]);
    const log = readFileSync(join(stateDir, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.map((l) => `${l.endpoint}:${l.result}`)).toEqual(["bing:accepted", "naver:accepted", "bing:nothing", "naver:nothing", "bing:accepted", "naver:failed", "bing:nothing", "naver:accepted"]);
    expect(readFileSync(join(stateDir, "summary.md"), "utf8")).toContain("| bing | 8 | 0 | 0 | ✅ 200 | 1 |");
  });

  it("migrates date-only state separately for each endpoint after acceptance", async () => {
    // @ts-expect-error plain ESM module
    const { run } = await import("../scripts/seo/indexnow-submit.mjs");
    const stateDir = mkdtempSync(join(tmpdir(), "indexnow-"));
    const stateFile = join(stateDir, "state.json");
    const lastmod = "2026-11-26";
    const urls = { [SITE]: lastmod, [SITE + "faq/"]: lastmod };
    writeFileSync(stateFile, JSON.stringify({ version: 1, endpoints: { bing: { urls }, naver: { urls } } }));

    let posts = site(["", "faq/"], { "": lastmod, "faq/": lastmod }, (name) => name === "naver" ? 403 : 202);
    const first = await run({ stateDir, log: () => {} });
    expect(first.ok).toBe(false);
    expect(posts.map((p) => p.body.urlList)).toEqual([Object.keys(urls), Object.keys(urls)]);
    const migrated = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(migrated.version).toBe(2);
    expect(migrated.endpoints.bing.urls[SITE]).toEqual({ lastmod, fingerprint: lib.contentFingerprint(page("")) });
    expect(migrated.endpoints.naver.urls).toEqual(urls);

    posts = site(["", "faq/"], { "": lastmod, "faq/": lastmod }, () => 200);
    expect((await run({ stateDir, log: () => {} })).ok).toBe(true);
    expect(posts.map((p) => [p.name, p.body.urlList])).toEqual([["naver", Object.keys(urls)]]);
  });

  it("does not submit when the live site fails verification", async () => {
    // @ts-expect-error plain ESM module
    const { run } = await import("../scripts/seo/indexnow-submit.mjs");
    const stateDir = mkdtempSync(join(tmpdir(), "indexnow-"));
    const posts = site(["", "faq/"], { "": "2026-11-26", "faq/": "2026-11-26" }, () => 200);
    const fetchOk = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) =>
      input.startsWith(SITE + "faq/") ? new Response(page("faq/", '<meta name="robots" content="noindex">'), { headers: { "content-type": "text/html" } }) : fetchOk(input, init));
    const result = await run({ stateDir, log: () => {} });
    expect(result).toMatchObject({ ok: false, blocked: true });
    expect(posts).toEqual([]);
    expect(existsSync(join(stateDir, "state.json"))).toBe(false);
  });
});

describe("asset retention", () => {
  it("reads the service worker lists and the entry HTML", () => {
    const swJs = 'const BUILD = "a";\nconst ASSETS = ["assets/index-1.js","ai/x.gz","guide/index.html"];\nconst OPTIONAL_ASSETS = ["assets/pmf-2.wasm"];\n';
    const indexHtml = '<script type="module" crossorigin src="/YachtLab/assets/index-1.js"></script><link rel="stylesheet" href="/YachtLab/assets/index-3.css">';
    expect(assetsOf({ swJs, indexHtml })).toEqual(["assets/index-1.js", "assets/index-3.css", "assets/pmf-2.wasm"]);
  });
  it("keeps 14 days of generations and never fewer than three", () => {
    const now = Date.parse("2026-12-31T00:00:00Z");
    const g = (build: string, at: string) => ({ build, at, files: [] });
    const history = [g("e", "2026-12-30T00:00:00Z"), g("d", "2026-12-01T00:00:00Z"), g("d", "2026-12-01T00:00:00Z"), g("c", "2026-11-30T00:00:00Z"), g("b", "2026-11-01T00:00:00Z")];
    expect(pruneHistory(history, now).map((x: { build: string }) => x.build)).toEqual(["e", "d", "c"]);
  });
});
