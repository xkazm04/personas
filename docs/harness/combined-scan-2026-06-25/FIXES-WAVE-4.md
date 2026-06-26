# Combined-Scan Fix Wave 4 — Races & double-execution

> 6 atomic commits, 6 findings closed (1 Critical + 5 High) — **no deferrals this wave**.
> Dispatched as 6 parallel edit-only fix-subagents (3 frontend + 3 Rust, disjoint files).
> Baseline preserved: **cargo executions 9/0 + lib compile, tsc 0, vitest 1972 pass / 7 pre-existing fail (no regressions)**.

## Commits

| # | Commit | Finding | Severity | Stack |
|---|---|---|---|---|
| 1 | `5f8ad45b4` | cockpit-voice #1 (STT mic strand) | **Critical** | FE |
| 2 | `3e77f730b` | execution-runner #1 (idempotency double-spawn) | High | FE |
| 3 | `d28d0bcd3` | shared-ui (Button/AsyncButton double-submit) | High | FE |
| 4 | `2c5d3e695` | repositories #1 (idempotency TOCTOU) | High | Rust |
| 5 | `e4f705e13` | companion-brain #1 (wake-gate double-fire) | High | Rust |
| 6 | `0a16cc92d` | companion-runtime #1 (Ask-Athena dropped turn) | High | Rust |

## What was fixed

1. **STT engine-switch strands the mic (Critical).** Flipping the STT engine mid-capture swapped `useHoldToTalk`'s `dictation` ref, leaving the old `useLocalDictation` capturing forever (mic indicator on, transcript dropped). Added an effect (keyed on `engine`, gated on `prev.listening`) that force-stops the now-inactive hook on any engine change, + a `voiceCaptureActive` flag that disables the engine buttons mid-capture.
2. **Idempotency key regenerated every call → double-spawn (High).** A stable foreground pending-key slot (keyed by a signature of personaId/useCaseId/inputData/continuation) now reuses the key across a timeout-retry so the backend re-attaches instead of spawning a second run; cleared on terminal/cancel so deliberate re-runs still mint fresh. (Active no-retry polling-recovery left as a follow-up.)
3. **Button/AsyncButton double-submit (High).** A synchronous in-flight `ref` (set at click time, reset in `finally`) ignores re-entry while a thenable-returning `onClick` is pending — only for async handlers, so sync steppers/toggles still fire every click. Honors AsyncButton's "disables itself" claim.
4. **Idempotency repo TOCTOU (High).** `create_with_idempotency` switched to `INSERT … ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING` + re-select on conflict, so a legitimately-idempotent race returns the existing row instead of a spurious DB error. NULL-key path unchanged.
5. **Wake-gate double-fire (High).** `triage_unread_messages` and the `channel_reactions` tick now claim the same process-wide `InflightGuard` `exec_triage` uses, so concurrent reachability can't double-fire the autonomous CLI (cost runaway / duplicate posts / skipped unread).
6. **Ask-Athena turn dropped (High).** `send_turn`'s lock arm now treats user-initiated `External` like `User` (block-acquire `TURN_LOCK`) instead of `try_lock`-and-drop; autonomous/proactive ticks keep `try_lock` so they self-skip when busy (no pile-up, no deadlock).

## Verification

| Gate | Result |
|---|---|
| `cargo test --lib executions` | 9 pass / 0 fail + full lib compile |
| `tsc --noEmit` | 0 errors |
| `vitest run` | 1972 pass / 7 pre-existing fail — **no regressions** |
| `eslint` (pre-commit, FE files) | clean |

## Patterns established (catalogue items 12–14)

12. **Reactive disable ≠ a submit guard** — disabling a button via a state/prop that only takes effect on the next render lets a fast double-click fire twice. The guard must be a *synchronous* ref set at event time, not reactive state.
13. **Identity swap mid-lifecycle leaks the resource** — when a hook/handle is selected by a changing value (engine, mode), swapping the selection while the previous instance holds a resource (mic, socket) strands it. Tear down the previous instance on identity change, don't rely on unmount.
14. **try_lock buckets user intent with background work** — using `try_lock`-and-drop for everything except one origin silently discards genuinely user-initiated requests under contention. User actions must block-acquire (or queue + surface); only background ticks should self-skip.

## Cumulative status (Waves 1–4)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1 | Security — code-exec / SSRF / path-safety | 5 (2C/2H/1M) |
| 2 | Auth / trust-boundary | 6 (2C mitigated+deferred / 4H) |
| 3 | Scheduler + watermark/sync | 4 closed (1C/3H) + 1H deferred |
| 4 | Races & double-execution | **6 closed (1C/5H)** |

**Total: 21 findings addressed across ~21 atomic fix-commits**, branch `vibeman/combined-scan-2026-06-25`, **0 regressions**.
**Deferred follow-ups:** 2 Critical (BYOM tag source, template codegen) + 1 High (cloud-sync migration) + 1 minor (idempotency timeout-recovery).
**Remaining working set:** ~67 High + Med/Low tail. Next: Wave 5 — Silent failures & success-theater (genome retry storm, self-healing↔rollback prompt clobber, template/team adoption swallow, incident dedup, orb-decision swallow).
