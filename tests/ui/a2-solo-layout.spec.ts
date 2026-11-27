import { expect, test } from "@playwright/test";

/** 1인 플레이: one-line summary, scoreboard from the content top, 12 rows + bonus without any scroll (desktop/laptop). */
const SIZES = [[1280, 720], [1280, 635], [1366, 768], [1366, 683], [1536, 864], [1536, 779], [1920, 1080], [1920, 995]] as const;

for (const [w, h] of SIZES) {
  test(`1인 플레이 ${w}×${h}: 점수판이 스크롤 없이 한 화면에 보인다`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "desktop layout");
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(() => localStorage.setItem("yachtlab.settings.v1", JSON.stringify({ muted: true, diceQuality: "2.5d" })));
    await page.goto("#solo");
    await expect(page.locator(".solo-scores .scoreboard")).toBeVisible();
    const m = await page.evaluate(() => {
      const r = (q: string) => document.querySelector(q)!.getBoundingClientRect();
      const sb = document.querySelector(".solo-scores .scoreboard") as HTMLElement;
      const inner = document.querySelector(".solo-scores .multi-score-scroll") as HTMLElement;
      return {
        vh: innerHeight, docOver: document.documentElement.scrollHeight - innerHeight,
        sbTop: r(".solo-scores .scoreboard").top, sbBottom: r(".solo-scores .scoreboard").bottom,
        summaryTop: r(".solo-summary").top, summaryH: r(".solo-summary").height,
        innerOver: inner.scrollHeight - inner.clientHeight, sbOver: sb.scrollHeight - sb.clientHeight,
        rows: document.querySelectorAll(".solo-scores tr[data-category]").length,
        bonus: !!document.querySelector(".solo-scores .bonus-row"),
        boardH: r(".game-board").height,
      };
    });
    expect(m.rows).toBe(12);
    expect(m.bonus).toBe(true);
    expect(m.sbBottom).toBeLessThanOrEqual(m.vh);
    expect(m.docOver).toBeLessThanOrEqual(1);
    expect(m.innerOver).toBeLessThanOrEqual(1);
    expect(m.sbOver).toBeLessThanOrEqual(1);
    expect(m.summaryH).toBeLessThan(60); // one line
    expect(Math.abs(m.sbTop - m.summaryTop)).toBeLessThan(6); // scoreboard starts at the content top
    expect(m.boardH).toBeGreaterThan(Math.min(430, h - 215)); // the dice board keeps its size
  });
}

test("1인 플레이 모바일: 요약 4칸과 도구 줄이 겹치지 않고 점수 선택 버튼은 터치 크기", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone layout");
  await page.goto("#solo");
  await expect(page.locator(".solo-summary")).toBeVisible();
  const ok = await page.evaluate(() => {
    const kids = [...document.querySelectorAll(".solo-summary > div")].map((n) => n.getBoundingClientRect());
    const overlap = kids.some((a, i) => kids.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
    const tools = [...document.querySelectorAll(".solo-tools .text-button")].every((b) => b.getBoundingClientRect().height >= 36);
    return { overlap, tools, scrollX: document.documentElement.scrollWidth <= innerWidth + 1 };
  });
  expect(ok).toEqual({ overlap: false, tools: true, scrollX: true });
});
