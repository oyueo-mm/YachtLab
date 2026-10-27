import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  base: "/YachtLab/",
  plugins: [react(), tailwindcss()],
  worker: { format: "es" },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60000 },
} as Parameters<typeof defineConfig>[0]);
