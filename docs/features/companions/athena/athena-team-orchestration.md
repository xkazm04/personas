# Athena as team orchestrator (post-run reconciliation)

Status (verified 2026-09-06): **shipped.** Both halves this document
described now exist in code; the "ready to build" section below is a record of
the design that was built, not of pending work.

**What shipped**

- **Post-run reconciliation (the hook this doc was written for).** Frontend
  bridge `src/features/plugins/companion/useAthenaAssignmentReconciliation.ts`,
  mounted once in `src/features/shared/chrome/BackgroundServices.tsx:47`. It
  listens on `EventName.TEAM_ASSIGNMENT_PROGRESS`, fires on assignment-level
  (`step_id === null`) transitions into `done` / `failed` / `awaiting_review`,
  and dedupes per `(assignmentId, status)`.
- **The command** `companion_record_assignment_outcome(assignmentId)`,
  `src-tauri/src/commands/teams/assignments.rs:102-125`, registered at
  `src-tauri/src/lib.rs:988`, wrapped by `src/api/companion/bridges.ts:130`. It
  resolves `companion_op_id` from the DB, returns `false` for any assignment
  that has none (every team-UI assignment), builds a digest of title + status +
  goal + numbered per-step `[status] title` lines, and records it through
  `companion::orchestration::operative_memory::memory().complete_operation_with_summary(op_id, digest, failed)`.
- **Athena's channel write path.** `companion_post_team_message`
  (`src-tauri/src/commands/teams/team_channel.rs:1253`, `author_kind='athena'`,
  `consumer='inject'`) and the `post_team_message` approval-executor arm
  (`approval_lifecycle.rs:264` → `approval_exec_core.rs:1667`).
- **The `@athena` composer mention**, now in the Fleet Monitor channels surface
  rather than the teams module:
  `src/features/fleet/monitor/channels/ConversationComposer.tsx:108-118` detects
  `@athena` and pushes a pending prompt telling her to reply into that team's
  channel.
- **Autonomous channel reactions** (not in the original design):
  `src-tauri/src/companion/athena_reaction.rs` +
  `engine::subscription::AthenaChannelReactionSubscription` let Athena decide,
  as a headless CLI decision, whether to react to a development moment in a
  team channel at all. This is a *second* Athena-in-the-channel path beyond the
  reconciliation hook.

**What did NOT ship, or drifted**

- The optional "synthesise a one-line next-steps via Sonnet" step (item 2 of the
  wiring plan below) was not built; the digest is templated from DB rows.
- `aborted` is a terminal status the orchestrator emits
  (`team_assignment_orchestrator.rs:356`) but is **not** in the bridge's
  `TERMINAL` set (`useAthenaAssignmentReconciliation.ts:7`), so an aborted
  Athena assignment is never reconciled.
- The frontend bridge does **not** consult the cached `source` / `companionOpId`
  as the plan below proposed. The fire decision is server-side: it calls the
  command on every terminal transition and lets it no-op. This was deliberate,
  so the hook works for assignments that were never in the store cache.
- `AUTOAPPROVE_ALLOWLIST` **no longer exists** (removed 2026-08-10,
  `src-tauri/src/commands/companion/approvals/approval_autopilot.rs:10-25`):
  under autonomous mode every proposed action fires, and the capability
  boundary is the dispatcher's `ALLOWED_ACTIONS`. Statements about
  `post_team_message` being "on the autoapprove allowlist" describe a mechanism
  that is gone.
- Related, and worth checking before relying on it: `post_team_message` is
  **not** in `ALLOWED_ACTIONS`
  (`src-tauri/src/companion/dispatcher/catalog.rs:11-...`), so a
  `propose_action{action:"post_team_message"}` is rejected at parse
  (`dispatcher/dispatch.rs:2076`); the string appears nowhere in
  `src-tauri/src/companion/prompt/`, and `companion_post_team_message` has no
  caller under `src/` outside the generated command-name list. Athena's
  channel writes in practice go through `athena_reaction.rs`'s direct
  `channel_repo::create`.

The rest of this document is the original design note, kept for its rationale.

## Division of labour

A team **assignment** (goal → ordered steps routed across personas) runs in
three cooperating layers. Keep them separate — each is good at one thing:

1. **Sonnet — Preview / initial checklist.** `decompose_team_assignment_goal`
   (`src-tauri/src/engine/team_assignment_matching.rs:decompose_goal`) turns the
   plain-language goal + roster into ordered `DecomposedStep`s. One-shot, no
   state. This stays exactly as-is — it's the "what should the team do?" brain.
   Used by both the Orchestrate console (`teamStudioShared.tsx`) and
   `companion_assign_team`.

