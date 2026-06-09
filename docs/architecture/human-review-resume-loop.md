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

1. ✅ **2a (shipped).** `update_status` now returns a `LearnedMemoryRef`
   (`{id, scope, category, title, team_id, persona_id}`); the
   `MANUAL_REVIEW_RESOLVED` event carries it; a global `eventBridge` listener
   raises a **"🧠 Learned: _{title}_"** toast (guardrail / decision / generic by
   category) — so the feedback loop is visible the moment a review resolves.
   Fires only when a NEW memory was written (dedup-skips carry no `learned`).
2. ✅ **2b (shipped).** The toast is now **actionable** — `StandardToast` gained
   an optional `action {label, onClick}` (rendered as an underlined link in
   `ToastContainer`); the Learned toast's **View** navigates to the Knowledge
   (memories) surface where the lesson is **editable/deletable**, so a wrong
   memory is correctable. (Refinement: deep-link to the *exact* memory row /
   the team-memory panel for `scope==team`, rather than the list.)
3. Athena's auto-resolution path also writes the memory but does not yet emit the
   toast event (it resolves in the background); wire it if surfacing is wanted.

## Phase 4 — Suggested actions as real branches

Today `suggested_actions` were inert everywhere except the Quick Answer stepper
(which only recorded the chosen action as a free-text note).

1. ✅ **Dispatch on pick (shipped).** New async command
   `dispatch_review_action(review_id, action)`: resolves the review (approved,
   chosen action recorded), surfaces it (Phase-2 toast + bus), then — **unless
   the review gated a held team step that was just resumed instead**
   (`react_to_review_decision` now returns whether it resumed) — **dispatches a
   follow-up persona run** (`execute_persona_inner`) whose task is "a human chose
   this action: …; carry it out." So picking a suggested action on an *advisory*
   review now actually *does the thing*. Wired through
   `useMonitorData.handleDispatchAction` → `usePendingInteractions` →
   `QuickAnswerBody` → the stepper's action buttons (now a ▶ "Carry out" affordance
   with a "Carrying out: …" toast). Falls back to record-only when dispatch isn't
   wired.
2. ✅ **Carry intent into the loop.** The chosen action is recorded in
   `reviewer_notes` → flows into the `review_decision` event payload AND the
   learning memory content, so future runs condition on *which* branch the human
   chose.
3. ⏳ **Structured branch (follow-up).** A suggested action may later carry a
   typed outcome (`regenerate` | `edit` | `escalate` | `dispatch:<persona/op>`)
   so the dispatch can do something more specific than "re-run with the action as
   the task." Plain strings (today) default to the generic carry-out run.
4. ⏳ **One action model** across all three surfaces (the stepper's carry-out
   buttons are the pattern; Overview + orb adopt `dispatch_review_action` next).

## Phase 5 — Converge the surfaces (incl. the shared renderer, "3")

Keep all three surfaces (orb = ambient one-shot, Quick Answer = fast queue,
Overview = deep workspace) but make them feel like one system:

1. ◑ **Rendering convergence (in progress).**
   - ✅ **Markdown in the Overview** — the Overview was the only surface
     rendering review descriptions as plain `whitespace-pre-wrap`; its triage
     player (`ReviewFocusFlow`), inbox detail (`ReviewDetailPanel`), and
     multi-decision cards (`FocusedDecisionCard`) now use `MarkdownRenderer`,
     matching the orb + Quick Answer.
   - ✅ **One `parseSuggestedActions`** — the three drifting copies collapse to a
     single canonical `@/lib/reviews/suggestedActions` (handles `["…"]`,
     `{"actions":[…]}`, or a delimited string); `reviewHelpers` re-exports it and
     the Quick Answer stepper imports it.
   - ⏳ A single shared "review body" *component* (markdown + context/decisions +
     media + action branches) is the larger follow-up; for now the surfaces share
     the renderer + parser, not one component.
2. ✅ **One action model (5b).** `dispatch_review_action` (Phase 4) is now wired
   into all three surfaces: the Quick Answer stepper, the **Overview** triage
   player (`ReviewFocusFlow` suggested actions → `ManualReviewList.handleDispatchAction`),
   and the **orb** bubble (`useDecisionQueue` surfaces a review's suggested
   actions as numbered dispatching options, capped at 4). Picking a suggested
   action carries it out everywhere; plain approve/reject stays the no-action
   path. Cloud reviews record the choice (no dispatch).
