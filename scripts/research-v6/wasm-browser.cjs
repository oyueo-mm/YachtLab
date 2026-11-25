// Browser measurement of the WASM PMF bank build inside a Web Worker (Chromium via Playwright).
// Reports worker build time, wasm memory, and main-thread responsiveness (max rAF gap) during
// the build. "mobile" = Pixel 7 viewport + CDP CPU throttling x4: an EMULATION, not a real phone.
//   node scripts/research-v6/wasm-browser.cjs [desktop|mobile] [pmf.wasm|pmf-simd.wasm] [f64|f32]
const { chromium, devices } = require("playwright");
const fs = require("fs"), zlib = require("zlib"), path = require("path");
const mode = process.argv[2] || "desktop", wasmName = process.argv[3] || "pmf.wasm", prec = process.argv[4] || "f64";
const root = path.join(__dirname, "../..");
const manifest = require(path.join(root, "src/dp-manifest.json"));
const T = zlib.gunzipSync(fs.readFileSync(path.join(root, "public/ai", manifest.asset)));
const kernel = JSON.parse(fs.readFileSync(path.join(root, "scripts/research-v6/kernel-arrays.json"), "utf8"));
const wasm = fs.readFileSync(path.join(root, "training/v6-wasm", wasmName));
const workerSrc = `
onmessage = async (ev) => {
  const { wasm, T, kernel, f32 } = ev.data;
  const t0 = performance.now();
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const ex = instance.exports;
  const put = (src) => { const p = ex.alloc(src.byteLength); new Uint8Array(ex.memory.buffer, p, src.byteLength).set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength)); return p; };
  const pT = put(new Float64Array(T)), pPts = put(Int16Array.from(kernel.POINTS)), pProb = put(Float64Array.from(kernel.PROB)), pChild = put(Int16Array.from(kernel.CHILD)), pHs = put(Int32Array.from(kernel.HOLD_START)), pHl = put(Int16Array.from(kernel.HOLD_LIST));
  const width = f32 ? 4 : 8, cap = 37256480 + 1024;
  const pData = ex.alloc(cap * width), pIdx = ex.alloc(4096 * 64 * 8);
  if (!pData || !pIdx) { postMessage({ error: "wasm out of memory" }); return; }
  const t1 = performance.now();
  const floats = Number(ex.build(pT, pPts, pProb, pChild, pHs, pHl, pData, cap, pIdx, f32 ? 1 : 0));
  const t2 = performance.now();
  const data = f32 ? new Float32Array(ex.memory.buffer, pData, floats) : new Float64Array(ex.memory.buffer, pData, floats);
  const idx = new Int32Array(ex.memory.buffer, pIdx, 4096 * 64 * 2);
  const key = 4095 * 64, off = idx[key * 2], len = idx[key * 2 + 1];
  let mean = 0; for (let g = 0; g < len; g++) mean += g * data[off + g];
  postMessage({ floats, instantiateMs: t1 - t0, buildMs: t2 - t1, wasmMemoryMB: ex.memory.buffer.byteLength / 2 ** 20, initialMean: mean });
};`;
(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await browser.newContext(mode === "mobile" ? { ...devices["Pixel 7"] } : {});
  const page = await ctx.newPage();
  if (mode === "mobile") { const cdp = await ctx.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  await page.setContent("<html><body>wasm</body></html>");
  const res = await page.evaluate(async ({ workerSrc, wasmB64, TB64, kernel, f32 }) => {
    const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
    const w = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" })));
    let maxGap = 0, frames = 0, last = performance.now(), running = true;
    const tick = (t) => { maxGap = Math.max(maxGap, t - last); last = t; frames++; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    const out = await new Promise((r) => { w.onmessage = (e) => r(e.data); w.postMessage({ wasm: b64(wasmB64), T: b64(TB64), kernel, f32 }); });
    running = false;
    const total = performance.now() - t0;
    return { ...out, totalMs: total, mainThreadMaxFrameGapMs: maxGap, mainThreadFrames: frames, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGB: navigator.deviceMemory ?? null };
  }, { workerSrc, wasmB64: wasm.toString("base64"), TB64: T.toString("base64"), kernel, f32: prec === "f32" });
  console.log(JSON.stringify({ mode, wasm: wasmName, precision: prec, ...res }));
  await browser.close();
})();
