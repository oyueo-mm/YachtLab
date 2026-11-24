import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";

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

export default defineConfig({
  base: "/YachtLab/",
  plugins: [react(), tailwindcss(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  worker: { format: "es" },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60000 },
} as Parameters<typeof defineConfig>[0]);
