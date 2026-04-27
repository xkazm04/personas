# Bug Hunt Fix Wave 3 — Miscellaneous Criticals (orchestration partial-success, recovery wired wrong, latent React 19 hazards)

> 7 commits, 7 findings closed.
> Baseline preserved: 0 TS errors → 0 TS errors, 870/870 tests pass → 870/870 tests pass.

---

## Commits

| # | Commit | Finding closed | Severity | Files |
|---:|---|---|---|---|
| 1 | `2f87762a` fix(pipeline): useAutoTeam guards against null addTeamMember + rolls back partial team | recipes-pipelines #1 | critical | 1 |
| 2 | `143febea` fix(shared): ErrorBoundary uses static ESM import for systemStore | onboarding-home #14 | critical | 1 |
| 3 | `7fafa942` fix(overview): status page auto-refreshes every 60s while visible | overview-dashboard #16 | critical | 1 |
| 4 | `409ae5e2` fix(vault): UniversalAutoCred refuses save when discovered values miss required connector fields | connector-catalog #1 | high | 1 |
| 5 | `937160c0` fix(artist): useTimelinePlayback ref sync moved into useLayoutEffect | deployment-sharing-plugins #12 | high | 1 |
| 6 | `18e6080d` fix(tool-runner): personaIdRef updates synchronously to avoid commit-vs-effect skew | agent-chat-tool-runner #2 | critical | 1 |
| 7 | `38cecb39` fix(editor): Ollama Cloud preset save persists auth_token | agent-editor-configuration #3 | critical | 1 |

---

## What was fixed (grouped by failure mode)

### Pipeline / orchestration partial-success (1 fix)

1. **useAutoTeam orphaned half-built teams** — `addTeamMember` returns `PersonaTeamMember | null` (store catches backend errors and returns `null`), but `apply()` did `newMemberIds.push(added.id)` with no nullcheck. Accessing `.id` on `null` threw `TypeError`; the outer catch surfaced a generic 'Failed to create team' but the half-built team row + 0..N-1 members stayed orphaned in the DB. Repeated retries multiplied orphans. Now: nullcheck on every `addTeamMember`; on any add failure (or `null` return), best-effort `deleteTeam(team.id)` rollback, then re-throw so the user still sees the error. `setCreatedTeam(null)` so navigation doesn't enter a deleted team.

### Recovery / fallback wired wrong (3 fixes)

2. **ErrorBoundary `require()` never resolved in Vite ESM** — `handleGoHome` wrapped `require("@/stores/systemStore")` in try/catch as if it were a runtime resolution that might fail. require() is a Node/Webpack pattern; Vite ESM bundles do not provide a runtime require, so the try ALWAYS threw and every "Go Home" click hit `window.location.reload()` — wiping the user's onboarding state, connector approvals, template selection, and adopted persona-in-progress. A single crash anywhere in the tree wiped the entire session. Replaced with a static top-level ESM import; the try/catch is kept around the store call itself as a true last-resort.

3. **Status page permanent stale snapshot** — `useStatusPageData`'s initial-load `useEffect` had an empty deps array and ran exactly once on mount. The SLA + healing-issues fetches stayed frozen for the entire mount lifetime. Status page (whose entire purpose is freshness) showed stale "all green" while real outages occurred. Now: 60s `setInterval` that re-fires `loadData` while `document.visibilityState !== 'hidden'`. Refresh stops on tab-hide and resumes on visibility return — including an immediate fetch so a user who just opened the page sees current data instead of waiting up to 60s.

4. **AutoCred schema-mismatch silent save** — When a connector name collision was found, the discovered field schema was silently discarded and the credential saved under the existing connector's name with whatever values happened to be in `cleanValues`. The user got a "saved" toast even when the credential's data didn't include the existing connector's required fields — and downstream healthchecks / tool-binding / agent execution failed cryptically the next time the credential was used. Now: when re-using an existing connector, validate that `cleanValues` keys include every required field from `existing.fields`. Throw a clear error naming the missing keys; the user picks a different name or fills the missing fields manually.

### React 19 latent hazards (2 fixes)

5. **useTimelinePlayback ref-mutation-in-render** — `totalRef.current = totalDuration; loopingRef.current = looping;` ran in the render body, which is only safe for first-render initialization. Under React 19 concurrent rendering, render may be invoked speculatively and thrown away — a rAF tick reading `loopingRef.current` between two speculative renders could see a value from a discarded render (loop toggle off when on, total-duration clamping at the wrong boundary). Now: wrapped both assignments in `useLayoutEffect` so they run synchronously after a *committed* render only.

