// Chromium (Playwright) benchmark of v7 single-bank product candidates. Research-only.
//   node scripts/research-v7/browser/run.cjs desktop|mobile-main KIND [games] [window fallback]
// desktop      : decisions in a Web Worker (real host speed; main-thread frame gaps recorded)
// mobile-main  : Pixel 7 emulation + CDP CPU throttle x4 applied to the MAIN thread, decisions run on the main
//                thread (CDP throttling does not reach workers). EMULATION of a slower CPU, not a real phone.
const { chromium, devices } = require("playwright");
const esbuild = require("esbuild");
const fs = require("fs"), zlib = require("zlib"), path = require("path");
const [mode = "desktop", kind = "I2RO1", games = "20", win, fb] = process.argv.slice(2);
const root = path.join(__dirname, "../../..");
const manifest = require(path.join(root, "src/dp-manifest.json"));
const dp = zlib.gunzipSync(fs.readFileSync(path.join(root, "public/ai", manifest.asset)));
const wasm = fs.readFileSync(path.join(root, "training/v6-wasm/pmf.wasm"));
const bundle = esbuild.buildSync({ entryPoints: [path.join(__dirname, "bench-entry.ts")], bundle: true, format: "iife", globalName: "BENCH", write: false, platform: "browser", target: "es2022", loader: { ".json": "json" }, logLevel: "error", define: { "import.meta.env.BASE_URL": "\"/\"" } }).outputFiles[0].text;
const workerSrc = bundle + "\nonmessage = async (e) => { try { postMessage(await BENCH.run(e.data)); } catch (err) { postMessage({ error: String(err && err.stack || err) }); } };";
(async () => {
  const browser = await chromium.launch({ args: ["--enable-precise-memory-info"], ...(require("fs").existsSync("/opt/pw-browsers/chromium") ? { executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" } : {}) });
  const ctx = await browser.newContext(mode === "mobile-main" ? { ...devices["Pixel 7"] } : {});
  const page = await ctx.newPage();
  if (mode === "mobile-main") { const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await page.setContent("<html><body>bench</body></html>");
  const msg = { kind, games: Number(games), seed0: 97000, window: win ? Number(win) : undefined, fallback: fb };
  const res = await page.evaluate(async ({ src, wasmB64, dpB64, msg, inWorker }) => {
    const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
    const data = { ...msg, wasm: b64(wasmB64), dp: b64(dpB64) };
    let maxGap = 0, last = performance.now(), running = true;
    const tick = (t) => { maxGap = Math.max(maxGap, t - last); last = t; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    let out;
    if (inWorker) {
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      out = await new Promise((r) => { w.onmessage = (e) => r(e.data); w.postMessage(data); });
      w.terminate();
    } else { (0, eval)(src.replace(/\nonmessage[\s\S]*$/, "")); out = await self.BENCH.run(data); }
    running = false;
    return { ...out, mainThreadMaxFrameGapMs: inWorker ? maxGap : null, userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency };
  }, { src: workerSrc, wasmB64: wasm.toString("base64"), dpB64: dp.toString("base64"), msg, inWorker: mode !== "mobile-main" });
  console.log(JSON.stringify({ mode, ...res }));
  await browser.close();
})();
