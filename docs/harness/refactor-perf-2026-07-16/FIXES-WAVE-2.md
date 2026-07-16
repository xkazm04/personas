# Refactor+Perf Fix Wave 2 — Broken caches & stale/frozen data (Theme B)

> 5 commits, 6 findings closed (all High), 8 source files touched (7 TS + 3 Rust).
> Baseline preserved: tsc 0 → 0; cargo check --features desktop,ml clean; vitest **2304/2304** (0 regressions); eslint clean per-commit.

## Commits

| # | Commit | Finding | Files |
|---|---|---|---|
| 1 | `bcd02064c` | tauri-engine-9-10 #1 — session-pool warm reuse was a permanent no-op | session_pool.rs, engine/mod.rs, executions.rs |
| 2 | `8b24bf5bd` | hooks-realtime #1 — stats memo frozen at empty snapshot | useRealtimeEvents.ts |
| 3 | `ba46c5d56` | hooks-misc #1 — one-way cancelled flag killed dashboard pipeline | useExecutionDashboardPipeline.ts |
| 4 | `9d925bc4d` | hooks-utility-2-3 #1 — useAppSetting per-render reload clobbered edits | useAppSetting.ts |
| 5 | `b7143bd5d` | plugins-research-lab-1-2 #1 + agents-editor #1 — stale sources; autosave wiped undo | HypothesesPanel.tsx, useEditorDraft.ts |

## What was fixed

1. **Warm session reuse (Rust).** `offer()` hashed `execution_config` JSON while `take()` hashed persona fields — hashes never matched, so every persona run cold-started and the whole pool was overhead. One canonical `session_pool::compute_config_hash` now serves both sides; both engine spawn paths compute it from the run's actual persona/tools and thread it to the offer. Round-trip + invalidation tests added (compile; execution blocked by a pre-existing machine-level lib-test loader failure — see follow-ups).
2. **Frozen realtime stats.** `useMemo(() => statsRef.current, [])` cached `computeStats([])` forever; panel showed 0 events / 100% success regardless of traffic. Keyed on `events` identity per the design comment.
3. **Dashboard pipeline kill switch.** Debounce-effect cleanup cancelled a shared per-mount token; after the first filter change no wave-2 fetch ever ran and TTL memoization was defeated. Per-effect-run tokens now; alerts effect owns its own.
4. **Settings edit clobber.** `validate`/`defaultValue` (inline closures at call sites) were load-effect deps → an IPC probe per render + resolves overwrote unsaved input. Latched in refs; load runs per key.
5. **Ungrounded hypothesis generation.** `sources.length === 0` guard on a flat cross-project store array skipped fetching the active project's sources after a project switch. Unconditional fetch on project change.
6. **Undo wiped by autosave.** Draft-reset effect keyed on `selectedPersona` object identity re-ran on every autosave round-trip, clearing undo history and reverting unsaved keystrokes. Now short-circuits when the persona id is unchanged.

## Patterns established (catalogue items 6–8)

6. **A cleanup-cancelled token must be per-effect-run, never per-mount** — cleanup fires on every dep change, and a shared object stays cancelled forever.
7. **Configuration args (validators, defaults, callbacks) are not data deps** — latch them in refs; depend only on the identity that names the data (key/id).
8. **A cache-freshness guard must key on the same dimension the cache is scoped to** — `array.length` on a cross-scope store array proves nothing about the current scope.

## Follow-ups recorded

- `src-tauri/tests/render_plan_proptest.rs:142` fails to compile on master drift: `ImageItemInput` gained an `enter` field, initializer not updated (pre-existing, blocks `cargo test` at workspace level).
- All `app_lib` test executables currently fail to LAUNCH on this machine (`STATUS_ENTRYPOINT_NOT_FOUND`, exit 0xc0000139) regardless of feature set — likely cleaned ort/DLL cache (`npm run ensure:ort-cache` may fix). Session-pool unit tests compile but were not executed.

## Cumulative status (waves 1–2)

16 findings closed (1 Critical + 15 High) in 16 commits. Remaining C+H per INDEX: C IPC chattiness (18), D SQLite (4), E Rust hygiene (13), F render churn (26), G UI correctness (13), H dead code (23), I duplication (19).
