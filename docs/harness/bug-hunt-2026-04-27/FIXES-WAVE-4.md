# Bug Hunt Fix Wave 4 — Cleanup-Gap Theme

> 7 commits, 7 findings closed (one of which addressed both health-network #1 and the agent-tools cleanup-gap report — same root cause).
> Baseline preserved: 0 TS errors → 0 TS errors, 870/870 tests pass → 870/870 tests pass.

---

## Commits

| # | Commit | Finding | Severity | Files |
|---:|---|---|---|---|
| 1 | `b1fb0968` fix(health): digest scheduler latches after one attempt to prevent retry storm | health-validation-network #1 + agent-tools cleanup-gap | high | 1 |
| 2 | `4223bbc2` fix(deployment): useDeploymentTest clears all dismiss timers on unmount | deployment-sharing-plugins (cleanup-gap) | medium | 1 |
| 3 | `98f0d5f6` fix(onboarding): TourSpotlight tolerates transient anchor disconnect during step transitions | onboarding-home #3 | high | 1 |
| 4 | `cf5d26c8` fix(artist): useMediaExport tears down prior listeners before re-entrant start | deployment-sharing-plugins (cleanup-gap) | high | 1 |
| 5 | `fde69ccb` fix(execution): MiniPlayer copy timer ref-tracked + cleared on unmount | execution-engine (cleanup-gap) | low/medium | 1 |
| 6 | `d025c064` fix(artist): useVideoThumbnails ensures HTMLVideoElement teardown on error path | deployment-sharing-plugins (cleanup-gap, useVideoThumbnails:51-67) | medium | 1 |
| 7 | `89739757` fix(chat): ChatBubbles copy timer ref-tracked + cleared on unmount | agent-chat-tool-runner (cleanup-gap, ChatBubbles:35-38) | low | 1 |

---

## What was fixed (grouped by sub-pattern)

### Retry storm / latch released on transient failure (1)

1. **useHealthDigestScheduler retry storm** — When `runFullHealthDigest()` returned `null` (transient failure), the early-return skipped latching `ran.current`. The `finally` block then released `running.current` because `!ran.current`. Every subsequent re-render of the app-root host component re-fired the effect — a tight retry storm hammering the IPC layer on every state update. Fixed by latching `ran.current = true` on any attempt outcome (one digest attempt per app session contract).

### Re-entrant subscription leak (1)

2. **useMediaExport listeners leak on re-entrant start** — `startExport` unconditionally overwrote `unlistenersRef.current` with the new subscription set after appending to a fresh local `unsubs` array. If the user clicked Export twice (or restarted after an error), the prior listeners were never unsubscribed — they remained registered with Tauri's event bus, processing events for a job nobody was watching. The unmount cleanup walked `unlistenersRef.current` which only pointed at the *latest* set, so leaked listeners survived even tab close. Fixed by tearing down the prior set at `startExport` entry before subscribing the new one.

### setTimeout in handler with no ref + no unmount cleanup (3)

These three share an identical pattern. The bug-hunter flagged them in three different reports because they appear across many components. The fix shape is the same: store the timer in a `ref`, clear-then-set on each invocation (single-timer invariant), and clear the ref in an empty-deps `useEffect` on unmount.

3. **useDeploymentTest 15s dismiss timers** — multiple per-deployment timers in `timers.current` Record; cleanup effect now walks the whole map.
4. **MiniPlayer SimpleExecutionView copy timer** — single 2s timer; ref-tracked.
5. **ChatBubbles CopyBtn copy timer** — single 2s timer; ref-tracked. Also fixes the rapid double-click race that flickered the green check icon.

### Resource handle leaked on error path (1)

6. **useVideoThumbnails HTMLVideoElement teardown on error** — `extractFrames` created an HTMLVideoElement, set `src`, and only tore it down on the success path at the end of the function. If `loadedmetadata` rejected (corrupt file, unsupported codec) or any later step threw, the cleanup never ran — leaving a detached video element with `src=` still set, holding the file open and decoded buffers in memory until GC eventually collected the unreachable closure. Fixed by wrapping the entire decode pipeline in `try/finally` so the `teardownVideo` helper always runs. Also threaded an optional `AbortSignal` through the metadata-load Promise and the seek loop for a future ref-counted hook version.

### Transient-disconnect treated as fatal (1)

7. **TourSpotlight dismisses tour on momentary anchor disconnect** — Tour steps frequently navigate to a new view between anchor mounts (e.g. credentials-intro triggers a `storeBus` emit that re-renders the credential view, momentarily unmounting the prior anchor). The MutationObserver fired `handleReposition`, saw `currentTarget.isConnected === false`, and immediately called `dismissTour()`. Step-2 → step-3 transitions looked like a buggy auto-exit even though the anchor reappeared 100ms later. Fixed with a 4-attempt × 500ms retry window before bailing — if the same `data-testid` re-mounts at any new DOM node within ~2s, re-anchor and continue.

---

## Verification

| Gate | Before wave 4 | After wave 4 |
|---|---|---|
| TypeScript errors | 0 | **0** |
| Tests passing | 870 / 870 | **870 / 870** |
| Files modified | — | 7 unique |
| Cumulative findings closed (waves 1+2+3+4) | 25 | **32** |

---

## Cumulative status (waves 1+2+3+4)

**32 findings closed in 32 atomic commits across 4 themed waves.**

| Wave | Theme | Findings |
|---|---|---:|
| 1 | Security & data-loss criticals | 12 |
| 2 | Stream lifecycle + persona-switch staleness | 6 |
| 3 | Misc criticals (orchestration, recovery, React 19 hazards) | 7 |
| 4 | Cleanup-gap theme | 7 |
| | **Total** | **32** |

The 32 closed findings include every critical security/data-loss item plus all closely-related high-severity items in the targeted themes. Waves 1-3 closed all 25 critical-rated findings; wave 4 added the highest-impact cleanup-gap items (the rest of the cleanup-gap cluster — ~20 more — are mostly low-severity individual instances of the same patterns now fixed canonically).

---

## Patterns established (additions to wave-3 catalogue)

11. **Single-attempt latch for periodic schedulers** — When a "run-once-on-mount" scheduler can transiently fail, latching only on success creates a retry storm on every re-render. For best-effort weekly/monthly schedulers, latch on any attempt outcome and trust the next session to retry.

12. **Re-entrant subscription handling** — When a hook subscribes to a multi-event topic and the user can re-trigger it (export, run, search), tear down the prior subscription set at entry of the new call. Don't trust the unmount cleanup alone — it only sees the latest set.

13. **try/finally for resource teardown** — Any function that allocates a DOM element, opens a file handle, or creates a long-lived object should wrap the body in `try/finally` so the cleanup runs on the error path too. Cleanup at the end of the function alone is success-path-only.

14. **Transient-state retry windows** — Async navigation frequently produces brief "missing" states (anchor disconnects, target re-mounts). Treating the first missing sample as fatal makes legitimate flows look like bugs. Add a small retry window (a few attempts × few hundred ms) before declaring the state actually missing.

15. **Single-timer invariant for UI flag timers** — `setTimeout(setFlag(false), Nms)` is a recurring leak source. Always: store handle in a ref, clear-then-set on every invocation (so rapid clicks don't stack), and clear in an empty-deps `useEffect` on unmount.

---

## What remains (per INDEX themes)

Waves 1-4 have closed all 25 criticals and ~7 high-severity items in the cleanup-gap theme. The remaining ~200 findings cluster as:

- **Optimistic update without rollback** (~22) — partly addressed by wave 1's templates fix; ~20 more remain. A focused wave introducing a `withRollback()` helper would close many.
- **Silent-success theater** (~20) — caught errors swallowed without user-visible feedback. Mechanical audit per `catch {}` block.
- **Race-window producing wrong result** (~18 remaining after waves 2-3 closed many) — seq-counter inconsistency, watchdog edge cases.
- **Time / timezone / DST** (~12) — best done in one session that introduces a shared tz helper.
- **Empty-set / divide-by-zero / NaN propagation** (~15) — KPI math, leaderboard scoring; localised to overview.
- **Cleanup-gap tail** (~20 lower-severity instances of the patterns now codified above).
- Plus per-context tail items not in any theme.

The pattern catalogue (now 15 items) is the most valuable durable artefact from these four waves. Future runs should `grep` for these shapes proactively rather than rely on bug-hunt re-scans.
