# OctaneJS — adoption research

**Date:** 2026-08-13
**Subject:** OctaneJS — https://octanejs.dev/ · https://github.com/octanejs/octane
**Verdict: DECLINE for this codebase. WATCH the project.**

Not because it's bad — it is one of the more credible new frameworks of the last year. Because
it is a **React replacement** offered to a 341,000-line React app that does not have the problem
it solves, and because two of our load-bearing dependencies have no port.

---

## 1. What it is

Octane is a compiler-first UI framework by **Dominic Gannaway** (creator of Inferno, ex-React core,
ex-Svelte core, Lexical), positioned as "the successor to Inferno." Tagline, verbatim: **"React's
programming model, compiled."** You write function components with the React API you already know —
hooks, context, portals, Suspense, `memo` — and an AOT compiler turns them into template clones and
direct DOM writes, eliminating the virtual DOM and the diff. The compiler infers dependency arrays
from closure analysis (you may omit them from `useEffect`/`useMemo`/`useCallback`), and tracks hooks
by **compiler-assigned call-site slot rather than call order** — so a hook may legally sit behind an
`if` or after an early return. It ships a monorepo of 130+ packages: runtime, compiler, CLI, an MCP
server, build-tool plugins (Vite/Rspack/Rsbuild), streaming SSR with byte-stable hydration, an
optional `.tsrx` template dialect with `@if`/`@for`/`@switch`/`@try` directives that unlocks further
optimization, a Lynx target for native iOS/Android, and ~80 first-party `@octanejs/*` bindings that
replace the React-facing layer of popular libraries. License is **MIT**.

## 2. Maturity — the decisive section

| Signal | Value | Source |
|---|---|---|
| Repo created | **2026-06-22** (52 days ago) | GitHub API `created_at` |
| Latest version | **0.1.36** | npm registry `dist-tags` |
| Releases since launch | 36 in ~7 weeks | npm version list |
| Self-declared status | **"Octane is in alpha. The runtime, compiler, and SSR/hydration paths all work, but APIs still move."** | README, verbatim |
| Stars / forks | 1,226 / 45 | GitHub API |
| **Watchers** | **2** | GitHub API `subscribers_count` |
| Open issues / PRs | 23 / 18 | GitHub |
| npm maintainers | trueadm, leonidaz_npm, webeferen | npm registry |
| Tests | 3,900+ behavioral (11,500+ executions) | README / site |

Two of those numbers matter more than the rest. **1,226 stars against 2 watchers** is the signature
of a launch-week hype curve, not a user base — stars are cheap, watching is what people who depend on
something do. And **52 days old at v0.1.36** means the API is moving roughly every 36 hours. The
project says so itself and recommends pinning.

Minor supply-chain footgun: the `octane` npm name carries **legacy 1.0.0–1.0.3 versions from an
unrelated older package**, while the current line is 0.1.x. The `latest` dist-tag correctly points at
0.1.36, but any tooling that resolves by highest semver — or a careless `octane@^1` — lands on a
different project entirely.

## 3. What it would replace here

Octane is not additive. It replaces **React and ReactDOM outright** and, transitively, the
React-facing layer of nearly every UI dependency we have. This is the whole cost:

| Our dependency | Files using it | Octane story |
|---|---|---|
| `react` / `react-dom` 19 | 2,104 `.tsx` (341,011 LOC) | replaced by `octane` |
| `lucide-react` | **1,472** | `@octanejs/lucide` — import rewrite |
| `framer-motion` | 222 | `@octanejs/motion` |
| `zustand` 5 | 86 | `@octanejs/zustand` |
| `@sentry/react` | **26** | **no binding** |
| `@xyflow/react` (React Flow) | **12** | **no binding** |
| `recharts` | 7 | `@octanejs/recharts` |
| `@react-three/fiber` + `drei` | 2 | `@octanejs/three` — self-described **"experimental"** |
| `@dnd-kit/core` | — | `@octanejs/dnd-kit` |
| `@tanstack/react-virtual` | — | `@octanejs/tanstack-virtual` |
| `@testing-library/react` | 401 test files | `@octanejs/testing-library` |
| `@vitejs/plugin-react` | build | `@octanejs/vite-plugin` |
| `@tauri-apps/*`, `@xterm/*`, `dompurify`, `immer`, `zod`, `highlight.js` | — | plain JS — unaffected |

