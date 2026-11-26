// Serves two cache identities of the same local dist to exercise the update lifecycle.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';

const root = resolve('dist');
const output = process.env.YACHT_QA_EVIDENCE ?? '/tmp/yacht-qa';
const scope = '/YachtLab/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
let build = 'audit-one';
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (!path.startsWith(scope)) { response.writeHead(404).end(); return; }
  const file = resolve(root, (path.endsWith('/') ? path + 'index.html' : path).slice(scope.length));
  if (!file.startsWith(root + '/')) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(file);
    const body = path === scope + 'sw.js' ? data.toString().replace(/^const BUILD = .*$/m, 'const BUILD = "' + build + '";') : data;
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + scope;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(() => localStorage.setItem('yachtlab.visited.v1', '1'));
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await caches.open('unrelated-audit-cache');
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const first = await page.evaluate(() => caches.keys());
  build = 'audit-two';
  await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed');
  const waiting = await page.evaluate(() => caches.keys());
  await expect(waiting).toEqual(expect.arrayContaining(['yachtlab-static-/YachtLab/-audit-one', 'yachtlab-static-/YachtLab/-audit-two']));
  await page.close();
  const updated = await context.newPage();
  await updated.goto(url);
  const cacheNames = () => updated.evaluate(async () => (await caches.keys()).sort());
  await expect.poll(cacheNames).toEqual(['unrelated-audit-cache', 'yachtlab-static-/YachtLab/-audit-two']);
  const active = await cacheNames();
  await context.setOffline(true);
  await updated.goto(url + 'guide/');
  await expect(updated.getByRole('heading', { level: 1 })).toBeVisible();
  await updated.goto(url + '#practice');
  await expect(updated.getByRole('region', { name: '한 차례 연습하기' })).toBeVisible();
  await updated.getByRole('button', { name: '주사위 굴리기' }).click();
  await expect(updated.locator('.die-button').first()).toBeEnabled();
  await mkdir(output, { recursive: true });
  await updated.screenshot({ path: output + '/pwa-offline-practice.png' });
  await writeFile(output + '/pwa-update.json', JSON.stringify({ first, waiting, active, offlineGuide: true, offlinePractice: true }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
