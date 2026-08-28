---
layer: golden-path
subject: wizard-flows
status: forged
techniques:
  - step-state-model
  - snapshot-and-resume
  - progress-communication
  - branching-and-skipping
  - ai-driven-elicitation
  - commit-boundary
evidence:
  - src/features/templates/sub_n8n/reducers/navigationReducer.ts          # precondition inside the transition (GO_TO_STEP returns unchanged slice on failure) + one shared clamp for restore and fallback
  - src/features/templates/sub_n8n/hooks/useN8nSession.ts                 # durable pointer: debounced sync of step+payload to the session row, unmount flush
  - src/features/templates/sub_generated/adoption/questionnaire/useQuestionnaireKeyboardNav.ts  # guarded keyboard advancement (QuestionnaireForm.tsx, the unmounted composition, was deleted in e1eeeffa7)
  - src-tauri/core/src/models/build_session.rs                            # server-side resumable FSM: AwaitingInput phase, validate_transition, durable pending_question, hydration payload
  - src/features/plugins/twin/sub_training/useTrainingSession.ts          # generated interview: rubric coverage scoring, one-bounded follow-ups, per-answer promotion to durable memories, static fallback on generator failure
  - src/hooks/utility/data/usePersistedContext.ts                         # re-attach to an in-flight background job by id, max-age expiry of stale contexts
counter_evidence:
  - src/features/shared/components/progress/WizardStepper.tsx             # the shared stepper: two-state markers, non-interactive, open label type — and zero live render paths
  - src/features/scraper/ScrapeEditorWizard.tsx                           # rail jumps to any step unguarded; the flow is saved only by a terminal re-check outside it
deviations:
  - w3-wizard-flows   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Wizards & guided steppers

A wizard is the surface you reach for when the user's job is **completing a
staged commitment**: a sequence of decisions in which later questions depend
on earlier answers, converging on one high-stakes commit at the end. The two
properties that define the shape are *dependence* — the steps are genuinely
ordered because each one reshapes or unlocks what follows — and *deferral* —
nothing irreversible happens until the user has seen the whole picture and
confirmed it.

That definition decides when a wizard is wrong, and it is wrong more often
than it is built:

- **A form wearing pagination** is the canonical mistake. Ten independent
  fields split across four screens is not a wizard — it is a worse
  [form](../form/form.md) with extra clicks, a progress bar measuring nothing,
  and four chances to lose the draft instead of one. The boundary is not
  field count; it is *dependence* and *commit weight*. If every step could be
  shown at once with no loss of meaning, show them at once.
- **A settings surface** where each value is independent and cheaply
  reversible needs no sequencing and no final confirm — sequencing it forces
  the user to march through decisions they did not come to make.
- **A confirmation dialog** when there is only one decision. A wizard with
  one real step is a dialog with a walk-up.

The failure modes in both directions are real: paginated forms tax every
mutation with ceremony, and single-screen surfaces stretched over genuinely
dependent decisions force the user to hold the dependency graph in their
head — or to commit half-consistent answers the surface never sequenced.

Two structural properties separate a wizard from the long form it
superficially resembles, and both are covered by this subject because both
are where implementations rot:

1. **State is owned across steps, not by screens.** The steps are views over
   one model; no answer lives in a screen's local memory.
2. **Interruption is the normal case, not the exception.** The flow is
   designed to be abandoned mid-way and picked up later — because it will be.

## One model owns every step

The single most common wizard defect is per-screen state: each step keeps its
own answers in local memory, passes a bundle forward on "next", and dies on
unmount. Everything a wizard must do — go back without losing the later
steps, jump via the step indicator, resume after restart, validate the whole
before commit, derive which steps are reachable — is either trivial or
impossible depending on this one decision. A wizard navigates constantly;
screen-local state turns every navigation into a data-loss opportunity.

The standard: **one owned state model** — a reducer or state machine —
holding the answers, per-step validity, the current position, and the visited
set. Steps render from it and dispatch events into it. Screen-local state is
permitted only for presentation transients (which panel is expanded, scroll
position) that no other step and no resume path will ever need. The full
treatment, including step identity and derived navigability, is the
[step-state-model](techniques/step-state-model.md) technique.

The corollary reaches validation: each step's validity is a predicate over
the model, evaluated on demand — not a flag a screen sets on its way out. A
validity flag written at navigation time is stale the moment an earlier
answer changes; a predicate is always current.

## Interruption is the normal case

Forms are usually completed in one sitting; wizards, by their weight, are
not. The user is interrupted, closes the surface, restarts the application,
or parks the decision for three days. A wizard that treats this as an edge
case — restart from step one, answers gone — teaches users to fear starting
it, which for a high-stakes flow means they defer the commitment the wizard
exists to collect.

The obligation is proportional, and the proportion has a rule: **state lives
where the side effects live.** A short flow that creates nothing until its
final commit may honestly hold everything in memory and die with its
surface — nothing was promised, so nothing is lost, and persistence
machinery bolted onto it is complexity that rots unused. But the moment any
step makes something real — spends money, launches work elsewhere, collects
answers expensive enough that re-asking is a real cost — the flow owes
durability, and the position pointer must live in the same durable place as
the effects, because a pointer that dies while the effects survive is how
users create half of something and never find their way back to it.

