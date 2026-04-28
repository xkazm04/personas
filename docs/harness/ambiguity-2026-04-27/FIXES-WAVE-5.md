# Ambiguity Audit — Fix Wave 5: State / cache invalidation

> 4 commits, 4 critical findings closed (Theme E).
> Baseline preserved (modulo the same pre-existing `useMatrixBuild.test.ts` failure carried over from before Wave 4).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `6cbbc46c` | `credentials-keys.md` #1 (cachedPublicKey) | critical | `lib/utils/platform/crypto.ts` |
| 2 | `e794799a` | `overview-dashboard.md` #1 (globalExecutionsTotal) | critical | `stores/slices/overview/overviewSlice.ts`, `features/overview/sub_activity/components/GlobalExecutionList.tsx`, `features/overview/components/dashboard/DashboardHomeMissionControl.tsx` |
| 3 | `a07e4910` | `overview-dashboard.md` #2 (successRate proxy) | critical | `stores/slices/overview/personaHealthSlice.ts` |
| 4 | `366fc5d7` | `agent-editor-configuration.md` #2 (registerSave during render) | critical | `features/agents/sub_editor/libs/EditorDocument.tsx` |

## What was fixed (grouped by sub-pattern)

1. **`cachedPublicKey` was a process-lifetime singleton with no rotation detection.** The frontend cached the imported RSA public key forever, with `clearCryptoCache()` only called on logout. Backend keypair rotations (Tauri-window reload that doesn't restart the renderer, vault re-key, panic recovery, keyring access denial that forces fallback re-init) silently left the frontend encrypting with the abandoned key, and every IPC decrypt failed with a generic "Failed to encrypt sensitive data for IPC" indistinguishable from a transient fault. Cache the imported `CryptoKey` plus the raw PEM string and a fetch timestamp; on every encrypt, if older than `PUBLIC_KEY_REFRESH_INTERVAL_MS` (60 s), refetch the PEM (cheap IPC — backend reads a static) and compare. Only re-import the heavy CryptoKey when the PEM actually changed; otherwise just renew the freshness stamp. Backend rotation is detected within ~60 s with no backend signalling required.

2. **`globalExecutionsTotal` was a "+1 sentinel hint" misnamed as a row count.** `merged.length + (rawCount >= limit ? 1 : 0)` looked like a count but was actually a "hasMore" flag. Two consumers wired this misleading number into "X of Y" UIs (filter summary "Showing X of Y", subtitle "N executions recorded", Mission Control's `totalExecutions=` prop on `VitalsConsole` and `StatusTicker`). Renamed to `globalExecutionsHasMore: boolean` and retyped, so any future "X of Y" usage is a TypeScript error. The setter writes the boolean directly. The hasMore-style consumer (`offset < total`) collapses to `globalExecutionsHasMore`. Count-displaying consumers point at `globalExecutionCounts.total` (the authoritative server-side count). JSDoc on both fields documents which is for paging vs which is for display.

3. **`successRate` silently substituted the fleet-wide rate for active personas.** For each persona, `successRate = totalExecs > 0 ? (dashboard?.overall_success_rate ?? 100) : 100` masqueraded fleet-wide data as per-persona and defaulted inactive personas to a perfect 100 with no marker. Health grades, leaderboard scoring, and routing recommendations all consumed this number, so two personas in the same fleet would show identical successRate values even when one was healthy and one was failing. Added `successRateSource: 'measured' | 'proxy' | 'unknown'` to `PersonaHealthSignal`. Active personas with a fleet rate get `'proxy'`; inactive (or no fleet rate) get `'unknown'` with the 100 default kept for `computeHeartbeatScore` numerical stability; `'measured'` is reserved for when per-persona-per-day data lands. UI consumers can now distinguish "fleet avg, take with a grain of salt" from "this persona's actual rate".

4. **`registerSave`/`registerCancel` mutated the store map during render.** The comment claimed "safe because notify() is not called", which holds in legacy render-then-flush, but React 19 Concurrent rendering can discard a render entirely — leaving the registry bound to a closure that captured aborted state. A subsequent `saveAll` could then persist values the user never saw. Hold the latest save/cancel callbacks in refs (refs are exempt from Strict Mode aborted-render concerns); update them on every render. Register a stable trampoline once via `useEffect` that derefs the ref at call time. Only committed renders run effects, so the registry binds only to commits. Behaviour for the consumer is unchanged.

## Verification table (before / after)

| Counter | Before Wave 5 | After Wave 5 |
|---|---:|---:|
| `tsc --noEmit` errors | 0 | 0 |
| Tests passing (broad set, modulo pre-existing useMatrixBuild failure) | 409 / 410 ¹ | 409 / 410 ¹ |
| Process-lifetime caches with no rotation detection | 1 (cachedPublicKey) | 0 |
| State fields with name lying about their semantics | 1 (globalExecutionsTotal as "+1 sentinel") | 0 |
| Per-entity stats silently substituted from fleet-wide aggregates | 1 (successRate) | 0 (now tagged) |
| Store mutations during render susceptible to aborted-render bind | 2 (registerSave, registerCancel) | 0 |

> ¹ Same single failing test (`useMatrixBuild.test.ts > handleAnswer > calls session.answerQuestion with cellKey and answer`) carried over from Wave 4 — pre-existing, introduced by external merge `2cd9da86`, unrelated to the fixes in this session. See `FIXES-WAVE-4.md` for details.

## Cumulative status (waves so far)

| Wave | Theme | Findings closed | Commits | Lines net |
|---|---|---:|---:|---:|
| 1 | Two-X-coexist (libs/ duplicates) | 3 critical | 3 | +123 / -148 |
| 2 | Silent failure / lying state | 6 critical (+1 already-fixed) | 6 + 1 docs | +114 / -342 |
| 3 | Cross-entity scoping | 4 critical | 4 | +109 / -20 |
| 4 | Validation / security gates | 6 critical | 6 | +154 / -36 |
| 5 | State / cache invalidation | 4 critical | 4 | +143 / -27 |
| 6 | Sanitization & cross-boundary contracts | (pending) | — | — |

## Patterns established (additions to the catalogue, items 18-21)

18. **Process-lifetime caches need invalidation triggers, not just clear-on-logout** — any cache that mirrors a backend value must declare the events that invalidate it. If the backend can rotate the value without an explicit event, prefer a periodic-refresh-with-fingerprint strategy over an indefinite singleton. The TTL trades a tiny extra IPC for catastrophic correctness — backend rotation no longer causes silent IPC failures that look like transient faults.

19. **A name that lies about semantics is a type-system bug** — `someFieldTotal: number` whose value is "result count plus a sentinel hint" guarantees that consumers wiring "X of Y" UIs will silently display wrong numbers. When semantics change, rename AND retype. `boolean` instead of `number` makes future misuse a compile error.

20. **Per-entity stats sourced from fleet aggregates must declare the source** — when a per-X value is silently substituted from a fleet-wide aggregate, add a sibling `xSource: 'measured' | 'proxy' | 'unknown'` field. Consumers can keep the existing field for scoring but UIs can show the truth ("fleet avg" badge) and tests can assert "measured" when proper data lands. Default-to-100-on-no-data is fine for downstream math IF the source field marks it as unknown.

21. **In React 19 Concurrent rendering, store mutations must happen in effects** — the legacy "safe during render because notify isn't called" exception is closed: an aborted render's mutations to module/store state still persist, and a closure captured by that mutation references aborted state. Use a ref-then-trampoline pattern (write the closure to a ref each render; register a stable function in useEffect that derefs at call time) so only committed renders bind the registry.

## What remains

- **Wave 6** (Theme F — sanitization & cross-boundary contracts) — 4 fixes: `escapeSqlStringLiteral` broken regex (inverted intent), Redis SCAN injection (no escape), `ROLE_PRESETS` no contract with Rust JSON, `auth_variants` cast no validation.
