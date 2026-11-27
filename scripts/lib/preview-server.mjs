import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Start `vite preview` for a build directory and make sure the page really comes from it.
 * (A1.1) Spawning through `npx` left the real vite process running after `kill()`; a later run on the
 * same port then silently measured the old build. Here vite is started directly (so `stop()` ends it),
 * and a port that already answers is refused instead of reused.
 */
export async function startPreview(dist, port) {
  const base = `http://127.0.0.1:${port}/YachtLab/`;
  const probe = await fetch(base).then(() => "busy", (e) => String(e?.cause?.message ?? e));
  if (/bad port/i.test(probe)) throw new Error(`port ${port} is a blocked ("bad") port for fetch — choose another`);
  const busy = probe === "busy";
  if (busy) throw new Error(`port ${port} is already serving something — stop it first (it may be an older build)`);
  const vite = fileURLToPath(new URL("../../node_modules/vite/bin/vite.js", import.meta.url));
  const child = spawn(process.execPath, [vite, "preview", "--outDir", dist, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  const stop = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.on("exit", stop);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (stop(), process.exit(1)));
  for (let i = 0; i < 120; i++) {
    if (await fetch(base).then((r) => r.ok, () => false)) return { base, stop };
    await new Promise((r) => setTimeout(r, 250));
  }
  stop();
  throw new Error(`vite preview did not start on ${port}`);
}
