import { expect, test } from "@playwright/test";

const HOME_URL = "https://oyueo-mm.github.io/YachtLab/";
const HOME_TITLE = "온라인 요트다이스(야추 다이스) · 무료 AI·친구 멀티 | Online Yacht";

test("저장 기록이 없는 첫 방문에서 JS 실행 여부와 관계없이 홈페이지의 검색 정보를 제공한다", async ({ browser, baseURL, request }) => {
  const contexts = await Promise.all([false, true].map((javaScriptEnabled) =>
    browser.newContext({ baseURL, javaScriptEnabled, viewport: { width: 390, height: 844 } }),
  ));
  try {
    const [raw, rendered] = await Promise.all(contexts.map((context) => context.newPage()));
    const read = async (page: typeof raw) => ({
      title: await page.title(),
      description: await page.locator('meta[name="description"]').getAttribute("content"),
      intro: await page.locator("main h1 + p").innerText(),
      links: await page.getByRole("navigation", { name: "도구와 안내" }).getByRole("link").evaluateAll((links) =>
        links.map((link) => [link.textContent?.trim(), link.getAttribute("href")]),
      ),
    });
    for (const page of [raw, rendered]) {
      await page.goto("./");
      if (page === rendered) await expect(page.locator(".lobby")).toBeVisible();
      await expect(page.getByRole("heading", { name: "온라인 요트다이스", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "튜토리얼" })).toHaveCount(0);
      await expect(page).toHaveTitle(HOME_TITLE);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", HOME_URL);
      await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "Online Yacht");
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", HOME_URL);
      await expect(page.locator('meta[name="google-site-verification"]')).toHaveAttribute("content", "wJt-lkmKFMcAXpu9gEUMBhyBrWsPSftS2ig_4ozPeSE");
      const graph = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText())["@graph"];
      expect(graph).toEqual(expect.arrayContaining([
        expect.objectContaining({ "@type": "WebSite", "@id": HOME_URL + "#website", url: HOME_URL, name: "Online Yacht" }),
        expect.objectContaining({ "@type": "VideoGame", url: HOME_URL, isPartOf: { "@id": HOME_URL + "#website" }, isAccessibleForFree: true }),
      ]));
    }
    const expected = await read(raw);
    expect(expected.description).toContain("PC와 모바일");
    expect(expected.description).toContain("야추 다이스");
    expect(expected.intro).toContain("온라인 멀티플레이");
    // The rendered home shows only the rules and the FAQ; the static (no-JS) shell keeps every search
    // page link, and the rules / FAQ pages link to all of them (2026-11-26).
    const shown = await read(rendered);
    expect({ ...shown, links: [] }).toEqual({ ...expected, links: [] });
    expect(shown.links.map(([label]) => label)).toEqual(["규칙", "자주 묻는 질문"]);
    expect(expected.links.map(([, href]) => href)).toEqual(expect.arrayContaining(["/YachtLab/guide/", "/YachtLab/faq/", "/YachtLab/probability/", "/YachtLab/scores/", "/YachtLab/strategy/", "/YachtLab/ai/", "/YachtLab/multiplayer/"]));
    await rendered.getByRole("button", { name: /오프라인 대전/ }).click();
    await expect(rendered.getByRole("heading", { name: "오프라인 대전", exact: true })).toBeVisible();
    await expect(rendered).toHaveTitle(HOME_TITLE);
    await expect(rendered.locator('meta[name="description"]')).toHaveAttribute("content", expected.description!);
    await expect(rendered.locator('link[rel="canonical"]')).toHaveAttribute("href", HOME_URL);
    const icon = raw.locator('link[rel="icon"][sizes="192x192"]');
    await expect(icon).toHaveAttribute("href", "/YachtLab/icons/app-192.png");
    const favicon = await request.get("./icons/app-192.png");
    expect(favicon.ok()).toBe(true);
    expect(favicon.headers()["content-type"]).toContain("image/png");
    expect((await favicon.body()).readUInt32BE(16)).toBe(192);
    expect((await favicon.body()).readUInt32BE(20)).toBe(192);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("홈과 가이드는 자바스크립트 없이 열리고 사이트맵의 canonical 주소와 일치한다", async ({ browser, request, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 360, height: 780 } });
  try {
    const page = await context.newPage();
    const home = await page.goto("./");
    expect(home?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "온라인 요트다이스" })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://oyueo-mm.github.io/YachtLab/");
    await page.getByRole("link", { name: "규칙과 전략" }).click();
    await expect(page).toHaveURL(/\/YachtLab\/guide\/$/);
    await expect(page.getByRole("table").first().locator("tbody tr")).toHaveCount(12);
    await expect(page.getByRole("heading", { name: "첫 굴림에서 족보가 나올 확률" })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://oyueo-mm.github.io/YachtLab/guide/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    const sitemap = await request.get("./sitemap.xml");
    expect(sitemap.ok()).toBe(true);
    expect(await sitemap.text()).toContain("<loc>https://oyueo-mm.github.io/YachtLab/guide/</loc>");
  } finally {
    await context.close();
  }
});

const SEARCH_PAGES = ["faq/", "ai/", "multiplayer/", "strategy/", "scores/", "probability/"];

