import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

/**
 * Runs the online Worker under `wrangler dev --local` (workerd + Miniflare, persisted SQLite) for tests.
 * Purely local: no Cloudflare account, no remote dev session, no deploy.
 */
export type LocalWorker = { url: string; port: number; persistDir: string; stop(): Promise<void>; restart(): Promise<void> };

const ROOT = resolve(import.meta.dirname, "../..");
const WRANGLER = join(ROOT, "node_modules/.bin/wrangler");

export async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => res(port));
    });
    srv.on("error", rej);
  });
}

export async function startLocalWorker(vars: Record<string, string> = {}, options: { persistDir?: string; port?: number } = {}): Promise<LocalWorker> {
  let port = options.port ?? (await freePort());
  const persistDir = options.persistDir ?? (await mkdtemp(join(tmpdir(), "yachtlab-worker-")));
  let url = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let output = "";
  // `freePort` releases the port before wrangler binds it, so a test file starting in parallel can
  // take the same number. The instance marker makes sure the health check reached THIS process, and
  // a lost race is retried on a new port.
  const instance = "i" + Math.random().toString(36).slice(2);

  const launchOnce = async () => {
    const args = ["dev", "--config", join(ROOT, "worker/wrangler.toml"), "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persistDir, "--show-interactive-dev-session=false", "--log-level", "warn"];
    // Production wrangler.toml only allows the Pages origin; local tests use the preview origin.
    const all = { ALLOWED_ORIGINS: "http://127.0.0.1:5173,http://localhost:5173", MAX_ROOMS: "200", ...vars, TEST_INSTANCE: instance };
    for (const [k, v] of Object.entries(all)) args.push("--var", `${k}:${v}`);
    child = spawn(WRANGLER, args, {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CLOUDFLARE_API_TOKEN: "", CI: "1", NO_COLOR: "1" },
    });
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error("wrangler dev exited:\n" + output);
      try {
        const res = await fetch(url + "/healthz");
        if (res.ok && ((await res.json()) as { instance?: string }).instance === instance) return;
      } catch {
        /* not ready */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("wrangler dev did not start:\n" + output);
  };
  const launch = async () => {
    for (let attempt = 0; ; attempt++) {
      output = "";
      try {
        return await launchOnce();
      } catch (error) {
        const taken = /Address already in use/.test(output);
        if (!taken || options.port !== undefined || attempt >= 4) throw error;
        await stop();
        port = await freePort();
        url = `http://127.0.0.1:${port}`;
      }
    }
  };

  const stop = async () => {
    const c = child as ChildProcess | null;
    if (!c || c.exitCode !== null) return;
    const exited = new Promise((r) => c.once("exit", r));
    try {
      process.kill(-c.pid!, "SIGTERM");
    } catch {
      /* gone */
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (c.exitCode === null)
      try {
        process.kill(-c.pid!, "SIGKILL");
      } catch {
        /* gone */
      }
    child = null;
  };

  await launch();
  return {
    get url() {
      return url;
    },
    get port() {
      return port;
    },
    persistDir,
    stop,
    async restart() {
      await stop();
      await launch();
    },
  };
}
