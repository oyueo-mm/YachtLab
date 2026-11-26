import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, devices } from 'playwright';

const root = resolve(process.argv[2]);
const context = JSON.parse(await readFile(join(root, 'build-context.json'), 'utf8'));
const lighthouseRoot = resolve(process.env.YACHT_LIGHTHOUSE_ROOT);
const { default: lighthouse } = await import(join(lighthouseRoot, 'core/index.js'));
const requireFromLighthouse = createRequire(join(lighthouseRoot, 'package.json'));
const { launch } = await import(requireFromLighthouse.resolve('chrome-launcher'));
const desktop = process.env.YACHT_DESKTOP === '1';
const config = desktop ? (await import(join(lighthouseRoot, 'core/config/desktop-config.js'))).default : undefined;
const chrome = process.env.PW_CHROMIUM_PATH || '/usr/bin/chromium';
const flags = ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'];
const scope = '/YachtLab/';
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const responses = new Map();
let variant;
let requests = [];
const keys = ['first-contentful-paint', 'largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time', 'total-byte-weight'];

async function asset(file) {
  if (!responses.has(file)) {
    const body = await readFile(file);
    const compress = /\.(html|js|css|json|webmanifest|wasm|svg)$/.test(file);
    responses.set(file, { body: compress ? gzipSync(body) : body, encoding: compress ? 'gzip' : null });
  }
  return responses.get(file);
}
const started = new Map();
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const build = join(root, variant);
  const file = resolve(build, (path.endsWith('/') ? path + 'index.html' : path).slice(scope.length));
  if (!path.startsWith(scope) || !file.startsWith(build + '/')) { res.writeHead(404).end(); return; }
  try {
    const { body, encoding } = await asset(file);
    requests.push({ path, bytes: body.length, ms: Math.round(performance.now() - started.get(variant)) });
    res.writeHead(200, {
      'content-type': contentTypes[extname(file)] || 'application/octet-stream',
      'cache-control': path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(encoding ? { 'content-encoding': encoding } : {}),
      'content-length': body.length,
    }).end(body);
  } catch { res.writeHead(404).end(); }
});
for (const name of context.variants) {
  const build = join(root, name);
  const worker = await readFile(join(build,'sw.js'),'utf8');
  const precache = JSON.parse(worker.match(/^const ASSETS = (.*);$/m)[1]);
  for (const file of new Set(['index.html','version.json','sw.js',...precache,...(await readdir(join(build,'assets'))).map(name=>'assets/'+name)])) {
    await asset(join(build,file));
  }
}

const only = process.env.YACHT_PROFILE_ONLY;
if (only) context.variants = context.variants.filter(name => name === only);
if (!context.variants.length) throw new Error('No matching variants');
const output = join(root, 'measurements' + (desktop ? '-desktop' : '') + (only ? '-' + only : '') + '.json');
const report = { ...context, browser: chrome, lighthouse: [], interaction: [] };
const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
const reset = () => { requests = []; started.set(variant, performance.now()); };
const roundOrder = cycle => [...context.variants.slice(cycle), ...context.variants.slice(0, cycle)];
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + scope;
try {
  if (!process.env.YACHT_INTERACTION_ONLY) for (let cycle = 0; cycle < 3; cycle++) for (const name of roundOrder(cycle)) {
    variant = name;
    const instance = await launch({ chromePath: chrome, chromeFlags: flags, logLevel: 'silent' });
    reset();
    try {
      const { lhr } = await lighthouse(url, { port: instance.port, logLevel: 'error', output: 'json',
        onlyCategories: ['performance', 'accessibility'] }, config);
      if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
      const pathOnly = item => item.url?.startsWith('http') ? new URL(item.url).pathname : item.url;
      report.lighthouse.push({
        name, cycle: cycle + 1, version: lhr.lighthouseVersion, performance: lhr.categories.performance.score,
        accessibility: lhr.categories.accessibility.score, aria: lhr.audits['aria-prohibited-attr']?.score,
        metrics: Object.fromEntries(keys.map(key => [key, lhr.audits[key]?.numericValue ?? null])),
        timings: (lhr.audits['user-timings']?.details?.items ?? []).filter(item => item.name?.startsWith('dice-')),
        boot: (lhr.audits['bootup-time']?.details?.items ?? []).slice(0, 6).map(item => ({ ...item, url: pathOnly(item) })),
        network: (lhr.audits['network-requests']?.details?.items ?? []).map(item => ({ path: pathOnly(item), bytes: item.transferSize })),
        server: [...requests],
      });
      console.log('Lighthouse', name, cycle + 1, lhr.categories.performance.score);
      await save();
    } finally { await instance.kill(); }
  }

  if (!desktop) {
    const browser = await chromium.launch({ executablePath: chrome, args: flags });
    try {
      for (let cycle = 0; cycle < 3; cycle++) for (const name of roundOrder(cycle)) {
        variant = name;
        const browserContext = await browser.newContext({ ...devices['Pixel 7'], reducedMotion: 'no-preference' });
        try {
          const page = await browserContext.newPage();
          const cdp = await browserContext.newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await cdp.send('Network.enable');
          await cdp.send('Network.emulateNetworkConditions', {
            offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 100000,
          });
          reset();
          await page.goto(url, { waitUntil: 'commit' });
          const roll = page.getByRole('button', { name: '주사위 굴리기' });
          await page.waitForFunction(() => !!document.querySelector('button.roll-button:enabled'));
          const readyMs = await page.evaluate(() => Math.round(performance.now()));
          await roll.tap();
          await page.getByText('첫 번째 6을 눌러 킵하세요.').waitFor();
          await page.locator('[data-die-id="0"] button:enabled, button[data-die-id="0"]:enabled').first().waitFor({ timeout: 20000 });
          const keepReadyMs = await page.evaluate(() => Math.round(performance.now()));
          const cache = await page.evaluate(async () => {
            const ready = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(r => setTimeout(() => r(false), 12000))]);
            return { ready, keys: (await caches.keys()).length };
          });
          const marks = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map(e => [e.name, Math.round(e.startTime)])));
          report.interaction.push({ name, cycle: cycle + 1, readyMs, keepReadyMs, cache, marks, server: [...requests] });
          console.log('Interaction', name, cycle + 1, readyMs, keepReadyMs);
          await save();
        } finally { await browserContext.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
