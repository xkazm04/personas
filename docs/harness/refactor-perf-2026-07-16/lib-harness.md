# lib/harness — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 1 high / 3 medium / 0 low)
> Context group: Core Libraries & State | Files read: 8 | Missing: 0

## 1. Full gate suite (including optional 3-minute `vite build`) reruns synchronously after every area iteration
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: redundant-work
- **File**: src/lib/harness/verifier.ts:144 (and orchestrator.ts:182)
- **Scenario**: Every iteration of the harness loop calls `verify(gates, ...)`, which runs ALL gates — `tsc --noEmit` (120s timeout), `npm run lint` (120s), `vite build` (180s, required:false), plus 3 grep audits — serially via blocking `execSync`. With the 35-area personas scenario plus retries, that is up to ~70+ full build/lint/typecheck cycles per run.
- **Root cause**: `verify()` maps over the whole gate list with `execSync` (blocking, sequential); there is no scoping of optional gates to what the area actually touched, and `vite build` runs even though its result is non-required and only affects the report text. The `ExecutorResult.touchedTsx/touchedCss/...` flags computed in executor.ts:237-240 exist for exactly this purpose but are never consulted.
- **Impact**: On the order of 3-6 minutes of pure verification per iteration; across a full run that is easily 1-3 hours of wall-clock spent re-verifying, most of it on a non-required build gate. `execSync` also blocks the event loop, so SIGINT pause handling and event listeners stall during gates.
- **Fix sketch**: Run required gates (tsc, lint) always; run `vite build` and the custom grep audits only when the area's `touched*` flags or scope indicate relevance, or once at the end of the run. Switch `execSync` to async `execFile`/`exec` with `Promise.all` so independent gates run in parallel and the process stays responsive to Ctrl+C.

## 2. Dead gate-factory functions duplicated verbatim as literal gate definitions
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/harness/verifier.ts:41-83
- **Scenario**: `typographyAuditGate()`, `i18nAuditGate()`, and `notificationCoverageGate()` are never called anywhere in the repo — the only reference is a re-export from `src/lib/harness/index.ts`, and that barrel itself has zero importers (run-harness.ts imports the concrete modules directly; no app code imports `lib/harness`). Meanwhile scenario-parser.ts:58-77 (`CUSTOM_GATES`) contains the exact same grep command strings copy-pasted as literals.
- **Root cause**: The factories were written to parameterize gates by scope, then the scenario hardcoded the commands instead; the barrel keeps the dead functions looking alive. `_scopeArgs` at verifier.ts:43 is even computed and discarded, showing the scope parameter was abandoned mid-implementation.
- **Impact**: Two sources of truth for the audit grep chains — the long typography exclusion list already exists in two places and will silently drift when one copy is edited. The unused barrel plus dead exports also inflate the module's apparent API surface.
- **Fix sketch**: Make `CUSTOM_GATES` in scenario-parser.ts call the three factories (passing `['src/features/']` as scope, finishing the `_scopeArgs` wiring or dropping the param), so the grep commands live only in verifier.ts. Delete `src/lib/harness/index.ts` or trim it to what is actually consumed externally (currently nothing — verify no dynamic/tooling consumers before deleting).

## 3. Entire stdout stream is JSON-parsed twice, with per-chunk parsing of partial lines
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-work
- **File**: src/lib/harness/executor.ts:178-230
- **Scenario**: During a session, every stdout chunk is split into lines and each line `JSON.parse`d to extract `session_id`/`cost_usd`; then on `close` the fully accumulated `stdout` string is split and parsed line-by-line again from scratch. A 10-minute Claude session in stream-json mode emits megabytes (tool results included), so both the `stdout += text` accumulation and the double parse operate on multi-MB payloads.
- **Root cause**: Metadata extraction happens incrementally per chunk while assistant-text extraction happens in a second full pass at close; neither pass buffers incomplete lines, so chunk boundaries split JSON mid-line — the chunk-time parse throws (funneled into `silentCatch`, producing noise and occasionally missing `cost_usd` if that line straddles a boundary), and the close-time parse's catch branch appends the raw line to `assistantOutput` as "fallback" text, polluting the output that `parseAreaResult` and `extractDecisions` then scan.
- **Impact**: Wasted CPU on double-parsing megabytes per area (dozens of areas per run), silentCatch log spam, and nondeterministic metadata/assistant-output corruption depending on where the OS splits pipe chunks.
- **Fix sketch**: Keep a single line-buffered parser on the data event (carry the trailing partial line to the next chunk, e.g. via `readline.createInterface(proc.stdout)`), extracting session_id, cost, and assistant text blocks in one pass into an array. Drop the close-time re-parse entirely; only genuinely non-JSON complete lines should hit the raw-text fallback.

## 4. Node-only CLI harness lives under src/ of the Vite frontend tree, with stale hardcoded paths
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/lib/harness/run-harness.ts:7
- **Scenario**: The whole module imports `child_process` and `fs` and spawns the `claude` CLI — it can never run inside the Tauri webview — yet it sits in `src/lib/` next to browser code and is re-exported by a barrel using the app's `@/lib/silentCatch` alias. Any future frontend import (autocomplete picking `@/lib/harness`) breaks `vite build` with Node built-in resolution errors.
- **Root cause**: The harness was scaffolded inside the app source tree instead of a `scripts/` or `tools/` directory; the usage comment still hardcodes another machine's path (`C:/Users/kazda/kiro/personas`), confirming it is a personal dev tool, not app code.
- **Impact**: The 8 files are compiled/linted with the app on every gate run, are exposed to accidental bundling, and mislead the context map into treating a dev script as "Core Libraries & State". The stale example path sends the next user to a nonexistent directory.
- **Fix sketch**: Move `src/lib/harness/` to `scripts/harness/` (or `tools/harness/`), replace the `@/lib/silentCatch` alias import with a relative import or a local no-op, and update the four docs/harness/*.md references plus the usage comment (use `--project .` in the example instead of a hardcoded absolute path). Low-risk since nothing in src/ imports it.