2. **Deterministic orchestrator — execution.** `team_assignment_orchestrator.rs`
   runs the steps on a background tokio tick loop (≈1s): matches each step to a
   persona (manual / embedding / llm_eval), launches up to `max_parallel_steps`
   executions, handles cascade-skip + per-step review, and drives the
   assignment to a terminal status. It emits `team-assignment-progress` on every
   transition. This is plumbing, not judgement — **do not** put an LLM in this
   loop; it must be predictable and cheap.

3. **Athena — post-run reconciliation (the new hook).** *After* an assignment
   reaches a terminal status, Athena (the companion) reads the run and composes
   a human-facing summary + next-step suggestion into her OperativeMemory /
   brain, so the chat surface can reason about what the team just did. Athena
   does **not** drive the per-step loop; she reflects on the finished run.

```
goal ──Sonnet decompose──▶ steps ──deterministic orchestrator──▶ terminal
                                                                    │
                                                       (this hook)  ▼
                                              Athena reconciles: summary + next
                                              steps → OperativeMemory / chat
```

## Why post-run, not in-loop

Putting Athena in the tick loop would make every step wait on a CLI turn
(slow, expensive, non-deterministic) and couple a critical background loop to
the companion runtime. Post-run reconciliation keeps the loop fast and lets
Athena add value where she's strong: synthesising the outcome and proposing
follow-ups. Athena-*initiated* assignments already carry a `companion_op_id`
(`companion_assign_team`, `source='athena'`) tying the run to an OperativeMemory
operation; reconciliation closes that loop.

## Implementation seam (ready to build)

**Trigger points** — `team_assignment_orchestrator.rs`, where terminal status
is set + emitted (line numbers re-measured 2026-09-06):
- `awaiting_review`: `tick_loop` L639-642
- `done` / `failed`: `tick_loop` L658-659 (plus the loop-crash `failed` at L170-176)
- `aborted`: `resolve_review_abort` L355-356

**Recommended wiring (frontend-driven, mirrors the proven Fleet bridge):**
The frontend already caches each assignment's `companionOpId` + `source` in the
assignment slice, and the global `useGlobalAssignmentProgressListener`
(BackgroundServices) already sees every terminal transition. So the hook lives
on the frontend, exactly like `useFleetCompanionBridge` →
`companion_record_fleet_event`:

1. **New bridge** `src/features/plugins/companion/useAthenaAssignmentReconciliation.ts` (BUILT):
   subscribe to `team-assignment-progress`; when `step_id === null` and status ∈
   {`done`,`failed`,`awaiting_review`} for an assignment whose cached `source ===
   'athena'` (has a `companionOpId`), fire reconciliation **once** per terminal
   (dedupe by assignment id). Mount in `BackgroundServices`.
2. **New command** `companion_record_assignment_outcome(assignmentId)` (BUILT, as `complete_operation_with_summary`; the optional Sonnet "next steps" was not):
   load the `TeamAssignmentDetail`, build a compact outcome digest (goal, per-step
   status + outputSummary, failures), and record it onto the operation via
   `operative_memory::memory()` (e.g. `record_checkpoint` / a new
   `record_assignment_outcome`) keyed by the assignment's `companion_op_id`.
   Optionally synthesise a one-line "next steps" via Sonnet (reusing the
   decompose CLI pattern) — Sonnet for reflection, same as for preview.
3. **Surface**: the existing `CompanionAssignmentCards` / OperativeMemory digest
   (`companion://stream`) then reflects the completed run with the reconciliation
   note; no new chat plumbing required.

**Alternative (backend-only):** add the reconciliation call directly at the
terminal points in the orchestrator (load the assignment, if `companion_op_id`
is set, call the OperativeMemory recorder). Simpler data flow but couples the
orchestrator to the companion module; the frontend-bridge approach keeps that
boundary clean and is the recommended one.

## Scope notes

- Reconciliation should run for **Athena-initiated** assignments
  (`source='athena'`, has `companion_op_id`). Team-UI assignments
  (`source='team_ui'`) have no operation to reconcile into — they surface via the
  live checklist + assignment board instead. (A future enhancement could open an
  ad-hoc op for team-UI runs too.)
- Dedupe is essential: terminal status can be emitted alongside the final
  step event — fire reconciliation once per `(assignmentId, terminalStatus)`.
