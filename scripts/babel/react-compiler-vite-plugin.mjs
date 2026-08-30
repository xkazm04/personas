/**
 * Build-only, flag-gated Vite plugin running `babel-plugin-react-compiler`
 * over `.tsx`/`.jsx`/`.ts` sources. Dark-launch experiment per ADR
 * "react-compiler-build-only" — read that ADR before changing this file's
 * gating or defaults.
 *
 * WHY STANDALONE (not `react({ babel })`): under rolldown-vite,
 * `@vitejs/plugin-react`'s JSX transform runs through **oxc**, not Babel — its
 * `babel` option is a SILENT NO-OP (no error, no warning, the pass simply
 * never runs). This repo already hit and solved that exact trap for
 * `dev-source-loc-vite-plugin.mjs` (DevInspector's `data-loc` stamping): the
 * fix there, mirrored here, is a standalone Vite plugin that runs its own
 * minimal `@babel/core` transform with `enforce: 'pre'` so it executes BEFORE
 * oxc lowers JSX — React Compiler needs to see real JSX/hook call shapes, not
 * already-lowered `jsx()` calls.
 *
 * WHY BUILD-ONLY (`apply: 'build'`, never `'serve'`): this repo is
 * measurably dev-speed sensitive (see the `tauri:dev:lite` vs full guidance
 * in `.claude/CLAUDE.md`). A per-file Babel pass on every dev-server
 * transform would tax the edit-save-see-it loop for ~4,800 source files,
 * for a compiler whose payoff (fewer manual `useMemo`/`useCallback`/`memo`)
 * is a *build-output* property, not a dev-loop one. Compiled output is only
 * ever exercised via a production-shaped `vite build`.
 *
 * WHY FLAG-GATED (`PERSONAS_REACT_COMPILER=1`, default OFF): the compiler's
 * effect on this codebase is UNMEASURED. The repo carries 1,356 `useMemo` +
 * 2,114 `useCallback` + 98 `memo()` sites authored under the assumption that
 * memoization is manual — none of them are removed by this change, and the
 * compiler's own memoization runs alongside them rather than replacing them
 * until each site is deliberately migrated. Flag-gating means the default
 * `npm run build` / `npm run tauri:build*` output is BYTE-IDENTICAL to
 * today: with the flag unset (or not `'1'`), this plugin returns an inert
 * object with no `transform` hook and touches no file.
 *
 * MEASUREMENT PROTOCOL TO GRADUATE OFF THE FLAG (do this before ever
 * flipping the default to on):
 *   1. Build twice — once with the flag unset, once with
 *      `PERSONAS_REACT_COMPILER=1` — and diff `dist/assets/*.js` sizes
 *      (compiled output adds small `useMemoCache`-style helpers per
 *      compiled function; a large regression means widespread bail-outs
 *      are still shipping dead code paths worth investigating).
 *   2. Run the existing `<Profiler id="app-root">` instrumentation
 *      (`src/App.tsx`, feeds `window.__PERF__.recordRender`) against both
 *      builds under the `perf-nav-walk` harness
 *      (`tests/playwright/perf-nav-walk.spec.ts`,
 *      `scripts/perf/render-perf-report.mjs` — see prior runs under
 *      `docs/harness/perf-runs/`) to get a real render-cost comparison,
 *      not a guess from bundle size alone.
 *   3. Only after both show a measured win (smaller/neutral bundle AND
 *      equal-or-better render times, with no functional regressions from
 *      `npm run test -- --run` + the golden-path census) should the default
 *      move from opt-in to opt-out, and only as its own reviewed change.
 *
 * @returns {import('vite').Plugin}
 */
export function reactCompilerPlugin() {
  const enabled = process.env.PERSONAS_REACT_COMPILER === "1";

  if (!enabled) {
    // Inert by default -- no transform hook at all, so this plugin costs
    // nothing (not even a per-file id check) in every build that doesn't
    // opt in.
    return { name: "react-compiler-experiment" };
  }

  /** @type {typeof import('@babel/core') | undefined} */
  let babel;

  return {
    name: "react-compiler-experiment",
    enforce: "pre",
    apply: "build", // never runs on `vite dev` / `tauri dev` -- build-only
    async configResolved(config) {
      babel = await import("@babel/core");
      config.logger.info(
        "  [react-compiler] EXPERIMENTAL compiler pass ON (PERSONAS_REACT_COMPILER=1) -- build-only, unmeasured, see ADR react-compiler-build-only",
      );
    },
    async transform(code, id) {
      if (!babel) return null;
      const file = id.split("?")[0];
      if (!/\.[jt]sx?$/.test(file)) return null;
      if (file.includes("/node_modules/") || file.includes("\\node_modules\\")) return null;
      // Skip test/harness code -- the compiler targets shipped component
      // code, and running it over test fixtures/mocks only adds bail-out
      // noise with no build-output benefit.
      if (/[\\/](__tests__|__mocks__|\.test\.|\.spec\.)/.test(file)) return null;

      const result = await babel.transformAsync(code, {
        filename: file,
        configFile: false,
        babelrc: false,
        sourceMaps: true,
        // Parse-only flags (not npm packages) so Babel reads TS+JSX. Our
        // plugin is the ONLY transform here -- JSX/types are still lowered
        // by oxc afterward, same division of labor as dev-source-loc.
        parserOpts: { plugins: ["jsx", "typescript"] },
        plugins: [
          [
            "babel-plugin-react-compiler",
            {
              // React 19+ ships the compiler's helper runtime at
              // `react/compiler-runtime` internally, so compiled output can
              // target it directly without adding `react-compiler-runtime`
              // as a separate dependency.
              target: "19",
            },
          ],
        ],
      });

      if (!result || result.code == null) return null;
      return { code: result.code, map: result.map ?? null };
    },
  };
}
