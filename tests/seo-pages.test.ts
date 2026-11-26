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
    for (const page of PAGES as { path: string; lang?: string }[]) {
      const html = readFileSync(new URL(`../public/${page.path}index.html`, import.meta.url), "utf8");
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
      expect(title.length).toBeGreaterThan(10);
      expect(titles.has(title)).toBe(false);
      titles.add(title);
      expect(html).toContain(`<link rel="canonical" href="https://oyueo-mm.github.io/YachtLab/${page.path}">`);
      expect(html.match(/<h1>/g)?.length).toBe(1);
      expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/);
      expect(() => JSON.parse(html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)![1])).not.toThrow();
      expect(html).toContain(page.lang === "en" ? "independent of Hasbro" : "공식 제품이 아니며");
    }
  });
  it("the home page keeps the Search Console tag, canonical and structured data", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain('<meta name="google-site-verification" content="wJt-lkmKFMcAXpu9gEUMBhyBrWsPSftS2ig_4ozPeSE" />');
    expect(html).toContain('<link rel="canonical" href="https://oyueo-mm.github.io/YachtLab/">');
    expect(html).toContain("<title>온라인 요트다이스(야추 다이스) | 무료 AI·친구 대전 · Online Yacht</title>");
    expect(html).toContain('"@type":"VideoGame"');
    expect(html).toContain('%BASE_URL%guide/"');
    expect(html).toContain('%BASE_URL%faq/"');
  });
  it("publishes equivalent research sections, reciprocal locale links and article data", () => {
    for (const [lang, path, other] of [["ko", "research/", "./en/"], ["en", "research/en/", "../"]]) {
      const html = readFileSync(new URL(`../public/${path}index.html`, import.meta.url), "utf8");
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain('hreflang="ko" href="https://oyueo-mm.github.io/YachtLab/research/"');
      expect(html).toContain('hreflang="en" href="https://oyueo-mm.github.io/YachtLab/research/en/"');
      expect(html).toContain(`href="${other}" rel="alternate"`);
      expect([...html.matchAll(/<section id="([^"]+)">/g)].map((match) => match[1])).toEqual([
        "abstract", "background", "related-work", "problem-formulation", "methodology", "model-evolution",
        "experimental-setup", "benchmark-results", "ablation-study", "computational-cost", "limitations",
        "reproducibility", "future-work", "references",
      ]);
      expect(html).toContain("50.548%");
      expect(html).toContain("49.924–50.114%");
      expect(html).toContain("shards-9571-v4D.jsonl");
      const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)![1]);
      expect(data["@graph"]).toContainEqual(expect.objectContaining({ "@type": "TechArticle", inLanguage: lang }));
    }
  });
});
