# Human-review handling — resume loop, visible learning, action branches, convergence

Status: **design + Phase 1 in progress** · 2026-06-08

This is the phased plan for evolving the three human-review surfaces (Athena orb
decision bubble · Quick Answer popover · Overview `sub_manual-review`) from
"approve = flip a status" into a real human-in-the-loop control plane. Phases run
in the order **1 → 2 → 4 → 5** (numbering follows the original analysis; "3" —
one shared renderer — folds into Phase 5).

## The structural truth (why this is subtle)

There are **two disjoint "review" concepts** in the backend, and they share no row,
status, or resume path:

| | **A. `persona_manual_reviews`** (the human-review queue) | **B. team-assignment `awaiting_review`** (soft-pause) |
|---|---|---|
| Created by | persona emits `request_review` | a team **step fails** (or no eligible persona) |
| Blocks the run? | **NO** — execution runs to completion | yes — the assignment tick-loop stops |
| Row | `persona_manual_reviews` (`status=pending`) | `team_assignments.status='awaiting_review'` (no review row) |
| Resolve | `update_manual_review_status` → publishes `review_decision.*` | `resolve_team_assignment_review(step_id, action)` (already resumes) |
| Resume wired? | **NO consumer of `review_decision.*`** | yes (step-id keyed) |

Consequences that the design must respect:
- A manual review usually has **no blocked work to resume** — the run already
  finished. "Resume" for the advisory case means **dispatch the follow-up
  action** (Phase 4), not literally un-pause.
- The genuinely-blocked work (B) is already resumable, but **only** via the
  `step_id` path in the channel's `ReviewInterventionCard`, not through the
  review queue.
- `review_decision.{approved|rejected|resolved}` is **published, registered, and
  consumed by nobody** (`reviews.rs:publish_review_decision`,
  `approvals.rs:execute_resolve_human_review`). It is the symmetric hook for both
  human and Athena resolution. **This is where the reaction plugs in.**

The only review→work link today is `persona_manual_reviews.execution_id`; there
is **no `assignment_id`/`step_id`** on the row. For a team-step execution the join
`execution_id → team_assignment_steps.execution_id → assignment_id` exists, but
it's absent for standalone runs and fragile across step finalization.

---

## Phase 1 — Close the resume loop (the reaction hook)

**Goal:** resolution does something to the work, via a single reaction shared by
the human and Athena paths. Build the missing consumer of `review_decision.*` and
the durable review→step link.

1. **Schema link.** Add nullable `assignment_id` + `step_id` to
   `persona_manual_reviews` (incremental migration). Populate them at review
   **create** time in `dispatch.rs` (ManualReview arm) by looking up
   `team_assignment_steps WHERE execution_id = ctx.execution_id` — no
   DispatchContext threading needed; the join already exists. ts-rs binding
   regenerates `PersonaManualReview`.
2. **The reaction.** A shared `react_to_review_decision(pool, app, engine,
   embedding, &review)` called at both resolution chokepoints (right after
   `publish_review_decision`). Semantics:
   - **Approve** → if the review links a team step that is currently *held*
     (assignment `awaiting_review` / step `failed`), call
     `team_assignment_orchestrator::auto_resume_retryable_steps(assignment_id,
     [step_id])` (resets `failed→pending`, restores cascade-skipped dependents,
     re-spawns the tick loop). If nothing is held → **no-op** (advisory review;
     Phase 4 will dispatch the chosen action here).
   - **Reject** → Phase 1 records only (conservative — no auto-abort). A later
     increment maps reject → `resolve_review_skip`/`resolve_review_abort` behind
     an explicit choice.
   - Call the orchestrator function **directly** (not the `resume_team_assignment`
     command, which rejects `awaiting_review`).
3. **Observability.** Emit a `review_resume.*` breadcrumb event + `tracing` line
   so the reaction is visible in the daily log and the channel.
4. **Safety.** Always-on is safe — the reaction only resumes work that is *already
   held*; advisory reviews are untouched. No new "block until reviewed" state in
   Phase 1 (that's a separate, larger opt-in — see Deferred).

**Deferred from Phase 1:** making `request_review` actually *pause* its
execution/step ("block until reviewed") — requires new waiting state in the
runner + orchestrator; revisit only if the advisory model proves insufficient.

## Phase 2 — Visible, correctable learning

`manual_repo::update_status` already writes a learning memory (team → shared
`team_memories` decision/imp-7 or constraint/imp-8; solo → `learned`/imp-5) — but
it is **silent and unverifiable**.

1. `update_status` returns the created memory id (or `MANUAL_REVIEW_RESOLVED`
   carries it).
2. The resolving UI (Quick Answer stepper first, then Overview + orb) shows a
   transient **"Learned: _{decision|constraint}_"** confirmation with a link to
   open the memory.
3. The memory is **editable/deletable** from that link (reuse the memory editor),
   so a wrong lesson is correctable — this is the trust win.

## Phase 4 — Suggested actions as real branches

Today `suggested_actions` are inert everywhere except the Quick Answer stepper
(which records the chosen action as a free-text note).

1. **Structured branch.** A suggested action may carry an outcome intent
   (`approve` | `regenerate` | `edit` | `escalate` | `dispatch:<persona/op>`).
   Keep plain strings working (default `approve`); parse a typed form when present.
2. **Dispatch on pick.** When an action is chosen, the Phase 1 reaction seam
   dispatches it: advisory reviews `run_persona` a follow-up keyed on the action;
   team-held reviews resume with the action folded into the step edit.
3. **Carry intent into the loop.** Record the chosen branch (not just
   approve/reject) in the learning memory payload + the `review_decision` event,
   so future runs condition on *which* branch the human chose.
4. **One action model** across all three surfaces (the stepper's branch buttons
   become the shared pattern; Overview + orb adopt it).

## Phase 5 — Converge the surfaces (incl. the shared renderer, "3")

Keep all three surfaces (orb = ambient one-shot, Quick Answer = fast queue,
Overview = deep workspace) but make them feel like one system:

1. **One shared "review body" renderer** — markdown + `context_data`/decisions +
   media + suggested-action branches — that degrades by available space. Add
   markdown to the Overview surface (the only one without it); delete the three
   duplicate `parseSuggestedActions`/`parseDecisions` implementations.
2. **One action model** (Phase 4) and **one reaction** (Phase 1) underneath, so
   the surface is purely a presentation choice.
3. Drop dead code surfaced by the analysis (`TriagePlayer.tsx`, duplicate
   parsers); restore `use_case_id` to the UI type for capability attribution.

---

## Files (Phase 1)

- `src-tauri/src/db/migrations/incremental.rs` — add `assignment_id`/`step_id` columns.
- `src-tauri/src/db/models/review.rs` — `CreateManualReviewInput` + `PersonaManualReview` (+ ts-rs).
- `src-tauri/src/db/repos/communication/manual_reviews.rs` — `create()` writes the columns; a `get_team_step_by_execution()` lookup; `react`-side helpers.
- `src-tauri/src/engine/dispatch.rs` — populate the link at review create.
- `src-tauri/src/commands/design/reviews.rs` + `src-tauri/src/commands/companion/approvals.rs` — call `react_to_review_decision` after `publish_review_decision`.
- `src-tauri/src/engine/team_assignment_orchestrator.rs` — reuse `auto_resume_retryable_steps`.
