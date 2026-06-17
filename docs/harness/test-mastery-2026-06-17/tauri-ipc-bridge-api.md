# Test Mastery — Tauri IPC Bridge & API
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

Context: the typed IPC bridge between React and Rust — `invokeWithTimeout`, undefined→null
arg coercion, in-flight dedup, timeout/auth-retry, the IPC metrics ring buffer, the TS↔Rust
enum unions, and the thin API wrappers (`director`, `systemOps`, `remoteCommands`).

Suite reality check: `src/test/setup.ts` ALREADY mocks `@tauri-apps/api/core`'s `invoke`
(returns `undefined`), and `tauriInvoke.ts` ALREADY ships test-only exports
(`coerceArgs`, `_clearAutoDedupForTests`) "exported for unit tests only" — yet **there is not
a single test** in `src/lib/` or `src/api/` exercising any of it (`vitest` `include`:
`src/**/*.test.{ts,tsx}`). The scaffolding for these tests was deliberately built and then
never used. There IS a good static contract gate (`scripts/check-command-contract.mjs`, wired
into `npm run check:contracts`) that keeps command NAMES in sync — but nothing exercises
runtime bridge BEHAVIOR.

---

## 1. `coerceArgs` undefined→null coercion (Rust `Option<T>` wire contract) is wholly untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/lib/tauriInvoke.ts:162-195 (`coerceArgs` / `isPlainRecursable`); contract at 215-242
- **Current test state**: none (despite `coerceArgs` being explicitly `@internal — exported for unit tests only`)
- **Scenario**: This wrapper is the SINGLE chokepoint that converts `undefined` → `null` before
  every Tauri invoke. The whole `RustArgs<T>` convention (used by ~every `Option<T>` parameter
  across hundreds of commands — `listMemories`, `getDirectorPortfolio({days})`,
  `runDirectorBatch({maxPersonas})`, etc.) relies on it: `JSON.stringify` OMITS `undefined`
  keys, and `serde_json` then rejects the payload ("missing field") instead of seeing `None`.
  Today, a regression that (a) stops recursing into nested objects/arrays, (b) starts recursing
  INTO a class instance (the documented `Channel` → `"invalid type: map, expected a string"`
  bug), or (c) drops the array-element branch, would ship green. Streaming channels, nested
  optional filters, and any optional arg would silently break at runtime across the app.
- **Root cause**: the test hook was created but no spec was ever written; the behavior is only
  validated implicitly by manual QA / runtime crashes.
- **Impact**: blast radius = the entire app's IPC surface. A coercion regression manifests as
  opaque serde errors on arbitrary commands (chat streaming, memory lists, director runs) —
  hard to attribute, easy to ship.
- **Fix sketch**: a focused `tauriInvoke.test.ts` asserting business invariants of `coerceArgs`
  (LLM-generatable — pure function, already exported): top-level `undefined`→`null`; nested
  object recursion; array element recursion (incl. `undefined` elements→`null`); `Date` and
  class instances (object with non-`Object.prototype` proto, e.g. a faux `Channel` with a
  `toJSON`) pass through UNTOUCHED (the load-bearing invariant); null-prototype objects ARE
  walked; `null` preserved as `null`. Invariant to assert: *no `Option<T>` field is ever
  dropped, and no opaque IPC class is ever flattened.*

## 2. `invokeWithTimeout` timeout + IPC-auth one-shot retry path untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/lib/tauriInvoke.ts:244-336 (dispatch/overload), 353-444 (`_invokeCore`, timeout, retry), 451-462 (`isIpcAuthFailure`)
- **Current test state**: none
- **Scenario**: Three correctness-critical behaviors have zero coverage: (1) the **timeout** —
  a never-resolving `invoke` must reject with `InvokeTimeoutError` after `timeoutMs` and the
  call must be recorded as `timedOut:true` (drives the IPC metrics timeout rate); (2) the
  **one-shot WebView2 auth retry** — on an `"IPC authentication failed"` rejection with a
  refreshed `__IPC_TOKEN`, the wrapper must retry EXACTLY once (`_retryDepth < 1`) and not loop;
  (3) **overload parsing** — the new opts-object form vs legacy positional `(cmd,args,options,timeoutMs)`
  must resolve `timeoutMs`/`idempotencyKey`/`noAutoDedup` correctly. A regression flipping the
  retry guard to `<= 1` (retry storm) or mis-detecting the auth-failure shape (Tauri serialises
  `AppError` as `{error,kind}`) would ship green.
- **Root cause**: async timing + the deliberately-mocked `invoke` make these feel "hard", so
  they were skipped — but the mock is already in `setup.ts` and `vi.useFakeTimers()` makes the
  timeout deterministic.
- **Impact**: a broken timeout means hung UI with no error (90s default everywhere); a broken
  retry guard means infinite re-invoke on cold start (the OOM class the code comments warn
  about); a broken `isIpcAuthFailure` means cold-start calls fail permanently instead of
  self-healing.