Toolchain compatibility is genuinely fine: `@octanejs/vite-plugin` peers on `vite ^8.0.16` and we
have **8.0.16** installed; it needs Node `>=22.22.2` and we run **v24.12.0**. There is even a
first-party **`@octanejs/tauri`** package with `useInvoke`/`useInvokeState`/`useTauriEvent` hooks for
**Tauri v2**, explicitly zero-config inside Tauri webviews, with a mock bridge for testing. Nothing
about Octane is hostile to a desktop Tauri app, and nothing about it requires a network service —
it clears our local-first bar cleanly. The problem is not compatibility. It is everything below.

**`@xyflow/react` has no binding, and that is the blocker.** It powers `PersonasPage`, the teams
canvas (`sub_canvas`), and the research-lab graph — 12 files, 3 `<ReactFlow>` mount points, 2
`ReactFlowProvider`s, plus custom node/edge components using `Handle`, `Position`, `BaseEdge`,
`getSmoothStepPath`, `useViewport`. Our 12 files are a contained surface; React Flow itself is not.
It is among the most React-coupled libraries in the ecosystem — internal zustand store, context,
measurement refs, custom hook graph. Porting it is a project, not a task, and it would be **ours**
to maintain. `@sentry/react` (26 files) is the softer of the two: most of our calls are
`addBreadcrumb`/`captureException`, which live in the framework-agnostic `@sentry/browser`; only the
React `ErrorBoundary` and profiler would need reimplementing, and Octane ships
`@octanejs/react-error-boundary`.

**Side finding, unrelated to Octane:** `@floating-ui/react` is in `package.json` with **0 importers**
in `src/`. Dead dependency — a `knip` candidate worth removing regardless of this decision.

## 4. Migration cost, realistically

Three tiers, roughly ascending in nastiness.

**Mechanical (codemod-able, low risk).** ~1,800 import-specifier rewrites across `lucide-react`,
`framer-motion`, `zustand`, `recharts`, `dnd-kit`, `tanstack-virtual`, `testing-library`. Swap
`@vitejs/plugin-react` for `@octanejs/vite-plugin`. 15 files using `forwardRef` (refs become ordinary
props), 2 using `createRef`, 2 using `React.Children`. 5 class components — our error boundaries —
rewritten as function-based. We use **zero** `useTransition`/`startTransition`, so Octane's
microtask-batching-instead-of-lanes difference costs us nothing. A week of careful codemod work.

**Silent and per-site (the real cost).** We have **1,615 `onChange` occurrences across 503 `.tsx`
files.** Octane uses native, delegated DOM events instead of React's synthetic layer, and its docs
direct you to use `onInput` for text edits. React's `onChange` on a text input is a lie — it is
really an `input` event, firing per keystroke. Under native semantics, `change` on a text input fires
on **blur/commit**. So every controlled text input we own would still compile, still typecheck, still
attach a handler — and silently stop updating state per keystroke. No error, no warning, 503 files to
audit by hand because nothing distinguishes an `onChange` on a `<select>` (fine) from one on an
`<input type="text">` (broken) without reading the JSX. This is the worst shape a migration bug
takes: invisible to every gate we own.

**Doctrinal (the part that hurts most).** Our conventions are written in React idiom and would need
re-derivation: **21 custom ESLint rules** that parse JSX/hook ASTs, the **115-primitive shared
component catalog** and its generator, and the **18 golden paths** in `docs/concepts/golden-paths/`
we *just* finished. `eslint-plugin-react-hooks` becomes actively hostile — Octane legalizes exactly
what that plugin exists to forbid (conditional hooks, omitted dependency arrays), so it would flag
correct Octane code as errors across the whole tree. Then 401 test files and 2,400+ tests get
re-verified against a different renderer. Plus 14 locales riding on `@octanejs/i18next` rather than
our current wiring.

Honest total: **a multi-month, whole-frontend program with a silent-breakage class in the middle of
it**, executed against a framework whose API is documented as still moving.

## 5. Risk

- **Maturity — severe.** Alpha, 52 days old, 0.1.36, APIs explicitly unstable. We would be pinning
  and manually reviewing every bump for the foreseeable future.
- **Maintenance / bus factor — severe.** Effectively one principal author. Gannaway is a genuinely
  strong bet on ability, but Inferno — his own prior framework, and Octane's stated predecessor — is
  the cautionary case for what happens to a one-maintainer framework over a decade.
