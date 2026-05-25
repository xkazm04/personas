# Athena as team orchestrator (post-run reconciliation)

Status: **design + seam identified.** The deterministic orchestrator and the
Sonnet decompose ship today; the Athena post-run hook is the next focused,
separately-verified change (it touches the background orchestrator loop + a
new companion command, which want a real multi-persona run to validate).

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
is set + emitted today:
- `awaiting_review` — `tick_loop` ≈ L285-291
- `done` / `failed` — `tick_loop` ≈ L294-301
- `aborted` — `abort` path ≈ L195-196

**Recommended wiring (frontend-driven, mirrors the proven Fleet bridge):**
The frontend already caches each assignment's `companionOpId` + `source` in the
assignment slice, and the global `useGlobalAssignmentProgressListener`
(BackgroundServices) already sees every terminal transition. So the hook lives
on the frontend, exactly like `useFleetCompanionBridge` →
`companion_record_fleet_event`:

1. **New bridge** `src/features/plugins/companion/useAthenaAssignmentReconciliation.ts`:
   subscribe to `team-assignment-progress`; when `step_id === null` and status ∈
   {`done`,`failed`,`awaiting_review`} for an assignment whose cached `source ===
   'athena'` (has a `companionOpId`), fire reconciliation **once** per terminal
   (dedupe by assignment id). Mount in `BackgroundServices`.
2. **New command** `companion_record_assignment_outcome(assignmentId)` (Rust):
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
