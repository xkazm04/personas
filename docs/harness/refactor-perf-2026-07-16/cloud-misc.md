# cloud (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 1 findings (0 critical / 0 high / 0 medium / 1 low)
> Context group: App Shell, Settings & Sharing | Files read: 1 | Missing: 0

## 1. Arm-delay approve guard duplicated between the two app-root approval modals
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/cloud/RemoteApprovalPrompt.tsx:19
- **Scenario**: `APPROVE_ARM_DELAY_MS = 450` plus the disarm-on-new-item effect (`setArmed(false)` → `setTimeout(setArmed(true))` → cleanup) is implemented twice, character-for-character in intent: here (lines 19, 62–67) and in `src/features/settings/sub_api_keys/components/PairApprovalModal.tsx` (lines 24, 35, 55–64), whose own doc comment says it "mirrors RemoteApprovalPrompt".
- **Root cause**: The pairing modal was written by copying the remote-approval pattern rather than extracting the shared safety mechanism.
- **Impact**: If the arm-delay value or the double-tap-guard semantics are ever tuned (e.g. after a UX complaint), one of the two security-relevant approve gates will silently drift from the other. Both are queue-of-requests approval modals mounted at the app root, so the drift risk is real, though the code volume is small (~10 lines each).
- **Fix sketch**: Extract a `useArmedApprove(currentKey: string | undefined, delayMs = 450): boolean` hook (e.g. in `src/hooks/`), returning `armed`; both modals call it keyed on `current?.id` / `nonce` respectively. PairApprovalModal keeps its extra per-request resets (scopes/expiry/busy) in its own effect. Verify no other consumers before choosing the hook location.

Notes: `RemoteApprovalPrompt` is confirmed live (mounted at `src/App.tsx:384`); Zustand subscriptions use narrow selectors, both effects clean up their timers/listeners, and the component renders null when idle — no perf-optimizer findings survived review.
