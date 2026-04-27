# Bug Hunt — Personas Client-Side, 2026-04-27

> Bug Hunter persona scan across 17 contexts (client-side only — `src-tauri/` descoped).
> 17 parallel subagent runs, batched in waves of 8 / 8 / 1.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 17 contexts | **25** | **100** | **87** | **23** | **235** |
| Share | 11% | 43% | 37% | 10% | 100% |

---

## Per-context breakdown

| # | Context | Critical | High | Medium | Low | Total | Report |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | Agent Editor & Configuration | 3 | 6 | 4 | 1 | 14 | [agent-editor-configuration.md](agent-editor-configuration.md) |
| 2 | Agent Chat & Tool Runner | 2 | 6 | 5 | 1 | 14 | [agent-chat-tool-runner.md](agent-chat-tool-runner.md) |
| 3 | Agent Lab & Matrix Builder | 2 | 6 | 4 | 1 | 13 | [agent-lab-matrix-builder.md](agent-lab-matrix-builder.md) |
| 4 | Credentials & Keys | 2 | 5 | 5 | 1 | 13 | [credentials-keys.md](credentials-keys.md) |
| 5 | Recipes & Pipelines | 2 | 6 | 5 | 1 | 14 | [recipes-pipelines.md](recipes-pipelines.md) |
| 6 | Persona Templates Catalog | 2 | 6 | 5 | 1 | 14 | [persona-templates-catalog.md](persona-templates-catalog.md) |
| 7 | Deployment, Sharing & Plugins | 2 | 7 | 6 | 1 | 16 | [deployment-sharing-plugins.md](deployment-sharing-plugins.md) |
| 8 | External Integrations | 2 | 7 | 7 | 2 | 18 | [external-integrations.md](external-integrations.md) |
| 9 | Agent Tools, Connectors & Use Cases | 1 | 6 | 5 | 2 | 14 | [agent-tools-connectors-use-cases.md](agent-tools-connectors-use-cases.md) |
| 10 | Connector Catalog | 1 | 5 | 4 | 1 | 11 | [connector-catalog.md](connector-catalog.md) |
| 11 | Execution Engine (frontend) | 1 | 5 | 5 | 2 | 13 | [execution-engine.md](execution-engine.md) |
| 12 | Triggers & Schedules | 1 | 6 | 5 | 2 | 14 | [triggers-schedules.md](triggers-schedules.md) |
| 13 | Settings | 1 | 6 | 5 | 1 | 13 | [settings.md](settings.md) |
| 14 | Overview Dashboard | 1 | 7 | 7 | 1 | 16 | [overview-dashboard.md](overview-dashboard.md) |
| 15 | Onboarding & Home | 1 | 6 | 5 | 2 | 14 | [onboarding-home.md](onboarding-home.md) |
| 16 | Vault Data Sources & Dependencies | 1 | 4 | 5 | 1 | 11 | [vault-data-sources-dependencies.md](vault-data-sources-dependencies.md) |
| 17 | Health, Validation & Network | 0 | 6 | 5 | 2 | 13 | [health-validation-network.md](health-validation-network.md) |
|  | **Total** | **25** | **100** | **87** | **23** | **235** |  |

---

## All 25 critical findings — one-line summary

Sorted into themes for triage. Each item links to its full entry in the per-context report.

### A. Secret / token leak (security boundary)

1. **Credentials — `FieldActionButtons` invoked as function** — Renders `useState`/`useEffect` against parent's hook slots; eye-toggle/copied state can briefly reveal one secret while user looks at another.
   `src/features/vault/sub_credentials/.../FieldCaptureRow.tsx`
2. **Credentials — Clipboard never auto-clears for revealed secrets** — pasted-by-accident contexts (notes, LLM chats, screenshots) capture decrypted values.
3. **Settings — BYOM API key save/delete has no try/catch** — Rejected payloads echo the offending value to React error boundary + Sentry; cloud Ollama / LiteLLM master keys leak to telemetry.
   `src/features/settings/sub_byom/ByomApiKeyManager.tsx`
4. **External — `signDocument` accepts arbitrary file paths with zero user confirmation** — Prompt-injected persona forges cryptographic signatures on files the user never agreed to sign (e.g. private keys).
   `src/api/signing/index.ts`
5. **Sharing — Share-link bearer tokens written to OS clipboard, never cleared** — 24-hour capability tokens leak via Apple Universal Clipboard / Windows cloud clipboard history.
   `src/features/sharing/.../BundleExportDialog.tsx:138`
