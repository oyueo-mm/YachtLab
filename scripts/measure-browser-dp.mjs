import { chromium } from "@playwright/test";
import { readdir, writeFile } from "node:fs/promises";
import { createGame, transition } from "../src/engine.ts";
const file = (await readdir("dist/assets")).find(
  (n) => n.startsWith("worker-") && n.endsWith(".js"),
);
const workerUrl = `http://127.0.0.1:5173/YachtLab/assets/${file}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5173/YachtLab/");
  const state = transition(createGame(42), { type: "roll" });
  const timing = await page.evaluate(
    async ({ workerUrl, state }) => {
      const start = performance.now();
      window.dpBenchmarkWorker = new Worker(workerUrl, { type: "module" });
      const run = (state) =>
        new Promise((resolve, reject) => {
          window.dpBenchmarkWorker.onmessage = (e) =>
            e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
          window.dpBenchmarkWorker.onerror = (e) => reject(Error(e.message));
          window.dpBenchmarkWorker.postMessage({
            id: 1,
            type: "decide",
            algorithm: "DP Expert",
            state,
          });
        });
      await run(state);
      const coldMs = performance.now() - start,
        elapsed = [];
      for (let i = 0; i < 100; i++) {
        const current = {
          ...state,
          dice: state.dice.map((d, j) => ({ ...d, value: 1 + ((i + j) % 6) })),
        };
        const t = performance.now();
        await run(current);
        elapsed.push(performance.now() - t);
      }
      return {
        coldMs,
        warmMeanMs: elapsed.reduce((a, b) => a + b, 0) / elapsed.length,
        warmMaxMs: Math.max(...elapsed),
        samples: elapsed.length,
      };
    },
    { workerUrl, state },
  );
  const browserCDP = await browser.newBrowserCDPSession();
  const { targetInfos } = await browserCDP.send("Target.getTargets");
  const target = targetInfos.find(
    (t) => t.type === "worker" && t.url === workerUrl,
  );
  const { sessionId } = await browserCDP.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  });
  const heapPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Worker heap measurement timeout")),
      10000,
    );
    browserCDP.on("Target.receivedMessageFromTarget", (event) => {
      if (event.sessionId !== sessionId) return;
      const response = JSON.parse(event.message);
      if (response.id === 17) {
        clearTimeout(timer);
        if (response.error) reject(Error(response.error.message));
        else resolve(response.result);
      }
    });
  });
  await browserCDP.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({ id: 17, method: "Runtime.getHeapUsage" }),
  });
  const workerHeap = await heapPromise;
  const mainCDP = await page.context().newCDPSession(page);
  const mainHeap = await mainCDP.send("Runtime.getHeapUsage");
  const report = {
    environment:
      "localhost production build; Chromium; retained dedicated worker; 100 warm round trips",
    browser: browser.version(),
    ...timing,
    workerHeap,
    mainHeap,
  };
  await writeFile(
    "benchmarks/browser-dp.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  await page.evaluate(() => window.dpBenchmarkWorker.terminate());
} finally {
  await browser.close();
}