3. ◑ Dead code / attribution.
   - ✅ **Deleted `TriagePlayer.tsx`** (256 lines: a third duplicate
     `parseSuggestedActions` + a duplicate `TriageReview`); `ManualReviewList`
     repointed to the canonical `TriageReview` in `reviewFocusHelpers`.
   - ⏳ Restore `use_case_id` to the `ManualReviewItem` UI type — **speculative**:
     the data exists on the binding but nothing consumes it yet (it would enable
     a future capability filter). Defer until that filter is built.

## Findings from live approval testing (2026-06-09)

Drove real approvals through the exact backend the bubble/stepper invoke
(`dispatch_review_action` via the test-automation bridge) against the live
pending queue, then diffed the DB for the expected reactions.

**What fires correctly on every approval (confirmed):** the review resolves
(status→approved, chosen branch recorded in `reviewer_notes`); the learning
memory is written (team `decision`/imp-7); the `review_decision.approved` event
is published to the bus.

**Gaps uncovered (the user-expected "reaction" — channel / goal / carry-out —
mostly does NOT materialise):**

- **GAP 1 — silent failure on `needs_credentials` personas (~38%: 11/29 pending).**
  `execute_persona_inner` returns `Err` when `persona.setup_status ==
  "needs_credentials"`; the Phase-4 dispatch swallows it (best-effort `warn`),
  so the user sees the "Carrying out: …" toast but **no run spawns and there is
  no feedback**. Fix: surface the block (toast / `raise_incident` "can't carry
  out — needs a credential"), don't swallow.
- **GAP 2 — Phase-1 resume targets the WRONG step.** The held-check keys on the
  review's *linked* step (the one whose execution emitted the review — typically
  `done`), not the assignment's actual *failed* blocking step. Verified: an
  assignment with 4 `done` + 1 `failed` step stayed `awaiting_review` after
  approval (failed step not reset), and a **redundant standalone run** spawned
  instead. Fix: resume the assignment's failed/held step(s), independent of which
  step the review linked.
- **GAP 3 — approval is invisible in the team channel.** The user's #1 expected
  reaction ("message in channels") never happens: `review_decision.*` is on the
  bus but is NOT bridged to `team_channel_messages`. The team sees no "human
  approved/decided X" post (only Athena's own channel reactions appear). Fix:
  bridge review-decisions into the team channel (like `bridge_verdicts_to_channel`).
- **GAP 4 — dispatch spawns a DETACHED run, not assignment-advancing.** Even
  when a run does spawn (ready persona), it's a fresh standalone execution
  disconnected from the team assignment, so the blocked pipeline doesn't advance.
  For team-context reviews, "carry out" should advance the ASSIGNMENT (resume /
  re-dispatch the step), not run the persona in isolation.
- **GAP 5 — no goal adjustment** on review approval (goals are a separate
  decision flow; review decisions don't touch `goal_progress`).

## Deferred — pending a driver

Two items are intentionally NOT built yet because they have no current consumer
and would add ripple/cost for speculative value:

- **Typed action intents** (`regenerate`/`edit`/`escalate`/`dispatch:<op>`):
  requires personas to *emit* structured `suggested_actions` (a prompt + adoption
  cycle) and would change `parseSuggestedActions`'s return type across all three
  surfaces. Today every picked action dispatches the generic carry-out run, which
  is correct for the common case. Build when a concrete intent (e.g. "escalate
  → raise an incident instead of running") is actually needed.
- **One shared review-*body component*** (beyond the shared renderer + parser +
  action model already in place): the three surfaces are *deliberately* divergent
  — ambient orb bubble vs fast popover vs deep workspace (media, multi-decision,
  thread). A single body component that fits all three is low-ROI; the meaningful
  convergence (markdown, parser, dispatch action model) is done.

---

## Files (Phase 1)

- `src-tauri/src/db/migrations/incremental.rs` — add `assignment_id`/`step_id` columns.
- `src-tauri/src/db/models/review.rs` — `CreateManualReviewInput` + `PersonaManualReview` (+ ts-rs).
- `src-tauri/src/db/repos/communication/manual_reviews.rs` — `create()` writes the columns; a `get_team_step_by_execution()` lookup; `react`-side helpers.
- `src-tauri/src/engine/dispatch.rs` — populate the link at review create.
- `src-tauri/src/commands/design/reviews.rs` + `src-tauri/src/commands/companion/approvals.rs` — call `react_to_review_decision` after `publish_review_decision`.
- `src-tauri/src/engine/team_assignment_orchestrator.rs` — reuse `auto_resume_retryable_steps`.