6. **Vault — `isMutationQuery` misclassifies CTE-style writes** (`WITH x AS (DELETE/UPDATE/INSERT...) SELECT ...`) as read-only — bypasses safe-mode confirmation entirely.

### B. Data loss / silent corruption

7. **Editor — "Save & Switch" silently discards latest keystrokes when autosave is in-flight** — `useDebouncedSaveGroup`'s baseline-recheck no-ops because the in-flight save already advanced the baseline. UI shows success.
8. **Editor — design_context whole-document overwrites** wipe edits made elsewhere in the document while a save was in flight.
9. **Editor — Cross-persona contamination of A/B comparison runs** — switching personas mid-run mixes results.
10. **Triggers — `updateFrequency` rebuilds trigger config from scratch** — silently wipes `active_window` and `rate_limit` whenever frequency changes; "business hours only" triggers can begin firing 24/7 with no UI signal.
    `src/features/triggers/.../useScheduleActions.ts`
11. **Templates — `MatrixAdoptionView` sets `seedDone.current = true` BEFORE async createPersona completes** — backend failure leaves orphaned persona draft + UI permanently stuck on "Loading template…" with no retry.
12. **Lab — `UnifiedMatrixEntry` "cleanup" calls global `resetBuildSession()`** — A failed launch for persona A wipes an active in-progress build for persona B in another tab.

### C. Stream / execution lifecycle

