import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { classify } from "../scripts/ci/classify-changes.mjs";

describe("CI change classification (D-061)", () => {
  it("runs everything when the change list is unknown or empty", () => {
    expect(classify([])).toBe("full");
    expect(classify(["", "  "])).toBe("full");
  });
  it("skips the site pipeline for documentation and research workflows only", () => {
    expect(classify(["docs/context/RESULTS.md", "README.md", ".github/workflows/v5-apex-research.yml"])).toBe("docs");
  });
  it("never treats the site workflow, code, data or the app shell as documentation", () => {
    expect(classify(["docs/a.md", ".github/workflows/deploy.yml"])).toBe("full");
    expect(classify(["docs/a.md", "src/App.tsx"])).toBe("full");
    expect(classify(["training/research-archive/v4-reinforce-seed1-frozen.json"])).toBe("full");
    expect(classify(["benchmarks/summary.json"])).toBe("full");
    expect(classify(["index.html"])).toBe("full");
    expect(classify(["public/pwa-worker.js"])).toBe("full");
    expect(classify(["public/manifest.webmanifest"])).toBe("full");
  });
  it("uses the fast lane for static search pages", () => {
    expect(classify(["public/guide/index.html", "public/sitemap.xml"])).toBe("seo");
    expect(classify(["public/faq/index.html", "docs/context/ROADMAP.md"])).toBe("seo");
    expect(classify(["public/faq/index.html", "public/sitemap.xml", "scripts/seo/lastmod.json"])).toBe("seo");
    expect(classify(["scripts/seo/build-pages.mjs", "public/sitemap.xml"])).toBe("full");
    expect(classify(["public/guide/index.html", "src/engine.ts"])).toBe("full");
  });
});
