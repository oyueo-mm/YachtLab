import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import dpManifest from "./src/dp-manifest.json";

/**
 * Build id: the commit (or the build time). The page compares its own id with `version.json`
 * (fetched without cache) so a browser holding an old cached page is told to reload — an old bundle
 * was the most likely reason players did not see the Phase 3 chat / spectate buttons.
 */
const BUILD_ID = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() + "-" + Date.now().toString(36);
  } catch {
    return "b-" + Date.now().toString(36);
  }
})();
const versionFile = (): Plugin => ({
  name: "yachtlab-version",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
  },
});

const offlineFiles = (): Plugin => ({
  name: "yachtlab-offline-files",
  apply: "build",
  enforce: "post",
  generateBundle: {
    order: "post",
    handler(_options, bundle) {
      const assets = Object.keys(bundle).filter((file) => /^assets\/(?:(?:index|worker|product-worker|review-worker|ReviewPage|stage|table)-.*\.(?:js|css)|pmf-.*\.wasm)$/.test(file));
      assets.push(`ai/${dpManifest.asset}`);
      const source = readFileSync(new URL("./src/pwa-worker.js", import.meta.url), "utf8");
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `const BUILD = ${JSON.stringify(BUILD_ID)};\nconst ASSETS = ${JSON.stringify(assets)};\n${source}`,
      });
    },
  },
});

export default defineConfig({
  base: "/YachtLab/",
  plugins: [react(), tailwindcss(), versionFile(), offlineFiles()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  worker: { format: "es" },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60000 },
} as Parameters<typeof defineConfig>[0]);
