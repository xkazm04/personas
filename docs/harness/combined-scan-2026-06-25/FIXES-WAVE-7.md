# Combined-Scan Fix Wave 7 — Execution / turn-lifecycle reliability

> 4 atomic fix-commits, 6 findings closed (all High) — no deferrals. All frontend.
> Dispatched as 4 parallel edit-only fix-subagents, grouped by FILE OWNERSHIP (the run/turn finalize pair shares executionSlice, so one owner).
> Baseline preserved: **tsc 0; vitest 1977 pass / 7 pre-existing fail (+1 new lab test, no regressions)**.

## Commits

| # | Commit | Finding(s) | Files |
|---|---|---|---|
| 1 | `86e48307f` | execution-runner #2 + agent-chat #1 | usePersonaExecution, chatSlice, executionSlice |
| 2 | `7293b8cf0` | agent-lab #1 + #2 | labSlice (+ cancel test) |
| 3 | `92c39bb89` | agent-chat #2 | backgroundChatSlice |
| 4 | `050ad25ce` | capabilities #2 | useUseCaseDetail |

## What was fixed

1. **Run terminal-event dropped on persona switch + chat finalize ignores status (2 findings).**
   - *execution-runner #2:* navigating away from a focused run tore down its stream but left `activeExecutionId` set, so the background status listener early-returned and the terminal event was handled by neither listener → `isExecuting` pinned ~30 min, forcing new runs to background. Added a `focusedStreamDetachedRef` + a reusable `finalizeTerminalStatus` the background listener runs when the focused stream is detached, clearing `activeExecutionId`/`isExecuting`/recovery-key regardless of selected persona.
   - *agent-chat #1:* chat finalize ignored the terminal status and persisted cancelled/failed/incomplete output as a real assistant message (re-sent as `--resume` context) or silently vanished. `finishChatStream` now takes the status and only persists on `completed`; other terminal states set the slice `error` (ChatThread card + Retry). All finalize entry points thread the real status (`finishExecution` previously discarded it).
2. **Lab per-mode lifecycle + activateVersion compensation (2 findings).** A/B, Matrix, Eval shared one `matrixLifecycle`, so cancelling one flipped another's running flag + overwrote shared progress (UI lied). A/B and Eval got their own `createRunLifecycle` instances. `activateVersion`'s two non-atomic IPCs now snapshot prior state and compensate (re-roll + actionable toast) on a step-2 failure instead of falsely claiming success.
3. **Background-chat success substring.** `!status.includes("fail")` let cancelled/incomplete/unknown turns persist a false reply + fire a false notification. Now `parseExecutionState(status) === "completed"`.
4. **Run-button double-submit.** The reentrancy guard read React state (stale in the closure), so a double-click spawned two paid executions with different idempotency keys. Added a synchronous `runInFlightRef` + a stable key within a 1s dedupe window; deliberate re-runs still mint fresh keys.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `vitest run` | 1977 pass / 7 pre-existing fail (+1 new lab independence test, no regressions) |
| eslint (pre-commit) | clean |

## Patterns established (catalogue items 21–23)

21. **Listeners that partition by focus leave an orphan gap** — splitting "focused vs background" event handling drops the event for a run the user navigated away from (focused listener gone, background listener excludes the active id). Ensure the owning entity's terminal event is always handled; clear ownership state on terminal regardless of UI focus.
22. **Discarding the status at finalize = success theater** — finalizing a stream without consulting the terminal status persists cancelled/failed output as a real result. Gate persistence on a `completed` classification (the state enum, never a substring) and surface an error otherwise.
23. **One shared lifecycle for N concurrent modes** — collapsing several independently-runnable modes onto one running-flag/progress object makes the UI lie when they overlap. Give each concurrent mode its own lifecycle instance.

## Note (process)

The Wave-7 bg-chat commit (`92c39bb89`) body lost two backtick-quoted code snippets to bash command-substitution in `git commit -m`. Code/subject/Refs are correct. Lesson: avoid backticks (and `$`) in `-m` bodies; prefer the Write tool / a file for prose.

## Cumulative status (Waves 1–7)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1 | Security | 5 (2C/2H/1M) |
| 2 | Auth / trust-boundary | 6 (2C mitigated / 4H) |
| 3 | Scheduler / watermark / sync | 4 (1C/3H) + 1H deferred |
| 4 | Races & double-execution | 6 (1C/5H) |
| 5 | Silent failures & success-theater | 6 (6H) |
| 6 | Wrong metric / unit / threshold | 6 (6H) |
| 7 | Execution / turn-lifecycle | 6 (6H) |

**Total: 39 findings addressed across ~52 commits, 0 regressions.** 6/6 scan Criticals fixed-or-mitigated; **33 of 81 Highs closed.**
**Remaining:** ~48 High + Med/Low tail. Next: Wave 8 — Credential / vault data-loss & secrets (vault edit wipes unsubmitted fields, decrypt empty-iv sentinel, blast-radius under-count, credential-design URL echo leaks secret, Telegram bot_token in URL leaks via logs).
