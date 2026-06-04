import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@openagentgraph/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  build: {
    // The 3D graph stack is isolated into lazy graph-view chunks; this explicit
    // budget accepts that vendor payload while keeping build output readable.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("react-force-graph-3d") ||
            id.includes("3d-force-graph") ||
            id.includes("three-forcegraph") ||
            id.includes("force-graph")
          ) {
            return "graph-vendor";
          }

          if (id.includes(`${"/node_modules/three/"}`) || id.includes("\\node_modules\\three\\")) {
            return "three-vendor";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
      },
    },
  },
});
