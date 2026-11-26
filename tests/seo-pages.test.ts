import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error plain ESM build script
import { build } from "../scripts/seo/build-pages.mjs";
// @ts-expect-error plain ESM content module
import { PAGES } from "../scripts/seo/pages-content.mjs";

describe("static search pages (D-062)", () => {
  it("committed HTML and sitemap match the generator", () => {
    expect(build({ check: true })).toEqual([]);
  });
  it("every page has its own title, description, canonical and one h1", () => {
    const titles = new Set<string>();
    for (const page of PAGES as { path: string }[]) {
      const html = readFileSync(new URL(`../public/${page.path}index.html`, import.meta.url), "utf8");
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
      expect(title.length).toBeGreaterThan(10);
      expect(titles.has(title)).toBe(false);
      titles.add(title);
      expect(html).toContain(`<link rel="canonical" href="https://oyueo-mm.github.io/YachtLab/${page.path}">`);
      expect(html.match(/<h1>/g)?.length).toBe(1);
      expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/);
      expect(() => JSON.parse(html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)![1])).not.toThrow();
      // Never presented as the official Yahtzee product.
      expect(html).toContain("공식 제품이 아니며");
    }
  });
  it("the home page keeps the Search Console tag, canonical and structured data", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain('<meta name="google-site-verification" content="wJt-lkmKFMcAXpu9gEUMBhyBrWsPSftS2ig_4ozPeSE" />');
    expect(html).toContain('<link rel="canonical" href="https://oyueo-mm.github.io/YachtLab/">');
    expect(html).toContain("<title>온라인 요트다이스(야추) - 무료 플레이 · AI · 친구 대전 | Online Yacht</title>");
    expect(html).toContain('"@type":"VideoGame"');
    for (const page of PAGES as { path: string }[]) expect(html).toContain(`%BASE_URL%${page.path}"`);
  });
});
