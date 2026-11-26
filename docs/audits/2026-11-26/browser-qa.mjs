import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, devices, firefox, webkit } from 'playwright';
import { expect } from '@playwright/test';

const base = 'http://127.0.0.1:5173/YachtLab/';
const server = 'http://127.0.0.1:8787';
const output = process.env.YACHT_QA_EVIDENCE ?? '/tmp/yacht-qa';
const results = [];
await mkdir(output, { recursive: true });
const args = { executablePath: process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium' };
const shot = (p, name) => p.screenshot({ path: output + '/' + name + '.png' });
const visit = async (p, hash = '', room = '') => {
  const url = new URL(base);
  url.searchParams.set('online-server', server);
  if (room) url.searchParams.set('room', room);
  url.hash = hash;
  await p.goto(String(url), { waitUntil: 'domcontentloaded' });
};
const context = (b, opts = {}) => b.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block', ...opts });
const skip = async p => {
  const button = p.getByRole('button', { name: '건너뛰기' });
  await button.waitFor({ timeout: 10000 });
  await button.click();
};
const measure = p => p.evaluate(() => {
  const selectors = ['.scoreboard', '.mobile-score-scroll', '.game-screen', '.roll-button', '.game-shell', '.game-board', '.online-nick'];
  return {
    screen: [innerWidth, innerHeight], scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    rects: Object.fromEntries(selectors.map(selector => {
      const e = document.querySelector(selector);
      if (!e) return [selector, null];
      const r = e.getBoundingClientRect();
      return [selector, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), client: [e.clientWidth, e.clientHeight], scroll: [e.scrollWidth, e.scrollHeight], overflow: getComputedStyle(e).overflowY }];
    })),
    scrollers: Array.from(document.querySelectorAll('main *')).filter(e => e.getBoundingClientRect().height && e.scrollHeight > e.clientHeight + 3 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)).map(e => [String(e.className), e.clientHeight, e.scrollHeight]).slice(0, 15),
  };
});
async function scenario(name, fn) {
  try { await fn(); results.push({ name, status: 'pass' }); }
  catch (error) { results.push({ name, status: 'failed', error: String(error).slice(0, 1400) }); }
  finally { await writeFile(output + '/browser-qa.json', JSON.stringify(results, null, 2)); }
}
const browser = await chromium.launch(args);
if (process.argv.includes('--keyboard')) {
  await scenario('Focused nickname field after viewport height reduction', async () => {
    const c = await context(browser, { ...devices['Pixel 7'], viewport: { width: 320, height: 568 } });
    try {
      const page = await c.newPage();
      await visit(page, 'profile');
      await skip(page);
      await page.getByRole('button', { name: '닉네임 바꾸기' }).click();
      const field = page.getByLabel('닉네임');
      await field.fill('요트 QA');
      await page.setViewportSize({ width: 320, height: 308 });
      const save = page.getByRole('button', { name: '저장', exact: true });
      const beforeScroll = await save.boundingBox();
      await save.scrollIntoViewIfNeeded();
      const afterScroll = await save.boundingBox();
      await shot(page, 'profile-short-viewport');
      await save.click();
      await expect(page.getByText('닉네임을 바꿨어요.')).toBeVisible();
      results.push({ name: 'Nickname viewport geometry', beforeScroll, afterScroll });
    } finally { await c.close(); }
  });
} else if (process.argv.includes('--slow')) {
  await scenario('Cold production build with throttled CPU and local network', async () => {
    const c = await context(browser, devices['Pixel 7']);
    try {
      const page = await c.newPage();
      const debuggerSession = await c.newCDPSession(page);
      await debuggerSession.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await debuggerSession.send('Network.enable');
      await debuggerSession.send('Network.emulateNetworkConditions', {
        offline: false, latency: 300, downloadThroughput: 75000, uploadThroughput: 37500, connectionType: 'cellular3g',
      });
      const start = performance.now();
      await page.goto('http://127.0.0.1:4173/YachtLab/', { waitUntil: 'commit' });
      const roll = page.getByRole('button', { name: '주사위 굴리기' });
      await expect(roll).toBeEnabled({ timeout: 60000 });
      const availableMs = Math.round(performance.now() - start);
      await roll.tap();
      await expect(page.getByText(/고정해|킵/).first()).toBeVisible({ timeout: 15000 });
      results.push({ name: 'Throttled first action', availableMs, cpuRate: 4, latencyMs: 300, downBytesPerSecond: 75000 });
    } finally { await c.close(); }
  });
} else if (process.argv.includes('--multiplayer')) {
  await scenario('Guest quick match, reload while waiting, roll, emote, reconnect', async () => {
    const ac = await context(browser, { viewport: { width: 1366, height: 768 } });
    const bc = await context(browser, devices['Pixel 7']);
    try {
      const a = await ac.newPage();
      const b = await bc.newPage();
      for (const p of [a, b]) { await visit(p, 'online'); await skip(p); }
      await a.getByRole('button', { name: '빠른 대전 시작' }).click();
      await expect(a.getByText('상대를 찾는 중이에요')).toBeVisible();
      await a.reload();
      await expect(a.getByText('상대를 찾는 중이에요')).toBeVisible();
      await b.getByRole('button', { name: '빠른 대전 시작' }).click();
      const roll = a.locator('.roll-button');
      await expect(roll).toBeVisible({ timeout: 25000 });
      const current = await roll.isEnabled() ? a : b;
      await current.locator('.roll-button').click();
      await expect(current.locator('.board-top b')).toHaveText('1');
      await a.getByRole('group', { name: '이모티콘 보내기' }).getByRole('button', { name: '박수' }).click();
      await expect(b.locator('.table-feed .feed-msg.emote .feed-text')).toHaveText('👏');
      await bc.setOffline(true);
      await bc.setOffline(false);
      await b.reload();
      await expect(b.locator('.roll-button')).toBeVisible();
      results.push({ name: 'Quick match desktop geometry', ...(await measure(a)) });
      await shot(a, 'desktop-quick-1366');
    } finally { await ac.close(); await bc.close(); }
  });
  await scenario('Guest invite, first visit detour, 2-player full game, review and rematch', async () => {
    const ac = await context(browser, { viewport: { width: 1440, height: 900 } });
    const bc = await context(browser, devices['Pixel 7']);
    try {
      const a = await ac.newPage();
      const b = await bc.newPage();
      await visit(a, 'online');
      await skip(a);
      await a.getByRole('tab', { name: '친구 대전' }).click();
      await a.getByRole('button', { name: '방 만들기' }).click();
      const entry = await a.getByLabel('초대 링크').inputValue();
      await b.goto(entry);
      await skip(b);
      await b.getByRole('button', { name: '입장하기' }).click();
      await a.getByRole('button', { name: '게임 시작' }).click();
      await expect(a.locator('.roll-button')).toBeEnabled();
      for (let turn = 0; turn < 24; turn++) {
        const p = turn % 2 === 0 ? a : b;
        await p.locator('.roll-button').click();
        await expect(p.locator('.board-top b')).toHaveText('1');
        if (turn === 0) {
          const die = p.locator('.die-button').first();
          await die.click();
          await expect(die).toHaveAttribute('aria-pressed', 'true');
          await p.locator('.roll-button').click();
          await expect(p.locator('.board-top b')).toHaveText('2');
        }
        const mobileScore = p.getByRole('button', { name: '점수판 열기' });
        if (await mobileScore.isVisible()) {
          await mobileScore.click();
          await p.getByRole('dialog', { name: '점수판' }).locator('.score-option:enabled').first().click();
        } else {
          await p.locator('.scoreboard .score-option:enabled').first().click();
        }
        if (turn < 23) {
          const next = turn % 2 === 0 ? b : a;
          await expect(next.locator('.roll-button')).toBeEnabled({ timeout: 15000 });
        }
      }
      await expect(a.getByRole('button', { name: '한 번 더 플레이', exact: true })).toBeVisible();
      await expect(b.getByRole('button', { name: '한 번 더 플레이', exact: true })).toBeVisible();
      await shot(b, 'phone-invite-result');
      const review = a.getByRole('button', { name: /게임 리뷰|경기 리뷰/ }).first();
      if (await review.isVisible()) {
        await review.click();
        const dialog = a.getByRole('dialog', { name: '게임 리뷰' });
        await expect(dialog).toBeVisible({ timeout: 15000 });
        await shot(a, 'desktop-invite-review');
        await dialog.getByRole('button', { name: '돌아가기' }).click();
      } else {
        results.push({ name: 'Direct review button query', status: 'not found' });
      }
      await b.getByRole('button', { name: '한 번 더 플레이', exact: true }).click();
      await a.getByRole('button', { name: '수락', exact: true }).click();
      await expect(b.locator('.roll-button')).toBeEnabled({ timeout: 15000 });
    } finally { await ac.close(); await bc.close(); }
  });
} else {
  const profiles = [
    ['chromium-320', chromium, { ...devices['Pixel 7'], viewport: { width: 320, height: 568 } }],
    ['chromium-landscape', chromium, devices['Pixel 7 landscape']],
    ['chromium-tablet', chromium, { ...devices['iPad Mini'], viewport: { width: 768, height: 1024 } }],
    ['chromium-1024', chromium, { viewport: { width: 1024, height: 600 } }],
    ['chromium-1366', chromium, { viewport: { width: 1366, height: 768 } }],
    ['chromium-1920', chromium, { viewport: { width: 1920, height: 1080 } }],
    ['chromium-2560', chromium, { viewport: { width: 2560, height: 1440 } }],
    ['firefox-desktop', firefox, { viewport: { width: 1440, height: 900 } }],
    ['webkit-ios', webkit, devices['iPhone 13']],
  ];
  if (process.env.PW_EDGE_PATH) profiles.push(['edge-desktop', chromium, { viewport: { width: 1440, height: 900 } }]);
  for (const [name, type, options] of profiles) {
    if (process.env.YACHT_QA_PROFILE && !name.includes(process.env.YACHT_QA_PROFILE)) continue;
    await scenario(name, async () => {
      const own = type !== chromium || name === 'edge-desktop';
      const b = own ? await type.launch(type === chromium ? { executablePath: process.env.PW_EDGE_PATH } : {}) : browser;
      const c = await context(b, options);
      try {
        const page = await c.newPage();
        await visit(page);
        await expect(page.getByRole('region', { name: '튜토리얼' })).toBeVisible();
        if (name === 'chromium-320') await shot(page, 'mobile-320-first');
        await skip(page);
        await visit(page, 'play');
        const roll = page.getByRole('button', { name: '주사위 굴리기' });
        await expect(roll).toBeEnabled();
        if (options.hasTouch) await roll.tap();
        else await roll.click();
        await expect(page.locator('.board-top b')).toHaveText('1');
        const before = await measure(page);
        await shot(page, name + '-game');
        const open = page.getByRole('button', { name: '점수판 열기' });
        const mobile = await open.isVisible();
        if (mobile) {
          await open.click();
          await expect(page.getByRole('dialog', { name: '점수판' })).toBeVisible();
          await shot(page, name + '-score');
        }
        results.push({ name: name + ' geometry', version: b.version(), mobileScore: mobile, before, after: await measure(page) });
      } finally { await c.close(); if (own) await b.close(); }
    });
  }
}
await browser.close();
if (results.some(result => result.status === 'failed')) process.exitCode = 1;
