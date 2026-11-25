import { expect, test, type Page } from "@playwright/test";

async function startVeryHard(page: Page, trial: boolean) {
  await page.goto(trial ? "?ai-model=v5-r#play-setup" : "#play-setup");
  await page.getByRole("radiogroup", { name: "AI 난이도" }).getByText("매우 어려움", { exact: true }).click();
  await page.getByRole("radiogroup", { name: "선공" }).getByText("AI 먼저", { exact: true }).click();
  await page.getByRole("button", { name: "게임 시작" }).click();
}

test("v5-R은 명시적으로 선택한 경우에만 준비하고, 취소하면 기존 AI가 경기 진행을 이어간다", async ({ page }) => {
  await page.route("**/assets/pmf-*.wasm", async (route) => {
    // Abort the request through worker termination only after the user has had a chance to cancel.
    const wait = await page.waitForEvent("response", {
      predicate: (response) => /worker-.*\.js$/.test(response.url()) && !response.url().includes("product-worker"),
    }).catch(() => undefined);
    if (wait) await route.abort().catch(() => undefined);
  });
  await startVeryHard(page, true);
  await page.getByRole("button", { name: "준비 취소" }).click();
  await expect(page.locator(".roll-button")).toBeEnabled({ timeout: 25_000 });
});

test("v5-R 판단은 워커에서 실행되고 모델 버전이 실제 판단과 함께 반환된다", async ({ page }) => {
  const productWorkers: string[] = [];
  page.on("worker", (worker) => {
    if (worker.url().includes("product-worker")) productWorkers.push(worker.url());
  });
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("product-worker")) return;
        this.addEventListener("message", ({ data }) => {
          if (data.decision) document.documentElement.dataset.productModel = data.decision.execution?.id + ":" + data.decision.execution?.version;
        });
      }
    };
  });
  await page.goto("#home");
  expect(productWorkers).toHaveLength(0);
  await startVeryHard(page, true);
  await expect(page.locator("html")).toHaveAttribute("data-product-model", /^win-dp-v5-r:v5-research-.*wasm-f32/, { timeout: 34_000 });
  await expect(page.locator(".roll-button")).toBeEnabled({ timeout: 25_000 });
  expect(productWorkers).toHaveLength(1);
});

test("같은 브라우저의 두 탭이 동시에 시험 모델을 켜도 OPFS 은행을 한 번만 생성한다", async ({ context, page }) => {
  await context.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("product-worker")) return;
        this.addEventListener("message", ({ data }) => {
          if (data.diagnostics) document.documentElement.dataset.productSource = data.diagnostics.source;
        });
      }
    };
  });
  const second = await context.newPage();
  await Promise.all([startVeryHard(page, true), startVeryHard(second, true)]);
  const sources = [page, second].map((tab) => tab.locator("html"));
  await Promise.all(sources.map((surface) => expect(surface).toHaveAttribute("data-product-source", /^(wasm|opfs)$/, { timeout: 42_000 })));
  const results = await Promise.all(sources.map((surface) => surface.getAttribute("data-product-source")));
  expect(results.sort()).toEqual(["opfs", "wasm"]);
  await second.close();
});
