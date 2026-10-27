import { chromium } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:5173/YachtLab/";
const asset = (await readdir("dist/assets")).find((x) =>
  /^worker-.*\.js$/.test(x),
);
const state = JSON.parse(
  await readFile("benchmarks/v04/strategy-example.json", "utf8"),
).state;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(base);
  const result = await page.evaluate(
    async ({ url, state }) => {
      const rows = [];
      for (const algorithm of [
        "PPO",
        "Distilled Policy",
        "Distilled PPO",
        "DP Expert",
      ]) {
        const start = performance.now(),
          worker = new Worker(url, { type: "module" });
        let id = 0;
        const decide = () =>
          new Promise((resolve, reject) => {
            worker.onmessage = ({ data }) =>
              data.error ? reject(Error(data.error)) : resolve(data.result);
            worker.onerror = (e) => reject(Error(e.message));
            worker.postMessage({ id: ++id, type: "decide", state, algorithm });
          });
        await decide();
        const firstMs = performance.now() - start,
          latencies = [];
        for (let i = 0; i < 100; i++) {
          const t = performance.now();
          await decide();
          latencies.push(performance.now() - t);
        }
        worker.terminate();
        latencies.sort((a, b) => a - b);
        rows.push({
          algorithm,
          firstMs,
          requests: 100,
          meanRoundTripMs: latencies.reduce((a, b) => a + b, 0) / 100,
          p95RoundTripMs: latencies[94],
        });
      }
      return { userAgent: navigator.userAgent, rows };
    },
    { url: new URL(`assets/${asset}`, base).href, state },
  );
  const report = {
    base,
    ...result,
    note: "Local Chromium measurements; first request includes worker/model preparation. HTTP cache may be warm. Round trips include message cloning. Not a public-network or mobile-device latency guarantee.",
  };
  await writeFile(
    "benchmarks/v04/browser-inference.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
} finally {
  await browser.close();
}