test("검색용 페이지는 자바스크립트 없이 열리고 canonical·사이트맵·게임 링크를 갖는다", async ({ browser, request, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 360, height: 780 } });
  try {
    const page = await context.newPage();
    const sitemapResponse = await request.get("./sitemap.xml");
    expect(sitemapResponse.status()).toBe(200);
    expect(sitemapResponse.headers()["content-type"]).toMatch(/xml/);
    const sitemap = await sitemapResponse.text();
    const entries = await page.evaluate((xml) => {
      const document = new DOMParser().parseFromString(xml, "application/xml");
      return {
        namespace: document.documentElement.namespaceURI,
        urls: [...document.getElementsByTagName("loc")].map((loc) => loc.textContent),
      };
    }, sitemap);
    expect(entries.namespace).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
    expect(entries.urls.sort()).toEqual(["", "guide/", ...SEARCH_PAGES].map((path) => HOME_URL + path).sort());
    const titles = new Set<string>();
    for (const path of SEARCH_PAGES) {
      const res = await page.goto("./" + path);
      expect(res?.status(), path).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://oyueo-mm.github.io/YachtLab/" + path);
      titles.add(await page.title());
      expect(sitemap).toContain(`<loc>https://oyueo-mm.github.io/YachtLab/${path}</loc>`);
      await expect(page.locator('a[href="../#online"]').first()).toBeAttached();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(360);
    }
    expect(titles.size).toBe(SEARCH_PAGES.length);
  } finally {
    await context.close();
  }
});

test("초대·캠페인 파라미터가 있어도 홈 canonical은 기본 주소다", async ({ page }) => {
  await page.goto("./?room=ABC234&utm_source=kakao&utm_medium=share&utm_campaign=test#online");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://oyueo-mm.github.io/YachtLab/");
});

test("실제 주사위용 점수판: 보너스·합계·승자 자동 계산, 새로고침 후 유지", async ({ page }) => {
  await page.goto("./scores/");
  const fill = async (label: string, value: number) => page.getByLabel(label, { exact: true }).fill(String(value));
  for (const [cat, a, b] of [["에이스 (1)", 3, 1], ["듀스 (2)", 6, 4], ["트리플 (3)", 9, 6], ["쿼드 (4)", 12, 8], ["펜타 (5)", 15, 10], ["헥사 (6)", 18, 12]] as const) {
    await fill(`플레이어 1 ${cat}`, a);
    await fill(`플레이어 2 ${cat}`, b);
  }
  await expect(page.locator('[data-bonus="0"]')).toHaveText("+35 (63)");
  await expect(page.locator('[data-bonus="1"]')).toHaveText("41 / 63");
  for (const [cat, a, b] of [["초이스", 20, 22], ["포커", 0, 0], ["풀 하우스", 25, 0], ["스몰 스트레이트", 15, 15], ["라지 스트레이트", 30, 0], ["요트", 0, 50]] as const) {
    await fill(`플레이어 1 ${cat}`, a);
    await fill(`플레이어 2 ${cat}`, b);
  }
  await expect(page.locator('[data-total="0"]')).toHaveText(String(63 + 35 + 20 + 25 + 15 + 30));
  await expect(page.locator('[data-total="1"]')).toHaveText(String(41 + 22 + 15 + 50));
  await expect(page.locator("#pad-winner")).toContainText("승자: 플레이어 1");
  await page.reload();
  await expect(page.locator('[data-total="0"]')).toHaveText("188");
});

test("족보 확률 계산기: 2·3·4·5 킵, 재굴림 1번이면 라지 스트레이트 33.3%", async ({ page }) => {
  await page.goto("./probability/");
  const rows = page.locator("#odds tbody tr");
  await expect(rows).toHaveCount(12);
  await page.locator('input[name="rolls"][value="1"]').check();
  await expect(rows.filter({ hasText: "라지 스트레이트" }).locator("td").nth(1)).toContainText("33.3%");
  await expect(rows.filter({ hasText: "라지 스트레이트" }).locator("td").nth(3)).toHaveText("2·3·4·5");
});

test("UTM이 붙은 초대 링크도 방 입장 화면을 열고, 캠페인 값은 기기에 남기고 주소에서는 지운다", async ({ page }) => {
  await page.goto("./?room=ABC234&utm_source=kakao&utm_medium=invite&utm_campaign=test");
  await expect.poll(() => page.url()).not.toContain("utm_");
  expect(new URL(page.url()).searchParams.get("room")).toBe("ABC234");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("yachtlab.attribution.v1") ?? "null"));
  expect(stored.first).toMatchObject({ source: "kakao", medium: "invite", campaign: "test" });
});

test("사이트맵의 모든 주소에 lastmod가 있고 IndexNow 키 파일이 텍스트로 제공된다", async ({ request }) => {
  const sitemap = await (await request.get("./sitemap.xml")).text();
  const urls = sitemap.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  expect(urls).toHaveLength(8);
  for (const url of urls) expect(url).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  const key = "b3678a0369af6c2c422e25516dad7aab";
  const res = await request.get(`./${key}.txt`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  expect(await res.text()).toBe(key);
});
