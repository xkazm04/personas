---
layer: application
subject: wizard-flows
technique: step-state-model
stack: react
---

# The n8n import wizard's reducer — the step-state model in this repo

The technique's whole shape — steps as data, one engine, guards inside the
transitions — ships in `src/features/templates/sub_n8n/`, and it is the only
flow in the repo that has all of it (the 2026-08-15 `multi-step-flow` census
read 13 flows by hand; this was the one).

## The registry: `useN8nImportReducer.ts`

`WIZARD_STEPS` + `STEP_META` (`:27-43`): five steps declared as a `readonly`
array of a closed union (`N8nWizardStep = 'upload' | 'analyze' | 'transform'
| 'edit' | 'confirm'`), with per-step label and display index in one map.
Step identity is the union member; the index is display metadata, exactly
the technique's "indices are a rendering concern". Every consumer — the
renderer's switch, the slide-direction animation (`useN8nWizard.ts:48-52`
derives direction from `STEP_META[state.step].index`), the resume badge —
reads this one declaration.

## Guards inside the transition: `reducers/navigationReducer.ts`

- `checkStepPrecondition` (`:15-35`) — one function answering "may we stand
  on step X given only the data we have", returning a *reason string* (the
  blocked-affordance text) rather than a bare boolean.
- `GO_TO_STEP` (`:73-77`) — runs the precondition and **returns the
  unchanged slice on failure**. This is the repo's only genuinely
  un-bypassable forward navigation: rail, button, keyboard, and restore all
  dispatch the same action, so a new caller cannot skip the guard.
- `fallbackStepForData` (`:44-51`) — the clamp, explicitly documented as
  "centralized so the session-restore call site and the reducer's own
  fallback can't silently diverge". One authority for "where can we land",
  shared by resume and error paths.

The pointer is mirrored to the session row it belongs with —
`useN8nSession.ts:120-148` debounces a step+payload sync (reading the
*freshest* state at write time to avoid persisting a stale snapshot), and
`:200-219` flushes on unmount so the last transition survives. Pointer and
side effects in the same durable home.

## The same model driving keyboard advancement: the adoption questionnaire

`src/features/templates/sub_generated/adoption/questionnaire/QuestionnaireForm.tsx`
shows the derived-predicate half of the technique:

- `answeredCount`, `blockedCount`, `canSubmit` (`:51-67`) are all
  derivations over `questions × userAnswers` — no exit-stamped flags
  anywhere. `blockedCount` even documents *why* it subtracts answered
  questions from the vault-derived blocked set (`:55-66`).
- Transitions are named callbacks — `next`/`prev`/`jumpToCategory`
  (`:88-103`) — and the keyboard layer
  (`useQuestionnaireKeyboardNav.ts:69-88`) drives the *same* functions
  through the *same* guards: Enter submits only when `isAtEnd && canSubmit`,
  advances only when `currentAnswered`. One event vocabulary, two input
  devices.
- Initial position lands on the first *unanswered* question deliberately
  including blocked ones (`:41-47`, with the rationale in the comment) —
  the blocked step is where the user must act, so the flow lands them on
  it.

## Deviations on file

- **`ScrapeEditorWizard.tsx` is the counter-example**: the rail jumps to
  any step with a bare `onClick={() => setStep(i)}` (`:42`) and no
  precondition anywhere in the component; the flow is saved only by
  `ScrapeEditorModal.tsx:27` re-checking at the terminal action. Its
  `stepComplete(form, s.id)` markers *are* derived predicates — the
  registry half is right and the guard half is absent. Census rule
  `ungatable-step-transition` (9 sites, precision 9/9) gates exactly this
  shape.
- **The shared primitives are not the destination.** `useWizardReducer.ts`
  has zero live consumers and its `goToStep` has no precondition hook;
  `WizardStepper.tsx`'s two render sites are both inside a modal imported
  nowhere. The legacy golden path's Gap 2 measured all three candidates;
  the reusable artifact here is the navigationReducer *shape*, not a
  component — which is the technique's cross-codebase observation landing
  in this repo.
- **`useTrainingSession.ts` keys position by array index** (`currentIdx`)
  while inserting follow-up questions mid-array (`:252-255`); it stays
  correct only because insertion happens at `currentIdx + 1` and
  navigation is immediately re-derived. The QA pairs themselves carry
  minted ids (`fu-${Date.now()}`), so the identity discipline is half
  observed — ids on the entities, index on the pointer.
