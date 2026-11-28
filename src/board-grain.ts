/**
 * Board material grain (FX-1). Procedural noise tiles (SVG feTurbulence) are drawn ONCE into small PNG
 * bitmaps and handed to CSS as `--grain-*` custom properties on :root. Using the SVG directly as a CSS
 * background was measured to be expensive: an SVG with a filter is re-rasterised whenever the tray
 * repaints (phone emulation: lava synergy 23 → 42 ms per frame, first paint +280 ms). Until the bitmaps
 * are ready (one idle task after start-up) the boards show their plain Lv.1 surface; nothing else waits.
 */
/**
 * `a`: alpha = a[0]·noise + a[1] (speckle / streak grains). `band`: contour mode — only a thin band of the
 * noise field around its middle value is kept, which draws the branching lines of veins and cracks.
 * Frequencies × tile size are whole numbers so the tiles repeat without a seam (stitchTiles).
 */
type Grain = { w: number; h: number; type: "fractalNoise" | "turbulence"; freq: string; oct: number; seed: number; rgb: [number, number, number]; a: [number, number]; band?: { width: number; alpha: number } };
export const GRAINS: Record<string, Grain> = {
  "felt-light": { w: 180, h: 180, type: "fractalNoise", freq: ".9", oct: 2, seed: 3, rgb: [1, 1, 1], a: [0.55, -0.22] },
  "felt-dark": { w: 180, h: 180, type: "fractalNoise", freq: ".75", oct: 2, seed: 9, rgb: [0, 0, 0], a: [-0.9, 0.45] },
  "wood-dark": { w: 520, h: 140, type: "fractalNoise", freq: `${3 / 520} ${28 / 140}`, oct: 3, seed: 5, rgb: [0.12, 0.06, 0.02], a: [1.7, -0.62] },
  "wood-light": { w: 520, h: 140, type: "fractalNoise", freq: `${2 / 520} ${45 / 140}`, oct: 2, seed: 11, rgb: [1, 0.85, 0.65], a: [1.1, -0.62] },
  leather: { w: 200, h: 200, type: "turbulence", freq: ".55", oct: 2, seed: 4, rgb: [0, 0, 0], a: [-1.3, 0.48] },
  "leather-hi": { w: 200, h: 200, type: "fractalNoise", freq: ".35", oct: 2, seed: 7, rgb: [1, 1, 1], a: [0.5, -0.24] },
  "marble-vein": { w: 420, h: 420, type: "fractalNoise", freq: `${3 / 420} ${5 / 420}`, oct: 4, seed: 2, rgb: [0.93, 0.92, 1], a: [0, 0], band: { width: 1, alpha: 0.38 } },
  "marble-cloud": { w: 420, h: 420, type: "fractalNoise", freq: ".004", oct: 3, seed: 8, rgb: [0, 0, 0], a: [0.7, -0.2] },
  "metal-brush": { w: 400, h: 200, type: "fractalNoise", freq: ".0015 .9", oct: 2, seed: 6, rgb: [1, 0.95, 0.85], a: [0.9, -0.36] },
  "metal-brush-dark": { w: 400, h: 200, type: "fractalNoise", freq: ".002 .7", oct: 2, seed: 12, rgb: [0, 0, 0], a: [-0.9, 0.42] },
  "ice-frost": { w: 300, h: 300, type: "fractalNoise", freq: `${5 / 300}`, oct: 4, seed: 5, rgb: [0.85, 0.97, 1], a: [0.6, -0.24] },
  "ice-crack": { w: 360, h: 360, type: "fractalNoise", freq: `${5 / 360}`, oct: 3, seed: 13, rgb: [0.88, 1, 1], a: [0, 0], band: { width: 1, alpha: 0.3 } },
  "lava-crack": { w: 380, h: 380, type: "fractalNoise", freq: `${4 / 380} ${6 / 380}`, oct: 4, seed: 21, rgb: [1, 0.45, 0.12], a: [0, 0], band: { width: 1, alpha: 0.5 } },
  sand: { w: 160, h: 160, type: "fractalNoise", freq: ".95", oct: 2, seed: 17, rgb: [1, 0.9, 0.7], a: [0.6, -0.26] },
};
export function grainSvg(g: Grain) {
  const [r, gg, b] = g.rgb;
  const head = `<svg xmlns='http://www.w3.org/2000/svg' width='${g.w}' height='${g.h}'><filter id='n' x='0' y='0' width='100%' height='100%' filterUnits='userSpaceOnUse' color-interpolation-filters='sRGB'><feTurbulence type='${g.type}' baseFrequency='${g.freq}' numOctaves='${g.oct}' seed='${g.seed}' stitchTiles='stitch'/>`;
  const tail = `</filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;
  if (g.band) {
    // alpha = noise, then a table that is zero except a narrow peak at the middle → thin contour lines
    const n = 23, mid = Math.floor(n / 2);
    const table = Array.from({ length: n }, (_, i) => (Math.abs(i - mid) < g.band!.width ? g.band!.alpha : Math.abs(i - mid) === g.band!.width ? g.band!.alpha * 0.35 : 0)).join(" ");
    return head + `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${gg} 0 0 0 0 ${b} 1 0 0 0 0'/><feComponentTransfer><feFuncA type='table' tableValues='${table}'/></feComponentTransfer>` + tail;
  }
  const m = `0 0 0 0 ${r} 0 0 0 0 ${gg} 0 0 0 0 ${b} ${g.a[0]} 0 0 0 ${g.a[1]}`;
  return head + `<feColorMatrix values='${m}'/>` + tail;
}

async function bake(key: string, g: Grain): Promise<void> {
  const img = new Image();
  img.src = "data:image/svg+xml," + encodeURIComponent(grainSvg(g));
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = g.w;
  canvas.height = g.h;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return;
  document.documentElement.style.setProperty("--grain-" + key, `url("${URL.createObjectURL(blob)}")`);
}

let started = false;
/** Bake every grain once, in idle time (safe to call many times). */
export function installBoardGrain() {
  if (started || typeof document === "undefined") return;
  started = true;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  const run = () => void Promise.all(Object.entries(GRAINS).map(([k, g]) => bake(k, g).catch(() => undefined)));
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 1500 });
  else window.setTimeout(run, 300);
}