- **Fix sketch**: with `vi.useFakeTimers()` and the existing core mock: assert
  `InvokeTimeoutError` thrown + `recordIpcCall({timedOut:true})` after advancing timers; assert
  `invoke` called twice (not more) when first rejects with `{error:"IPC authentication failed"}`
  and `globalThis.__IPC_TOKEN` is set; assert opts-object vs positional both honor a custom
  `timeoutMs`. Unit-test `isIpcAuthFailure` directly against string / `Error` / `{error}` /
  `{message}` / null shapes (pure, LLM-generatable).

## 3. Auto-dedup result isolation (`structuredClone` per extra caller) untested — silent cross-caller mutation risk
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/lib/tauriInvoke.ts:94-145 (`stableStringify`), 274-333 (auto-dedup fold + clone), 344 (`_clearAutoDedupForTests`)
- **Current test state**: none (`_clearAutoDedupForTests` exists solely to support tests that don't exist)
- **Scenario**: Read-only commands (`list_*`/`get_*`/`fetch_*`) fold concurrent identical calls
  into one round-trip. The fix comment is explicit: every ADDITIONAL caller must get an
  independent `structuredClone` so one caller's in-place `.sort()`/`.push()` (or a mutating
  zustand reducer) doesn't corrupt the others sharing the held promise. There is no test
  proving (a) two concurrent identical `get_*` calls issue ONE backend invoke, (b) the second
  caller gets a DIFFERENT array instance (mutation isolation), (c) `stableStringify` makes
  `{a:1,b:2}` and `{b:2,a:1}` dedup but treats class-instance/cyclic args as non-stable (returns
  `null` → bypass dedup), (d) a REJECTED dedup entry is evicted immediately so a retry hits the
  backend, and (e) non-read-only commands (`update_*`, `delete_*`) are NEVER deduped. A
  regression returning the shared reference instead of a clone would corrupt list views
  intermittently and untraceably.
- **Root cause**: concurrency + TTL timing perceived as flaky; but the test hook + fake timers
  make it deterministic.