- **Lock-in — severe, and the subtlest risk.** The bindings are the trap. Each one **forks a
  library's React-facing layer**. Today we depend on React (Meta-backed, enormous) plus upstream
  libraries directly. After migration we depend on ~10 forks maintained by a two-month-old project,
  and every Radix/motion/recharts/TanStack upgrade queues behind `@octanejs`. We would be trading one
  large, well-funded dependency for ten small, unfunded ones. Exit is not "swap a package" — it is
  the same multi-month program run backwards.
- **License — clear.** MIT throughout. No concern.
- **Bundle — a real but small win.** Their published figures: 18–28 kB gzip vs React's 60–67 kB
  across three fixture apps. ~40 kB gzip saved on a desktop installer that ships an ONNX runtime and
  a Rust binary is a rounding error, though it is a genuine win for tier-specific web bundles.
- **Tauri/desktop — no concern, and mildly positive.** First-party Tauri v2 hooks, zero-config in
  webviews, offline by construction, no runtime network service. Octane passes our hard constraint.
- **Performance — the value we would be buying, and we don't need it.** Their benchmarks are
  impressive and fairly run (React measured *with* the official React Compiler): 3.3–4.1× on
  js-framework/TodoMVC, 3.6× on chat streaming, 11× on a 10-level async waterfall. But we
  **already ran a performance pass** and found no render-bound problem: the ExecutionList
  virtualization and CompanionPanel `useShallow` leads were false positives, and the ~660 MB memory
  scare was dev-mode HMR. Buying a 4× renderer to fix a bottleneck we measured and did not find is
  the definition of paying for the wrong thing.

## 6. On our "primitives nobody adopts" problem

Worth being precise, because Octane fails this test in an unexpected direction. Our known failure
mode is *adding surface nobody uses* — `usePolling` at 18% adoption, `FormField` at 4 adopters.
Octane would not add an unused primitive. It would do something worse: **invalidate the primitives we
already have.** All 115 catalog components, the 18 golden paths, and the 21 ESLint rules are written
in React idiom and would need re-derivation in Octane's. We would spend a multi-month migration
rewriting the exact library whose adoption we are currently struggling to drive, resetting its
adoption to zero on the day it lands.

## 7. Verdict

**Decline.** Octane is real engineering by a credible author and clears every constraint we set as a
hard filter — MIT, offline, smaller bundle, first-party Tauri v2 support. It fails on the two
questions that actually decide it: *is it clearly better than what we have* (it is faster, but we
have no measured performance problem, so the improvement is unrealized), and *is it worth the
migration* (a multi-month whole-frontend program, with 503 files of silent `onChange` breakage and no
port for our flow canvas, against a 52-day-old alpha that ships an API change every 36 hours).

**Not even a bounded trial.** A trial normally de-risks a decision, but there is no bounded place to
put this one. Octane replaces the renderer at the root — you cannot run it in one feature folder
beside React. `OctaneCompat` exists for gradual migration, but exercising it *is* the migration, and
a trial that cannot be cheaply reverted is not a trial. The one genuinely cheap experiment, if
curiosity strikes, is a throwaway `pnpm create octane` scratch app outside this repo — zero coupling,
an afternoon, and it answers the ergonomics question without touching `master`.

**Watch, with concrete re-entry triggers.** Revisit only when *all four* hold:

1. **1.0 shipped, plus ~12 months of API stability** behind it.
2. **An `@xyflow/react` binding exists** — or we have independently moved off React Flow.
3. **A second maintainer or organizational backing**, so the bus factor is above one.
4. **A measured, reproducible render-performance problem** in this app that we have genuinely failed
   to solve in React.

Trigger 4 is the one that matters. Without it, the other three only make Octane safer to adopt — not
worth adopting. Set a reminder for **mid-2027**; nothing about this decision needs revisiting sooner.

---

### Sources

- https://octanejs.dev/ · `/llms.txt` · `/docs/quick-start` · `/docs/differences-from-react` ·
  `/docs/bindings` · `/benchmarks`
- https://github.com/octanejs/octane (README, `packages/`, `packages/three`, `packages/tauri`,
  `packages/vite-plugin-octane/package.json`)
- `https://api.github.com/repos/octanejs/octane` · `https://registry.npmjs.org/octane`
- Local measurements taken 2026-08-13 against `master` (file counts, import counts, installed
  versions).
