import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";
import { expect } from "@playwright/test";

const roots = process.argv.slice(2).map((path) => resolve(path));
assert.equal(roots.length, 2);
let deployed = roots[0];
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (!pathname.startsWith("/YachtLab/")) return response.writeHead(404).end();
  const file = resolve(deployed, pathname.slice("/YachtLab/".length) || "index.html");
  if (!file.startsWith(deployed + "/")) return response.writeHead(404).end();
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
  try {
    const data = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((listen) => server.listen(0, "127.0.0.1", listen));
const site = "http://127.0.0.1:" + server.address().port + "/YachtLab/";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH ?? "/usr/bin/chromium" });
try {
  const context = await browser.newContext({ reducedMotion: "no-preference" });
  const initial = await context.newPage();
  await initial.goto(site + "#home");
  await initial.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await initial.reload();
  await initial.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const before = await initial.evaluate(() => caches.keys());
  deployed = roots[1];
  await initial.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
  await expect.poll(() => initial.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe("installed");
  const staged = await initial.evaluate(() => caches.keys());
  await initial.close();
  const next = await context.newPage();
  await next.goto(site + "#home");
  const expected = JSON.parse(await readFile(resolve(deployed, "version.json"), "utf8")).build;
  await expect.poll(() => next.evaluate(async () => ({ controlled: !!navigator.serviceWorker.controller, caches: await caches.keys() }))).toEqual({
    controlled: true, caches: ["yachtlab-static-/YachtLab/-" + expected],
  });
  const after = await next.evaluate(() => caches.keys());
  await context.setOffline(true);
  await next.reload();
  await next.getByRole("heading", { name: /요트다이스를 플레이/ }).waitFor();
  await next.goto(site + "#practice");
  await next.getByRole("region", { name: "한 차례 연습하기" }).getByRole("button", { name: "주사위 굴리기" }).click();
  await next.waitForFunction(() => window.__yachtlabDice?.last?.mode === "3d");
  assert.equal(before.length, 1);
  assert.equal(staged.length, 2);
  assert.ok(staged.includes(before[0]) && staged.includes(after[0]));
  assert.notEqual(before[0], after[0]);
  console.log(JSON.stringify({ before, staged, after, offlinePhysicalRoll: true }));
} finally {
  await browser.close();
  await new Promise((closed) => server.close(closed));
}
