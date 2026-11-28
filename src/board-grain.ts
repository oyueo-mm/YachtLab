/**
 * Board material grain (FX-1). Procedural noise tiles (SVG feTurbulence) are drawn ONCE into small PNG
 * bitmaps and handed to CSS as `--grain-*` custom properties on :root. Using the SVG directly as a CSS
 * background was measured to be expensive: an SVG with a filter is re-rasterised whenever the tray
 * repaints (phone emulation: lava synergy 23 → 42 ms per frame, first paint +280 ms). Until the bitmaps
 * are ready (one idle task after start-up) the boards show their plain Lv.1 surface; nothing else waits.
 */
type Grain = { w: number; h: number; type: "fractalNoise" | "turbulence"; freq: string; oct: number; seed: number; rgb: [number, number, number]; a: [number, number] };
export const GRAINS: Record<string, Grain> = {
  "felt-light": { w: 180, h: 180, type: "fractalNoise", freq: ".9", oct: 2, seed: 3, rgb: [1, 1, 1], a: [0.55, -0.22] },
  "felt-dark": { w: 180, h: 180, type: "fractalNoise", freq: ".75", oct: 2, seed: 9, rgb: [0, 0, 0], a: [-0.9, 0.45] },
  "wood-dark": { w: 520, h: 140, type: "fractalNoise", freq: ".006 .19", oct: 3, seed: 5, rgb: [0.12, 0.06, 0.02], a: [1.7, -0.62] },
  "wood-light": { w: 520, h: 140, type: "fractalNoise", freq: ".004 .32", oct: 2, seed: 11, rgb: [1, 0.85, 0.65], a: [1.1, -0.62] },
  leather: { w: 200, h: 200, type: "turbulence", freq: ".55", oct: 2, seed: 4, rgb: [0, 0, 0], a: [-1.6, 0.62] },
  "leather-hi": { w: 200, h: 200, type: "fractalNoise", freq: ".35", oct: 2, seed: 7, rgb: [1, 1, 1], a: [0.5, -0.24] },
  "marble-vein": { w: 420, h: 420, type: "turbulence", freq: ".0065 .011", oct: 5, seed: 2, rgb: [1, 1, 1], a: [-5.2, 1.05] },
  "marble-cloud": { w: 420, h: 420, type: "fractalNoise", freq: ".004", oct: 3, seed: 8, rgb: [0, 0, 0], a: [0.7, -0.2] },
  "metal-brush": { w: 400, h: 200, type: "fractalNoise", freq: ".0015 .9", oct: 2, seed: 6, rgb: [1, 0.95, 0.85], a: [0.9, -0.36] },
  "metal-brush-dark": { w: 400, h: 200, type: "fractalNoise", freq: ".002 .7", oct: 2, seed: 12, rgb: [0, 0, 0], a: [-0.9, 0.42] },
  "ice-frost": { w: 300, h: 300, type: "fractalNoise", freq: ".018", oct: 4, seed: 5, rgb: [0.85, 0.97, 1], a: [0.75, -0.28] },
  "ice-crack": { w: 360, h: 360, type: "turbulence", freq: ".012", oct: 4, seed: 13, rgb: [0.9, 1, 1], a: [-9, 0.92] },
  "lava-crack": { w: 380, h: 380, type: "turbulence", freq: ".011 .016", oct: 4, seed: 21, rgb: [1, 0.42, 0.1], a: [-8, 1] },
  sand: { w: 160, h: 160, type: "fractalNoise", freq: ".95", oct: 2, seed: 17, rgb: [1, 0.9, 0.7], a: [0.6, -0.26] },
};
export function grainSvg(g: Grain) {
  const [r, gg, b] = g.rgb;
  const m = `0 0 0 0 ${r} 0 0 0 0 ${gg} 0 0 0 0 ${b} ${g.a[0]} 0 0 0 ${g.a[1]}`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${g.w}' height='${g.h}'><filter id='n' x='0' y='0'><feTurbulence type='${g.type}' baseFrequency='${g.freq}' numOctaves='${g.oct}' seed='${g.seed}' stitchTiles='stitch'/><feColorMatrix values='${m}'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;
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
