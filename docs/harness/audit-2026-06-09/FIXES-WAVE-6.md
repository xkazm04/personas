# Audit Fix Wave 6 — Corruption loops & stream/graph integrity

> 5 commits, 5 of 7 critical findings closed; 2 deferred (multi-site refactor / risky stream-flow change).
> Theme: feedback loops that poison data, non-atomic mutations, and graph/stream integrity.
> Baseline preserved: `cargo check --features desktop` clean; `tsc --noEmit` 0; eslint clean on changed TS.
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `967c84a25` | personal-twin #1 — self-reinforcing memory loop | `twin/sub_channels/ReplyOutbox.tsx` |
| `37da4ad6c` | persona-authoring #2 — delete-confirm survives switch | `sub_editor/hooks/useEditorDraft.ts` |
| `f29f254ea` | composition #1 — cycle runs anyway | `commands/teams/teams.rs` |
| `a9656bdd0` | agent-memories #1 — non-atomic proposal apply | `commands/core/memories.rs` |
| `1819cf790` | onboarding #6 — first-run state not persisted | `stores/slices/system/onboardingSlice.ts` |

## What was fixed

1. **twin #1 — corruption loop.** Approving a twin-authored outbound reply called `recordInteraction` without `createMemory` (defaults `true` in Rust), so the twin's OWN generated text was queued as a memory → compiled into wiki/distilled facts → grounded the next reply (compounding each cycle). The approve path now passes `createMemory:false`.
2. **persona-authoring #2 — wrong-persona delete.** `showDeleteConfirm` was reset only on deselect, never on a persona *switch*; an open delete dialog from persona A (clean → switches immediately) rendered over B and `handleDelete` deleted the live `selectedPersona` (B). The switch effect now resets it.
3. **composition #1 — cycle runs anyway.** A non-feedback cycle was detected, warned, then `execution_order.extend(cycle_nodes)` ran the cyclic nodes once in arbitrary order with no real upstream inputs (fake-success that poisons team memory). Cycle detection is now a hard stop: mark the run `failed` (mirroring the empty-members path) and return.
4. **agent-memories #1 — non-atomic apply.** Proposal apply ran all deletes/bumps then `mark_applied` last; a crash/double-click/concurrency mid-way left it `pending_review` forever (re-applies, double-counts) and two Apply clicks both executed. `mark_applied` (already an atomic `WHERE status='pending_review'` CAS) now runs FIRST; only the winner mutates.
5. **onboarding #6 — first-run re-prompt.** `onboardingCompleted`/`onboardingDismissedAtStep` were in-memory only, so a reload/restart reset them (completed user re-prompted via a guard racing `fetchPersonas`; dismissed user couldn't resume). Both markers now persist to localStorage (try/catch-guarded, mirroring tourSlice) and hydrate on init.

## Verification

| Gate | Result |
|---|---|
| `cargo check --features desktop` | clean, 0 errors |
| `tsc --noEmit` | 0 |
| `eslint` (staged TS) | clean (ran via lefthook on the TS commits) |
| `cargo test --lib` / `vitest` | pre-existing failures only, untouched files |

## Deferred (2 of 7)

- **lab #2 — wrong version attribution.** `run_eval_test`/`run_ab_test` use `format!("v{}", version_number)` as the join key between a variant and its persisted result; two versions sharing a `version_number` (a separate non-atomic allocation) collide and `find()` returns the first for both, mis-attributing scores. The clean fix is to carry the unique `version_id` on `LabVariant` (6 construction sites across arena/eval/ab/matrix + the struct + persist closures) and resolve by it. Multi-site refactor for a rare-trigger collision — deferred to do correctly with the version_number allocation made atomic too.
- **persona-chat #1 — stream-listener race / chat hang.** Listeners attach *after* `executePersona` + several dynamic `import()`s, so a fast/`--resume`/error turn's terminal `execution-status` fires in the gap, is missed, and the chat hangs forever (reply unsaved). The fix (register listeners before execute, filtering by `clientRequestId`; or reconcile via `getExecution` and synthesize the finalize from the persisted log) is a careful change to the chat-streaming finalize in `chatSlice.ts` + `backgroundChatSlice.ts` that must be validated at runtime — deferred.

## Patterns reinforced (catalogue, continued)

21. **Machine output is not knowledge.** Never auto-feed an agent's own generated text back into its memory/training inputs; default such side-effects OFF and require explicit opt-in.
22. **UI confirm-state must be scoped to its target.** A confirm dialog whose action resolves the target lazily from a live selector must be reset whenever that selector changes, or it acts on the wrong entity.
23. **Detect-then-warn-then-do is not a guard.** Cycle/precondition detection must be a hard stop (fail the run), not an advisory log followed by running anyway.
24. **CAS the status before the batch, not after.** Flip the consuming status first (atomic `WHERE status=expected`); only the winner runs the mutations — so a crash/concurrency can't re-run or wedge the batch.
25. **First-run / completion flags must be durable.** "Have we onboarded this user?" needs a persisted answer, not in-memory state read against a race-prone async signal.

## Cumulative status (Tier-1, all six fresh waves complete)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Lost-update writes | 8 / 8 |
| 2 | Transition guards & lock leaks | 5 / 7 |
| 3 | Success theater / silent failure | 4 / 7 |
| 4 | Orphaned processes & recovery gaps | 5 / 5 |
| 5 | Security | 6 / 7 |
| 6 | Corruption loops & stream/graph integrity | 5 / 7 |
| | **Tier-1 criticals fixed** | **33 / 41** |

**Deferred Tier-1 criticals (8)** — each needs runtime-validated infra or a multi-site/protocol change: p2p #1 (signed handshake), teams #1 (orchestrator live-guard) + teams #2 (cancellation token), events #1 + events #2 (delivery tracking), composition #6 part b (approval channel), research #1 (durable run row), lab #2 (version_id join key), persona-chat #1 (stream-listener race). All are documented with concrete fix sketches in the per-wave docs + harness-learnings.

Remaining audit scope: the **19 UI criticals** (Tier-2, waves 7–9 in the INDEX) and the **169 highs** (Tier-3).
