import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFile } from "fs/promises";
import { execSync } from "child_process";
import { visualizer } from "rollup-plugin-visualizer";
import {
  needsTransform,
  transformForWebView2,
} from "./scripts/webview2-compat";

const host = process.env.TAURI_DEV_HOST;
const isMobile = !!process.env.TAURI_ANDROID || !!process.env.TAURI_IOS;
const platform = process.env.TAURI_ANDROID
  ? "android"
  : process.env.TAURI_IOS
    ? "ios"
    : "desktop";

// WebView2 compatibility uses TWO layers:
// 1. Runtime shim (public/webview2-compat.js) -- converts Object.prototype
//    properties to getter/setters. Handles ALL patterns if properties are
//    configurable.
// 2. esbuild source transform (below) -- rewrites simple assignments during
//    dep pre-bundling as a fallback for non-configurable properties.
// NO Vite transform plugin -- it double-processes pre-bundled deps and breaks
// comma expressions in minified code.

export default defineConfig(async () => ({
  // Use relative paths so assets resolve under tauri:// protocol in production
  base: "./",
  plugins: [
    // Auto-regenerate template checksums and connector seed so DB seeding
    // always works on any device after clone + build
    {
      name: "catalog-codegen",
      buildStart() {
        const cwd = path.resolve(__dirname);
        for (const script of [
          "scripts/generate-template-checksums.mjs",
          "scripts/generate-connector-seed.mjs",
        ]) {
          try {
            execSync(`node ${script}`, { cwd, stdio: "pipe" });
          } catch (e) {
            console.warn(`[catalog-codegen] Failed to run ${script}:`, e);
          }
        }
      },
    },
    react(),
    tailwindcss(),
    // Bundle analysis: run `ANALYZE=true npm run build` then open dist/bundle-report.html
    ...(process.env.ANALYZE ? [visualizer({
      filename: "dist/bundle-report.html",
      gzipSize: true,
      template: "treemap",
    })] : []),
    // Remove crossorigin attribute and type="module" from built HTML.
    // Android WebView's shouldInterceptRequest has issues with ES module
    // loading via custom protocols -- IIFE format + regular script tags work.
    {
      name: "android-webview-compat",
      transformIndexHtml(html) {
        // Remove crossorigin (breaks custom protocol CORS)
        html = html.replace(/ crossorigin/g, "");
        if (isMobile) {
          // Ensure script tags don't have type="module" (IIFE output).
          // Add defer so the IIFE runs after DOM is parsed (module scripts
          // are deferred by default, but regular scripts in <head> are not).
          html = html.replace(/ type="module"/g, "");
          html = html.replace(
            /(<script )(src="\/assets\/)/g,
            '$1defer $2',
          );
        }
        return html;
      },
    },
  ],

  esbuild: {
    // Strip verbose console calls in production; keep console.warn/error for Sentry
    drop: process.env.NODE_ENV === "production" ? ["debugger"] : [],
    pure: process.env.NODE_ENV === "production"
      ? ["console.log", "console.debug", "console.info"]
      : [],
  },

  build: {
    // Target modern WebView2/WebKit — enables smaller output (no legacy polyfills)
    target: "es2022",
    sourcemap: "hidden",
    chunkSizeWarningLimit: 500,
    // Inline SVGs and small images <8KB to reduce HTTP requests in WebView
    assetsInlineLimit: 8192,
    // Disable module preload polyfill -- injects crossorigin links at runtime
    // which breaks Tauri Android WebView's custom protocol
    modulePreload: false,
    // Strip console.log and console.debug from production builds
    minify: "esbuild",
    rollupOptions: {
      output: isMobile
        ? {
            // Android WebView's shouldInterceptRequest has known issues with
            // ES module loading (strict MIME type checking fails, module requests
            // never resolve). Use IIFE format which produces regular <script> tags
            // that work reliably with Tauri's custom protocol.
            format: "iife" as const,
            inlineDynamicImports: true,
            name: "PersonasApp",
          }
        : {
            manualChunks: {
              "react-vendor": ["react", "react-dom", "zustand"],
              "ui-vendor": ["framer-motion", "lucide-react"],
              "tauri-vendor": [
                "@tauri-apps/api/core",
                "@tauri-apps/api/event",
              ],
              "d3-vendor": [
                "d3-color",
                "d3-interpolate",
                "d3-scale",
                "d3-shape",
                "d3-array",
                "d3-format",
                "d3-time",
                "d3-time-format",
                "d3-path",
                "d3-drag",
                "d3-selection",
                "d3-zoom",
                "d3-ease",
                "d3-timer",
                "d3-dispatch",
                "d3-transition",
              ],
              "chart-vendor": ["recharts"],
              "flow-vendor": ["@xyflow/react", "@xyflow/system"],
              "hljs-vendor": [
                "highlight.js",
                "rehype-highlight",
                "lowlight",
              ],
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

  define: {
    "import.meta.env.VITE_PLATFORM": JSON.stringify(platform),
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
