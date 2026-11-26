import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';

const offsets = process.argv.slice(2);
assert.equal(offsets.length, 2, 'Supply local baseline and candidate URLs in that order');
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--enable-unsafe-swiftshader'],
});
try {
  const checks = [];
  for (const target of offsets.map(input => new URL(input))) {
    assert.equal(target.protocol, 'http:');
    assert.equal(target.hostname, '127.0.0.1');
    const context = await browser.newContext({ ...devices['Pixel 7'], reducedMotion: 'no-preference' });
    try {
      const page = await context.newPage();
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      const shelf = page.locator('.dice-hold-area');
      await shelf.waitFor();
      await page.addScriptTag({ path: process.env.YACHT_AXE_SCRIPT });
      const targets = await page.evaluate(async () => {
        const results = await window.axe.run(document.querySelector('.guided-dice'), {
          runOnly: { type: 'rule', values: ['aria-prohibited-attr'] },
        });
        return results.violations.flatMap(rule => rule.nodes.flatMap(node => node.target));
      });
      const roll = page.getByRole('button', { name: '주사위 굴리기' });
      await roll.tap();
      await page.getByRole('button', { name: '주사위 1, 6, 고정 안 됨', exact: true }).tap();
      const kept = page.getByRole('button', { name: '주사위 1, 6, 고정됨', exact: true });
      assert.equal(await kept.getAttribute('aria-pressed'), 'true');
      checks.push({ hits: targets, shelfHidden: await shelf.getAttribute('aria-hidden'), keepButtonPressed: true });
    } finally { await context.close(); }
  }
  assert(checks[0].hits.some(target => target.includes('dice-hold-area')));
  assert.deepEqual(checks[1].hits, []);
  assert.equal(checks[1].shelfHidden, 'true');
  console.log(JSON.stringify({ baseline: checks[0], candidate: checks[1] }, null, 2));
} finally { await browser.close(); }
