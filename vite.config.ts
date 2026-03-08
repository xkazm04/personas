import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFile } from "fs/promises";
import {
  needsTransform,
  transformForWebView2,
} from "./scripts/webview2-compat";

const host = process.env.TAURI_DEV_HOST;

// WebView2 compatibility uses TWO layers:
// 1. Runtime shim (public/webview2-compat.js) — converts Object.prototype
//    properties to getter/setters. Handles ALL patterns if properties are
//    configurable.
// 2. esbuild source transform (below) — rewrites simple assignments during
//    dep pre-bundling as a fallback for non-configurable properties.
// NO Vite transform plugin — it double-processes pre-bundled deps and breaks
// comma expressions in minified code.

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  esbuild: {
    // Strip verbose console calls in production; keep console.warn/error for Sentry
    drop: process.env.NODE_ENV === "production" ? ["debugger"] : [],
    pure: process.env.NODE_ENV === "production"
      ? ["console.log", "console.debug", "console.info"]
      : [],
  },

  build: {
    sourcemap: "hidden",
    chunkSizeWarningLimit: 5500,
    // Strip console.log and console.debug from production builds
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "zustand"],
          "ui-vendor": ["framer-motion", "lucide-react"],
          "tauri-vendor": ["@tauri-apps/api/core", "@tauri-apps/api/event"],
          "d3-vendor": ["d3-color", "d3-interpolate", "d3-scale", "d3-shape", "d3-array", "d3-format", "d3-time", "d3-time-format", "d3-path", "d3-drag", "d3-selection", "d3-zoom", "d3-ease", "d3-timer", "d3-dispatch", "d3-transition"],
          "chart-vendor": ["recharts"],
          "flow-vendor": ["@xyflow/react", "@xyflow/system"],
          "hljs-vendor": ["highlight.js", "rehype-highlight", "lowlight"],
        },
      },
    },
  },

  optimizeDeps: {
    include: [
      "recharts",
      "d3-color",
      "d3-interpolate",
      "d3-scale",
      "d3-shape",
      "d3-array",
      "d3-format",
      "d3-time",
      "d3-time-format",
      "d3-path",
      "d3-ease",
      "d3-timer",
      "d3-selection",
      "d3-transition",
      "d3-dispatch",
      "d3-drag",
      "d3-zoom",
    ],
    esbuildOptions: {
      plugins: [
        {
          name: "webview2-compat",
          setup(build) {
            build.onLoad({ filter: /\.(js|mjs|cjs)$/ }, async (args) => {
              if (!args.path.includes("node_modules")) return;
              const code = await readFile(args.path, "utf8");
              if (!needsTransform(code)) return;
              const transformed = transformForWebView2(code);
              if (transformed === code) return;
              return { contents: transformed, loader: "js" };
            });
          },
        },
      ],
    },
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Prevent vite from obscuring Rust errors
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
