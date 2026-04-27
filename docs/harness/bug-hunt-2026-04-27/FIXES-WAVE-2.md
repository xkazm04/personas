# Bug Hunt Fix Wave 2 — Stream / Execution Lifecycle & Persona-Switch Staleness

> 6 commits, 6 findings closed.
> Baseline preserved: 0 TS errors → 0 TS errors, 870/870 tests pass → 870/870 tests pass.

---

## Commits

| # | Commit | Finding closed | Files |
|---:|---|---|---|
| 1 | `b5c13272` fix(chat): watchdog no longer orphans live executions on slow tool calls | agent-chat-tool-runner #1 (critical) | 1 |
| 2 | `1cb82d5a` fix(execution): processEnded refuses ambiguous prefix-fallback | execution-engine #9 (critical) | 1 |
| 3 | `5b5141a0` fix(use-cases): handleManualRun aborts when persona changed before click | agent-tools-connectors-use-cases #1 (critical) | 1 |
| 4 | `a54b2d17` fix(lab): wrap useGenomeBreeding initial load in useEffect | agent-lab-matrix-builder #1 (critical) | 1 |
| 5 | `8ac865c2` fix(design): auto-start compile honors cancelled flag and pinned persona id | agent-editor-configuration #9 (high — same theme) | 1 |
| 6 | `3e225e34` fix(editor): undo entries refuse to mutate the wrong persona's draft | agent-editor-configuration #4 (high — same theme) | 1 |

---

## What was fixed (theme: stream lifecycle + persona-switch staleness)

### Stream lifecycle (2 fixes)

1. **ChatTab 60s watchdog orphaned live executions** — On any 60s gap in `streamTextLines.length` change while `chatStreaming` was true, the watchdog cleared `chatStreaming + isExecuting + activeExecutionId + executionPersonaId`. 60s is below the natural runtime of legitimate slow tool calls, large file reads, multi-minute thinking, or slow networks — so the watchdog routinely fired during normal long-running work. Worse: clearing `activeExecutionId` nuked the structured-stream subscription binding, silently dropping any late-arriving TodoWrite/tool-result events; clearing `isExecuting` let the user race the still-live execution with a new message. Now: 5-minute timeout, and only `chatStreaming` is cleared (the streaming bubble visibility). The other state fields stay so late events still attach via `useStructuredStream(activeExecutionId)` and the input remains locked. Manual cancel still works.

2. **`processEnded` prefix-fallback reaped wrong row** — `processEnded("execution", "completed")` without a runId fell back to `Object.keys().find(k => k.startsWith("execution:"))` and reaped an arbitrary match. With multiple parallel executions sharing a domain, the wrong row was marked completed while the actually-finished run stayed `running` forever — irrecoverable activity-dock corruption. Added `findUniqueProcessKey` alongside the existing `findProcessKey`: when multiple matches exist with no runId, refuse with a console.warn naming the ambiguous keys. The single-match case is preserved (legitimate "enriched after start" flow). `enrichProcess`/`updateProcessStatus` keep using the loose lookup because their writes are idempotent.

### Persona-switch staleness (4 fixes)

3. **`handleManualRun` fired against wrong persona** — Use-case "Manual Run" button calls the production `execute_persona` IPC: real CLI spawn, real cost, real downstream `emit_event` cascade. Click handler read `selectedPersona` from the closure; a fast persona switch between render and click would fire the production run against the wrong agent. Now: snapshot `expectedPersonaId` at click entry, re-read live `selectedPersona` via `useAgentStore.getState()`, abort if they differ.

4. **`useGenomeBreeding` `loadRuns()` during render** — Bare `if (!hasLoadedRuns) { loadRuns(); }` line at the top of the hook body ran outside any useEffect. React 19 StrictMode double-invokes render → IPC fired twice on mount; under network glitches the async setRuns/setHasLoadedRuns chain could re-render the consumer before the flag flipped, restarting the fetch in a loop. Now wrapped in `useEffect` so it runs once after commit.

5. **Auto-start design compile fired for wrong persona** — `useDesignTabState`'s auto-start effect's `cancelled` flag guarded `setConversationId` only; `compile()` then ran unconditionally with `selectedPersona.id` from the closure. A persona switch between `startConversation` resolving and the synchronous compile dispatch kicked off a multi-minute LLM compilation against the original persona — result lands in the wrong history, cost burned for unwanted output. Now: snapshot `startedForPersonaId` at effect start, use it for every async hop, re-check `cancelled` before each await boundary AND before the compile dispatch.

6. **Undo entries mutated wrong persona's draft** — `UndoEntry.restore`/`reapply` close over `setDraft`/`setBaseline` setters that always mutate the currently-selected persona. Pressing Ctrl+Z right after switching personas (and before the persona-reset effect's `clearHistory` commits) wrote persona A's old field values into persona B's draft+baseline — and the editor lied "All saved" because baseline was overwritten too. Re-undoing reapplied the corruption. Now: `makeUndoEntry` captures `selectedPersona.id` at entry-creation time; both `restore` and `reapply` short-circuit if `useAgentStore.getState()` shows the user has navigated away. Belt-and-suspenders alongside the existing clearHistory effect.

---

## Verification

| Gate | Before wave 2 | After wave 2 |
|---|---|---|
| TypeScript errors | 0 | **0** |
| Tests passing | 870 / 870 | **870 / 870** |
| Files modified | — | 6 unique |
| Wave 1+2 cumulative findings closed | 12 | **18** of 25 critical |

Each commit was atomic, references its source finding in `docs/harness/bug-hunt-2026-04-27/`, and explains the *why* in the body for future readers.

---

## Pattern observed across both waves

The recurring shape of these critical bugs is the same:

1. An async operation captures `selectedPersona`/`personaId` at entry-time via React closure.
2. The user (or any other state-changing event) shifts `selectedPersona` during the await.
3. Resolution branch fires against the **stale** captured value but acts on **live** global state — silently writing to the wrong record.

The defensive pattern this fix wave establishes is consistent and should be reused for new code:

- **Snapshot** the `personaId` (or other "context anchor" identifier) into a `const` at entry time.
- **Re-read** live state via `useStore.getState()` immediately before the side-effect.
- **Compare** them; abort or cancel cleanly if they diverge.
- For long-running async chains, add `if (cancelled) return;` checks **after every await boundary**, not just at the top.

Wave-1's A/B-compare fix and wave-2's `handleManualRun` / `useDesignTabState` / `useEditorSave` undo fixes all use this exact shape. Future audits should grep for `useAgentStore((s) => s.selectedPersona)` followed by an `await` inside a callback to find more candidates.

---

## What remains

From the original 25 critical findings in `INDEX.md`, waves 1+2 closed 18. Still pending in subsequent waves:

- **Recipes — `useAutoTeam.apply()` orphaned half-built teams** (`recipes-pipelines.md` critical)
- **Onboarding ErrorBoundary `require()` never resolves** in Vite ESM (`onboarding-home.md` critical)
- **Overview `useStatusPageData` permanent stale snapshot** (`overview-dashboard.md` critical)
- **Connector Catalog AutoCred schema-mismatch silent save** (`connector-catalog.md` high)
- **Deployment `useTimelinePlayback` ref-mutation-in-render** (`deployment-sharing-plugins.md` high)
- Plus the long tail of high-severity items grouped by theme in INDEX.md.