- **Impact**: intermittent UI corruption (a sorted list mutates a sibling component's data), or
  a silent double round-trip stampede if dedup breaks — both extremely hard to reproduce in the
  field.
- **Fix sketch**: in `tauriInvoke.test.ts`, call `_clearAutoDedupForTests()` in `beforeEach`;
  mock core `invoke` to resolve a fresh array after a microtask, fire two concurrent
  `invokeWithTimeout("list_x", same)`, assert mock called once and the two resolved values are
  `!==` (clone). Separately unit-test `stableStringify` (pure, LLM-generatable): key-order
  independence, `undefined`→`null` normalization, class instance / cycle → `null`. Invariant:
  *deduped readers never share a mutable instance; writes never dedup.*

## 4. IPC metrics ring buffer (`ipcMetrics.ts`) — percentile & lifetime-rate math untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/lib/ipcMetrics.ts:44-153 (`recordIpcCall`, ring wraparound, `percentile`, `computeCommandStats`, `getGlobalSummary`)
- **Current test state**: none
- **Scenario**: This is the sibling module `tauriInvoke` writes every call into; it powers the
  IPC Performance / observability panels and the timeout/error alerting. It encodes non-obvious
  invariants that are exactly the kind that rot silently: (a) the ring **overwrites** oldest at
  `RING_SIZE=500` and `getIpcRecords()` returns chronological order across the wrap boundary;
  (b) lifetime `timeoutRate`/`errorRate` use NEVER-EVICTED cumulative counters (the code comment
  warns deriving them from the windowed ring is WRONG past 500 calls) — so after 600 calls the
  rate must still reflect all 600, not the last 500; (c) `percentile` index math
  (`ceil(p/100*n)-1`, clamped ≥0) and empty-input→0. A regression that reverts to
  window-derived rates, or off-by-one percentiles, silently mis-reports SLA/health.
- **Root cause**: pure analytics module with no consumer test; treated as "just metrics".
- **Impact**: wrong p95/p99 and timeout rates feed observability dashboards and alert rules →
  either false all-clear (real timeouts hidden) or alert noise; both erode trust in the panel.
- **Fix sketch**: pure-function batch (LLM-generatable, assert business invariants not snapshots):
  feed 700 records, assert `getGlobalSummary().totalCalls===700` and the lifetime error/timeout
  rate counts ALL records not just the last 500; assert chronological order after wraparound;
  parametrized `percentile` cases incl. empty array (0), single element, and known p50/p95/p99;
  `computeCommandStats` groups by command and sorts by p95 desc; `timeoutCount` keys on
  `timedOut===true` not `!ok`. Add a `__resetForTests` export OR isolate via `vi.resetModules()`
  per test (module holds singleton state — call out the determinism need).

## 5. Enum unions in `enums.ts` have no TS↔Rust drift guard
- **Severity**: medium
- **Category**: quality-gate
- **File**: src/api/enums.ts:23-91 (`ObsidianConflictResolution`, `TwinChannelKind`, `TwinInteractionDirection`, `TwinPendingMemoryStatus` + their const arrays)
- **Current test state**: none
- **Scenario**: Each `type` union is paired with a `readonly [...]` const array that MUST list
  exactly the same members ("must stay in sync with its Rust-side counterpart… Add a value HERE
  FIRST, then the Rust handler"). Nothing — no test, no codegen — enforces that the array matches
  the type, nor that either matches Rust. The contract gate (`check-command-contract.mjs`) only
  covers command NAMES, not enum VALUES. A dev adding `'use_app'`-style value to the type but
  forgetting the array (or vice-versa) ships green; the Rust handler then rejects a value the UI
  offers, or the UI silently can't send a value Rust supports.
- **Root cause**: the sync is a comment-enforced convention with no executable check.
- **Impact**: a credential/Obsidian conflict-resolution or twin-channel value mismatch → a user
  action (e.g. "use vault") fails at the Rust boundary with a typed error, or a valid resolution
  is unavailable in the UI. Low-frequency but user-facing and confusing.
- **Fix sketch**: a tiny type-level + runtime test (LLM-generatable): a compile-time
  `satisfies`/exhaustiveness check that each const array's element type is assignable to AND from
  the union (catches array⊊type and type⊊array), plus a runtime length/membership assert.
  Stronger option (medium effort): extend `check:contracts` or add a `check-enum-parity.mjs` that
  greps the matching Rust enum/match arms and diffs members — promote to a blocking gate since
  these are user-facing and cheap to verify.

## 6. API wrappers (`director.ts`, `systemOps.ts`, `remoteCommands.ts`) — arg-mapping correctness untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/api/director.ts:97-164; src/api/systemOps.ts:40-80; src/api/remoteCommands.ts:9-14
- **Current test state**: none
- **Scenario**: These wrappers do real mapping that's easy to silently break: `getDirectorPortfolio`
  must send `{days: days ?? null}` (not `undefined`, not omitted); `runDirectorBatch` sends
  `{maxPersonas: x ?? null}`; `listDirectorScoreTrends([])` SHORT-CIRCUITS to `{}` WITHOUT an IPC
  call (a real optimization that, if dropped, fires an empty backend query per table render);
  the director run/batch commands must pass the long custom timeouts (420s / 1800s) — a
  regression dropping them reverts to the 90s default and times out every real director run;
  `contextScanParamsJson`/`planWeeklyContextScan` build a specific cron + JSON params shape that
  the scheduler depends on.
- **Root cause**: thin wrappers assumed "too trivial to test", but the value-mapping and
  short-circuit/timeout logic are the part that breaks.
- **Impact**: dropped null-coercion → serde rejects director portfolio/batch; lost short-circuit
  → wasted IPC on every personas-table render; lost custom timeout → director runs uniformly fail
  at 90s. All user-visible, none caught today.
- **Fix sketch**: spy on `invokeWithTimeout` (mock `@/lib/tauriInvoke`) and assert exact
  `(cmd, args, opts)` per wrapper: `days ?? null`, `maxPersonas ?? null`, the 420s/1800s
  `timeoutMs`, and that `listDirectorScoreTrends([])` resolves `{}` with ZERO invoke calls.
  Pure-function unit tests for `contextScanParamsJson` (asserts `{projectId, deltaMode}`) and
  `WEEKLY_CONTEXT_SCAN_CRON` shape (LLM-generatable).

## 7. No per-area coverage ratchet for the IPC bridge (test-only exports prove tests were intended)
- **Severity**: low
- **Category**: quality-gate
- **File**: vitest.config.ts:10-18; src/lib/tauriInvoke.ts:338-346 (unused `_clearAutoDedupForTests`)
- **Current test state**: n/a (gate absent)
- **Scenario**: `vitest.config.ts` enables no `coverage` thresholds at all, and `npm run check`
  runs contracts/tiers/tsc/eslint but never `vitest`. The bridge is the highest-blast-radius TS
  module in the app yet has 0% coverage, and dead test-only exports
  (`_clearAutoDedupForTests`, `coerceArgs @internal`) are evidence the gap is unintentional. A
  full repo-wide threshold would be noisy (huge UI surface); a NEW-CODE ratchet scoped to the
  bridge files fits.
- **Root cause**: no coverage config; test wiring half-built then abandoned.
- **Impact**: regressions in coercion/dedup/timeout (findings 1-3) can land indefinitely with no
  signal; this is the structural reason the critical gap persists.
- **Fix sketch**: once findings 1-4 land, add a SCOPED, advisory-then-blocking coverage gate via
  `vitest --coverage` thresholds restricted to `src/lib/tauriInvoke.ts` + `src/lib/ipcMetrics.ts`
  (e.g. 85% lines/branches on those two files only), and wire `vitest run` into the `check`
  pipeline. Keep it file-scoped (not global) so it catches real bridge risk without forcing a
  giant UI backfill or getting bypassed. Calibrate as a new-code ratchet, not a repo-wide floor.
