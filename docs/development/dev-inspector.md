# DevInspector — click a component, copy its source path

A dev-only overlay for grabbing a component's `src/.../File.tsx:line` and pasting
it straight into the Claude Code CLI. Off by default; never present in production.

## Use it

```bash
npm run tauri:dev:inspect     # full app (lite features) with source mapping on
# or, frontend-only / faster iteration:
npm run dev:inspect
```

Then in the app:

- **`;` then `i`** — arm/disarm the inspector. `;` enters the keyboard "special
  mode" (nav mode); pressing `i` (Inspect) takes over and the cursor becomes a
  crosshair. (`i` is a free key in nav mode — `S/C/R/M/N/G` drive the title-bar
  dock.)
- **Hover** — highlights the element; a HUD (bottom-left) shows the source chain.
- **Click** — copies the **call site** (the feature/page file that used the
  component), i.e. the first path that isn't under `src/features/shared/` or
  `src/lib/`.
- **Alt+click** — copies the **innermost** element (often a shared component's
  own internal node, e.g. `Button.tsx`).
- **Click a HUD row** — copies that specific enclosing file.
- **Esc** — exit.

Copied format is `src/features/.../File.tsx:LINE` — clickable in the CLI.

If you arm it in a plain `npm run dev` session the HUD says "Source mapping is
OFF" — relaunch with one of the inspect scripts.

## How it works

React 19 removed the Fiber `_debugSource` field (and 19.2 removed the `jsxDEV`
source args), so the old fiber-walking click-to-component tools don't work.
Instead we stamp the DOM at build time and read it at runtime:

1. **`scripts/babel/inject-source-loc.mjs`** — a Babel plugin that adds
   `data-loc="src/.../File.tsx:LINE:COL"` to every **host** JSX element
   (`<div>`, `<button>`, …). Components (`<Button>`) are skipped — an injected
   prop wouldn't reliably reach their root DOM node.
2. **`scripts/babel/dev-source-loc-vite-plugin.mjs`** — a standalone Vite plugin
   (`enforce: 'pre'`, `apply: 'serve'`) that runs that Babel pass **before** oxc
   lowers JSX. Gated on `PERSONAS_INSPECTOR=1`, so normal dev pays nothing.

   > Why standalone and not `react({ babel })`: under **rolldown-vite**, the
   > `@vitejs/plugin-react` build transforms JSX with **oxc** and runs no general
   > Babel pass, so its `babel.plugins` option is silently ignored. `@babel/core`
   > must be a declared devDependency — it isn't resolvable as a bare ESM
   > specifier under pnpm otherwise.
3. **`src/lib/dev/devLocate.ts`** — pure helpers (`buildChain`,
   `pickDefaultIndex`, …) that walk the `[data-loc]` ancestor chain and pick the
   call site. Unit-tested in `src/lib/dev/__tests__/devLocate.test.ts`.
4. **`src/lib/dev/DevInspector.tsx`** — the overlay. Mounted behind
   `import.meta.env.DEV` (lazy) in `src/App.tsx`, so it's absent from prod.

## Tuning what counts as "call site"

Edit `LIBRARY_PREFIXES` in `src/lib/dev/devLocate.ts` to change which folders are
treated as reusable internals (skipped by the default copy, reachable via
Alt+click).
