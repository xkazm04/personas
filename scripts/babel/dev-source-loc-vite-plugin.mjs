import injectSourceLoc from "./inject-source-loc.mjs";

/**
 * Dev-only Vite plugin that stamps host JSX elements with
 * `data-loc="src/.../File.tsx:LINE:COL"` so the in-app DevInspector
 * (press `;` then `i`) can map a clicked DOM node back to its source.
 *
 * Why a standalone plugin (not `react({ babel })`): under rolldown-vite the
 * `@vitejs/plugin-react` build transforms JSX with **oxc** and runs no general
 * Babel pass, so its `babel.plugins` option is silently ignored. We instead run
 * our own minimal Babel pass with `enforce: 'pre'` so it executes BEFORE oxc
 * lowers JSX (host elements still exist as JSXOpeningElements to stamp).
 *
 * Cost-aware: Babel-per-file is slower than oxc, and this repo is dev-speed
 * sensitive, so injection is OPT-IN. It runs only on the dev server AND only
 * when `PERSONAS_INSPECTOR=1` (set by `npm run dev:inspect` / the inspect Tauri
 * variants). A normal `npm run dev` pays nothing; the overlay still toggles but
 * tells you to relaunch in inspect mode.
 */
export function devSourceLocPlugin() {
  let enabled = false;
  /** @type {typeof import('@babel/core') | undefined} */
  let babel;

  return {
    name: "dev-source-loc",
    enforce: "pre",
    apply: "serve", // never participates in a production / tauri build
    async configResolved(config) {
      enabled =
        config.command === "serve" && process.env.PERSONAS_INSPECTOR === "1";
      if (enabled) {
        babel = await import("@babel/core");
        config.logger.info(
          "  [dev-source-loc] DevInspector source mapping ON (press ; then i)",
        );
      }
    },
    async transform(code, id) {
      if (!enabled || !babel) return null;
      const file = id.split("?")[0];
      if (!/\.[jt]sx$/.test(file)) return null;
      if (file.includes("/node_modules/")) return null;

      const result = await babel.transformAsync(code, {
        filename: file,
        configFile: false,
        babelrc: false,
        sourceMaps: true,
        // Parse-only flags (not npm packages) so Babel reads TS+JSX but our
        // plugin is the ONLY transform — JSX/types are left for oxc to lower.
        parserOpts: { plugins: ["jsx", "typescript"] },
        plugins: [injectSourceLoc],
      });

      if (!result || result.code == null) return null;
      return { code: result.code, map: result.map ?? null };
    },
  };
}