6. **personaIdRef commit-vs-effect skew (cross-persona tool result bleed)** — `personaIdRef` was synced via `useEffect` AFTER paint. The `runTool` result-write code reads `personaIdRef.current` to detect a persona switch during the in-flight IPC. If a tool result resolved between commit and effect-flush (microtask vs macrotask interleaving), the ref still held the *previous* `personaId` — meaning the stale-result guard either falsely accepted a stale write (cross-persona bleed) OR falsely rejected a valid one (silent drop). Now: declared at the top of the hook and assigned synchronously every render (the standard 'live ref' pattern), no useEffect lag.

### Silent credential drop (1 fix)

7. **Ollama Cloud preset auth_token silently dropped** — `performModelSave`'s Ollama-cloud preset branch omitted `auth_token` from the serialised model_profile. The auth field was shown in the UI and bound to `draft.authToken`; the keystroke was committed to the draft but never persisted. Save toast claimed success; field appeared empty after reload; first execution failed with a generic 401. The custom branch already serialised `auth_token` — just not the preset path. Now: preset profile includes `auth_token: d.authToken || undefined` alongside the other fields.

---

## Verification

| Gate | Before wave 3 | After wave 3 |
|---|---|---|
| TypeScript errors | 0 | **0** |
| Tests passing | 870 / 870 | **870 / 870** |
| Files modified | — | 7 unique |
| Cumulative findings closed (waves 1+2+3) | 18 | **25** |

Note: an initial test run reported 1 transient failure that did not reproduce on a second run (timing-sensitive flake unrelated to this wave's changes — confirmed with two consecutive clean runs).

---

## Cumulative status (waves 1+2+3)

**25 critical-or-security-sensitive findings closed in 25 atomic commits across 3 waves.**

| Wave | Theme | Findings | Status |
|---|---|---:|---|
| 1 | Security & data-loss criticals | 12 | ✅ |
| 2 | Stream lifecycle + persona-switch staleness | 6 | ✅ |
| 3 | Misc criticals (orchestration, recovery, React 19 hazards) | 7 | ✅ |
| | **Total** | **25** | |

Waves 1–3 closed every critical security/data-loss finding plus several closely-related high-severity items in the same themes. The remaining 210 findings (per `INDEX.md`) are predominantly:

- **Theme: cleanup-gap** (~28) — useEffect cleanup misses, polling without unmount cleanup, listeners that leak across personas.
- **Theme: silent-success theater** (~20) — caught errors swallowed without user-visible feedback.
- **Theme: optimistic update without rollback** (~22) — multi-step writes lacking atomicity.
- **Theme: race-window producing wrong result** (~25) — seq-counter inconsistency, watchdog firing on slow-but-alive operations.
- **Theme: time / timezone / DST** (~12) — cron parsing, schedule preview, cost-per-day windowing.
- **Theme: empty-set / divide-by-zero / NaN** (~15) — KPI math, leaderboard scoring.
- Plus per-context tail items.

These are best tackled as **theme-grouped waves** going forward (the INDEX.md "Suggested next-phase split" still stands), not file-by-file. Each theme has a shared mental model that makes a focused wave 3-5x more efficient than scattered fixes.

---

## Pattern catalogue (across all 3 waves)

The recurring shapes worth grepping for in future audits:

1. **Persona-switch staleness during async** — `useStore((s) => s.selectedPersona)` followed by an `await` inside a callback. Fix: snapshot `personaId` at entry, re-read via `useStore.getState()` post-await, abort or cancel cleanly on mismatch.
2. **Render-phase side effects** — bare statements at the top of a hook body (`if (...) { fetch() }`, `ref.current = prop`). Fix: wrap in `useEffect` or `useLayoutEffect`.
3. **Whole-document optimistic write racing concurrent mutations** — `applyOp(personaId, UpdateBlob, serialise(merge(read(), newField)))`. Fix: route through a serialized-write queue (already exists for `design_context` via `applyDesignContextMutation`).
4. **`require()` in Vite ESM bundles** — Always throws at runtime. Fix: static ESM import.
5. **Async result-write with no liveness check** — `await ipc(); setState(...)` with no abort/cancel guard. Fix: abort flag, sequence counter, or persona-id snapshot comparison.
6. **`.push(result.id)` without nullcheck** when the producer can return null. Fix: nullcheck + rollback prior partial state.
7. **`useEffect(() => fetch(), [])`** for data that should refresh. Fix: add interval-based refresh keyed to `visibilitychange`.
8. **Watchdog timers that destroy execution state** — overly-aggressive cleanup that nukes stream subscriptions. Fix: minimum 5min timeout, narrow the cleanup blast radius.
9. **Whole-config rebuild-from-scratch when only one field changed** — silently wipes other persisted fields. Fix: read-modify-write merge.
10. **Sensitive payloads written to clipboard with no TTL** — leak via cloud clipboard history. Fix: scheduled wipe that re-reads and only clears if value still matches.