13. **Chat — ChatTab 60s watchdog nukes `chatStreaming`/`activeExecutionId`/`executionPersonaId` on slow tool calls or thinking pauses** — backend execution stays running but is orphaned; structured-stream subscription rebinds to `null` and silently drops TodoWrite/event payloads.
14. **Chat — User can race a still-live execution with a new message** because the UI thinks the previous one is gone (consequence of #13).
15. **Execution Engine — `processEnded` prefix-fallback reaps wrong execution row** — when no `runId` is passed, `Object.keys()[0]` marks an arbitrary run completed; the actually-finished run is stuck `running` forever.
    `src/stores/slices/processActivitySlice.ts`
16. **Agent Tools — `useUseCaseDetail.handleManualRun` reads `selectedPersona` from a stale closure** — fast persona switch between render and click fires a real production execution against the wrong agent (real cost, real downstream `emit_event` cascade).

### D. State corruption across persona / tab switch

17. **Lab — `useGenomeBreeding.ts` calls `loadRuns()` during render** (outside any effect) — Rules-of-Hooks violation; under React 19 StrictMode double-fires; under network glitches, fetch loop.
18. **Editor — Auto-design firing for the wrong persona after switch** — design generation runs against previous selection.
19. **Editor — Undo entries operating on the wrong persona's draft** — undo-redo state is shared across personas.

### E. Pipeline / orchestration partial-success

20. **Recipes — `useAutoTeam.apply()` does `newMemberIds.push(added.id)` without nullcheck** — `addTeamMember` returns `null` on backend error; TypeError leaves orphaned half-built team (team row + partial members + zero connections), no rollback.
21. **Recipes — Optimistic team updates without team-id staleness guards** — multi-step writes lacking rollback.

### F. Recovery / fallback wired wrong

22. **Onboarding — ErrorBoundary's "Go Home" path uses `require("@/stores/systemStore")`** — never resolves in Vite ESM builds; always falls through to full `window.location.reload()`, wiping in-memory onboarding state on every render error.
23. **Overview — `useStatusPageData` runs `loadData` once on mount with empty deps and never refreshes** — status page (whose entire purpose is freshness) is a permanent stale snapshot showing "all green" while real outages occur.
24. **Connector Catalog — Universal AutoCred name-collision path silently saves credentials whose data fields don't match the existing connector schema** — breaks healthchecks downstream with no save-time signal.
25. **Deployment — `useTimelinePlayback` mutates ref during render** — violates React 19 concurrent-rendering contract; tearing under heavy load.

---

## Triage themes (for planning fix waves)

These are recurring patterns across the 235 findings — useful as fix-wave topic clusters rather than going strictly file-by-file.

| Theme | Approx count | Why this is a wave, not just individual fixes |
|---|---:|---|
| **Stale-closure during persona / tab switch** | ~18 | Same root cause keeps surfacing in different surfaces (chat, editor, lab, tool runner, design). One shared "current persona ref" pattern fixes many at once. |
| **Optimistic update without rollback** | ~22 | Multi-step writes with no atomicity (team build, template adopt, tool selection, model save). Either introduce a transactional wrapper or document explicit rollback per call. |
| **`useEffect` cleanup gap (interval / listener / timeout leak)** | ~28 | Polling, drag handlers, WebSocket subs, ResizeObservers. Many can be caught by an ESLint rule or audit script. |
| **Caught-and-swallowed errors (silent-success theater)** | ~20 | Adopt success despite background failure; save success despite no write; sync success despite partial. Toast/error-event audit needed. |
| **Validation gap at trust boundary** | ~15 | SQL CTE bypass, share-link no expiry check, signDocument-any-path, AutoCred schema mismatch, .env parser leaking secrets, BYOM URL not validated. Each is a separate boundary; group by surface. |
| **Config-wipe via partial rebuild** | ~10 | Triggers `updateFrequency`, design_context whole-doc save, BYOM routing replace. Pattern: build-from-scratch when only one field changed. Refactor to merge instead of replace. |
| **Race-window producing wrong result** | ~25 | seq-counter inconsistency, double-submission, FSM transitions allowed mid-flight, watchdog firing on slow-but-alive operation. Highest-stakes class — most likely to ship to a user. |
| **Time / timezone / DST** | ~12 | Cron parsing, schedule preview, cost-per-day windowing, log timestamps. Single-day work to centralise into a tz helper. |
| **Hook-rule violations** | ~6 | `FieldActionButtons` as function-not-JSX, `loadRuns()` during render, ref-mutation-in-render. Fix individually but treat as ESLint-rule candidates. |
| **Empty-set / divide-by-zero / NaN propagation** | ~15 | KPI math, leaderboard scoring, period-comparison trends. Localised to overview/leaderboard. |
| **Polling that survives unmount** | ~10 | Health digest scheduler, status page, gitlab notification, cloud health monitor. Build a shared `useInterval` that cleans up and adopt across the codebase. |

Total themed: ~181 of 235. Remainder are surface-specific.

---

## Suggested next-phase split

The 235 findings are too many for a single fix pass. A reasonable split:

1. **Phase X.1 — Security & data-loss criticals (items 1–12 above)**: 12 fixes, all severity-critical, mostly small in-file changes. Estimate 1 focused session.
2. **Phase X.2 — Stream & execution lifecycle (items 13–16, plus 25 high-severity in same theme)**: 1 session focused on persona-switch staleness + ChatTab watchdog + processEnded prefix bug. Same mental model unlocks many fixes.
3. **Phase X.3 — Optimistic-update rollback wave**: pull the ~22 findings tagged as state-corruption / partial-success and fix them as a topic, introducing a `withRollback()` helper that future code can adopt.
4. **Phase X.4 — Cleanup-gap audit + ESLint rule**: ~28 findings + a permanent guardrail. Likely 2 sessions.
5. **Phase X.5 — Silent-success theater**: ~20 findings. Audit each `catch {}` and either re-throw to a boundary, surface a toast, or document why it's truly benign.
6. **Phase X.6 — Trust-boundary validation hardening**: ~15 findings. Each is a different surface, but the work is mechanical once you know what to add.
7. **Backlog — Mediums and lows**: ~110 findings. Triage into "fold into next refactor that touches the file" rather than dedicated sessions.

---

## How this scan was run

- **Scanner**: Bug Hunter persona prompt (`vibeman/src/lib/prompts/registry/agents/bug-hunter.ts`)
- **Date**: 2026-04-27
- **Scope**: 17 contexts as defined in Vibeman for project `personas`. **`src-tauri/` descoped** per request — Rust backend not analysed.
- **Method**: 17 general-purpose subagents in parallel waves (8 + 8 + 1). Each agent independently:
  - read 11–53 client-side files for its context
  - applied the bug-hunter focus areas (latent failures, race/timing, edge cases, silent failures)
  - produced 11–18 findings with severity, category, file:line, scenario, root cause, impact, fix sketch
- **Total file reads**: roughly ~400 files across all contexts
- **Result counts independently verified**:
  - File header self-reports sum to 235
  - `^- **Severity**:` bullet count across all reports = 235

---

## Notes for the triage session

- A **handful of findings overlap across reports** (e.g. health hooks scanned by both Health and Tools contexts). When triaging, dedupe by file path + scenario.
- Severity is reporter-judgment, not automated. A few "high" items in a security-sensitive report may be more critical than "critical" items in a lower-stakes report — re-rank during triage.
- Some reports flagged files as missing or moved (e.g. `MatrixTab.tsx`, `CapabilityAddModal.tsx` paths). The Vibeman context definitions are slightly stale — worth refreshing the project's context file paths after the triage.
- Several integrations (gitlab, drive, obsidian, etc.) had only 1–3 findings each within the External Integrations report. Future scans of "External Integrations" might benefit from being split into per-integration contexts to get deeper coverage.