For the flows on the heavy side of that line, the standard is **snapshot +
resume, not restart**: the state model is serialized at meaningful
boundaries, stamped with the flow's identity and
schema version, and offered back on return — explicitly, as a choice, never
as silent restoration of who-knows-what. When a step launches long-running
work elsewhere in the system, the snapshot carries that work's identity so
resume *re-attaches* instead of re-running. Persistence tier is a real
decision — local drafts for convenience, system-of-record state when the
flow has effects in flight — and stale snapshots expire on a named schedule.
The [snapshot-and-resume](techniques/snapshot-and-resume.md) technique owns
all of it.

Wizards that pause for another party's decision — an approval, a provided
credential, an answer only a human reviewer can give — inherit the
continuation discipline of
[resume-after-decision](../hitl-approval/techniques/resume-after-decision.md):
the pause is durable state, the resume needs nothing from the process that
paused, and what runs after the answer is what was staged before it.

## The progress contract

A wizard asks the user to invest in a sequence whose end they cannot see.
The price of that ask is a standing answer to four questions, visible at
every step:

- **Where am I** — current position, named, not just numbered.
- **What remains** — the steps ahead, honestly counted. When branching makes
  the count provisional, the display says so rather than presenting a moving
  number as a fixed one.
- **What is blocked, and by what** — a step the user cannot enter names its
  prerequisite. The wizard-scale version of the form standard's prohibition
  on disabled-submit-as-error-surface: a greyed step with no explanation
  makes the user hunt for the blocker.
- **What did I already say** — earlier answers are visible and revisitable;
  a wizard that hides completed steps demands the user trust their own
  memory at exactly the moment it asks for a commitment.

The rendering of this contract — indicators, category rails for long flows,
completion markers that distinguish valid from merely visited — is the
[progress-communication](techniques/progress-communication.md) technique.

## Branching, skipping, and the cost of going back

The dependence that justifies a wizard also complicates it: answers reshape
the path. Conditional steps appear and disappear; a changed early answer can
invalidate later ones. The standard demands this be *modeled*, not
improvised: step relevance is a declared predicate over the answers; a
skipped step's data is excluded from the commit by derivation, never left to
ride along invisibly; and revisiting an earlier step invalidates precisely
its dependents — with a warning before anything is discarded — not
everything after it, and not nothing. Wizards that forbid going back have
not avoided this problem; they have selected restart as their only edit
mechanism. The [branching-and-skipping](techniques/branching-and-skipping.md)
technique owns the semantics.

## Elicitation can be generated; the flow may not be

A newer variant replaces the fixed question list inside a step with a
generative interviewer: the machine reads the answers so far and asks the
next most useful question. This changes where questions come from — it must
not change who owns the flow. Step boundaries, completion criteria, and
navigation stay with the owned model; the generator proposes content, and
its claims about coverage are measured by the flow, never taken on faith.
Coverage is an explicit score against a declared rubric, answers are
promoted into durable typed state at explicit points, and a generator
failure is distinguishable from a completed interview. The
[ai-driven-elicitation](techniques/ai-driven-elicitation.md) technique draws
the lines.

## Nothing irreversible before the commit

The wizard's closing move is its reason for existing: the accumulated draft
is shown whole — assembled from the same model that will be committed, not
re-summarized from memory — and applied as one act on confirm. Before that
boundary, everything is a draft; after it, the flow is over and its
snapshot is cleaned up. Where a step genuinely must create real resources
early (some validation only the real system can perform), those resources
are provisional and every exit path — cancel, expiry, abandonment — reaps
them. And when the commit is physically multi-part, partial failure is
reported precisely: what applied, what did not, what to do next. The
[commit-boundary](techniques/commit-boundary.md) technique owns the review
step, the apply, and the failure reporting.

## Accessibility posture

A wizard is navigation-heavy by design, which concentrates its accessibility
obligations on the transitions:

- **Step changes move focus** — to the new step's heading or first control.
  A silent content swap under a stationary focus strands assistive users on
  a page that no longer exists.
- **Step changes are announced** — the new step's name and position, so the
  progress contract is available to ears as well as eyes.
- **The step indicator is honest about interactivity.** Steps that can be
  jumped to are real interactive elements with their state (current,
  complete, blocked) exposed programmatically; steps that cannot be entered
  say why, to everyone.
- **Keyboard advancement is first-class.** The primary action (next,
  confirm) is reachable and triggerable without a pointer; where a step is
  a single choice, selecting it may advance — but the same affordance must
  exist for keyboard users, not only for clicks.
- **Within a step, form accessibility applies unchanged** — labels, error
  association, focus-to-first-invalid on a failed step validation, exactly
  as the [form](../form/form.md) standard prescribes.

## The techniques

- [step-state-model](techniques/step-state-model.md) — one reducer/machine
  owning answers, validity, and position; step identity; navigability as a
  derivation.
- [snapshot-and-resume](techniques/snapshot-and-resume.md) — durable drafts,
  resume by identity, re-attaching to in-flight work, snapshot expiry and
  version skew.
- [progress-communication](techniques/progress-communication.md) — the
  standing answer to where-am-I / what-remains / what's-blocked-and-why.
- [branching-and-skipping](techniques/branching-and-skipping.md) —
  conditional steps as declared predicates, skipped-data hygiene, downstream
  invalidation on revisit.
- [ai-driven-elicitation](techniques/ai-driven-elicitation.md) — generated
  questions inside an owned flow: coverage scoring, bounded follow-ups,
  promotion to durable state.
- [commit-boundary](techniques/commit-boundary.md) — review-before-commit,
  the all-or-nothing apply, provisional resources, partial-failure
  reporting.
