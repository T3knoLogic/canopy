import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@bonsai-os-sdk": path.resolve(
        __dirname,
        "../../shared/bonsai-os-sdk/index.ts",
      ),
      "@bonsai-theme": path.resolve(
        __dirname,
        "../../shared/bonsai-theme/index.ts",
      ),
      process: "process/browser",
      buffer: "buffer",
    },
  },
  define: {
    global: "globalThis",
    "process.env": {},
  },
  optimizeDeps: {
    include: ["buffer", "process"],
  },
  server: {
    port: 5188,
    host: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("ic-nft-aggregator")) return "nft-agg";
          if (id.includes("@dfinity/")) return "dfinity";
        },
      },
    },
  },
});
