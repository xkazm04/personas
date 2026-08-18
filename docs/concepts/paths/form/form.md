---
layer: golden-path
subject: form
status: forged
techniques:
  - validation-timing
  - field-composition
  - error-aggregation-and-focus
  - submit-lifecycle
  - server-error-mapping
evidence:
  - src/features/shared/components/forms/FormField.tsx        # the field unit: label+control+feedback, timing gate, a11y wiring minted once
  - src/features/shared/components/forms/FormErrorContext.tsx  # the form-level error registry (enroll/withdraw, phantom-free on unmount)
  - src/features/shared/components/forms/FormErrorSummary.tsx  # jump-to-field error summary, announced as an alert
  - src/features/shared/components/forms/useAsyncFieldValidation.ts  # advisory availability checks: debounced, superseded-request-cancelled, fail-open
  - docs/concepts/golden-paths/form-field-and-validation.md    # the measured application census this standard reconciles against
counter_evidence:
  - src/features/plugins/research-lab/shared/FormField.tsx     # shadow primitive, same filename, no error slot — the fork the standard exists to prevent
deviations:
  - w1-form   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Form & field validation

A form is the surface you reach for when the user's job is **composing a valid
mutation**: gathering several related values, letting the user work on them as
a group, and committing them to a system of record as one atomic act. The two
words that define the shape are *composing* — the values are drafted, revised,
and abandoned freely before anything is committed — and *valid* — the surface's
other job is to negotiate the system's constraints with the user before the
commit, so the commit succeeds.

That definition decides when *not* to use a form:

- **Inline editing** when the mutation is one value with no cross-field
  dependencies and a cheap undo. Click, change, committed — the draft phase
  collapses to nothing, and dressing it in form chrome (explicit save, cancel,
  a modal) taxes every edit to protect against a risk that is not there.
- **Auto-saving settings** when each control is independent and the cost of a
  wrong value is low and reversible. A settings page with a Save button forces
  the user to manage a transaction the system could manage itself.
- **A wizard** when the field set is large *and* has stage dependencies — later
  questions depend on earlier answers, or the cognitive load of the whole set
  at once defeats the user. A wizard is a form whose draft is chunked into
  sequenced commitments; use it for that reason, never to make a long form
  look shorter. Ten independent fields split across four steps is a worse form
  with extra clicks.
- **A confirmation dialog** when there is nothing to compose — the input is a
  single yes/no. A form with zero fields and two buttons is a dialog.

The failure modes in both directions are real: forms wrapped around single
values feel bureaucratic, and inline editing stretched across dependent fields
commits half-consistent states the user never meant to assert together.

## The field is a contract

Every field is a three-part contract, and most field-level defects are one of
the parts missing or two of them disagreeing:

1. **Value** — the datum being edited, in two representations: what the user
   sees and types (the *presentation*: localized, formatted, partial while
   mid-keystroke) and what the system stores (the *canonical* value: typed,
   parsed, normalized). The boundary between them — parse on the way in,
   format on the way out — is a real component of the field, not an accident
   of whichever handler touched it last. Fields that store presentation
   strings and parse at submit time discover their parse errors at the worst
   possible moment, all at once.
2. **Constraint** — the predicate that decides validity, expressed once and
   owned by the field's definition, not scattered across the change handler,
   the submit handler, and the button-disable expression. Three copies of
   "what makes this valid" is a race with a delay fuse: they drift precisely
   when the constraint changes ([one-validation-door](../_laws.md#one-validation-door)).
3. **Feedback** — where, when, and how a violation is shown. Timing is policy,
   not accident (the [validation-timing](techniques/validation-timing.md)
   technique); placement and association with the control are structural
   (the [field-composition](techniques/field-composition.md) technique).

A field whose three parts are declared together — value with its parse/format
boundary, constraint, feedback slot — can be validated on any schedule, listed
in any error summary, and revalidated at submit without new code. A field
assembled ad hoc from a raw control and a nearby conditional supports exactly
the behavior it was born with.

## Validation is layered, and each layer has a different job

- **Constraint at the input** — preventing impossible entry (a numeric field
  that ignores letters, a length-capped field). Cheapest feedback is input the
  error can never enter through; but never *silently* discard keystrokes for
  rules the user can't guess — blocked input with no explanation reads as a
  broken keyboard.
- **Client validation** — the negotiation layer. Fast, local, runs on the
  timing policy, exists to keep the user oriented. It is a *courtesy copy* of
  the rules, not their authority.
- **Server validation** — the truth. The system of record enforces its
  invariants regardless of what any client checked, because clients are
  plural, stale, and bypassable. The design consequence: a form must be built
  to receive rejections *after* a client-green submit and route them back to
  fields — the [server-error-mapping](techniques/server-error-mapping.md)
  technique. A form that treats server rejection as an unthinkable panic path
  will render it as one.

The layering also decides tone. Client validation speaks in the user's terms
("this doesn't look like an address") because it is guessing on the user's
behalf; the server's raw grievance (a constraint name, a code) is never shown
verbatim — it is *mapped* into the same field-level vocabulary the client
layer uses, so the user cannot tell which layer caught it.

## Errors aggregate; focus is managed

Field-level feedback answers "what is wrong here"; a form additionally answers
"can this be submitted, and if not, what stands in the way" — which requires a
form-level view over all fields' current validity. That registry is what makes
the essential behaviors tractable: a submit that fails validation moves focus
to the first offending field instead of shrugging; a long form renders a
summary of the errors, each entry a link to its field; assistive users hear
that validation failed and how many things need attention, not silence. The
full treatment is the
[error-aggregation-and-focus](techniques/error-aggregation-and-focus.md)
technique.

One prohibition belongs at this altitude because implementations break it
constantly: **do not use a disabled submit button as the error surface.** A
button that stays grey with no explanation makes the user hunt for the
blocker; the accessible version — button enabled, submit attempt runs
validation, errors surface and focus moves — turns every failed submit into a
guided tour of what remains.

## The submit lifecycle is part of the form

Between "user pressed submit" and "outcome shown" there is a state machine —
validate, in-flight with a double-submit guard, then success or failure with
distinct renderings — and it belongs to the form's design, not to whichever
handler someone wrote last. Alongside it live dirty tracking (does the draft
differ from the last committed state) and its consequence, the
unsaved-changes guard on navigation. The
[submit-lifecycle](techniques/submit-lifecycle.md) technique owns both.

## Accessibility posture

A form is the surface where accessibility failures do the most direct harm,
because the user is not browsing — they are trying to complete something.

- **Every control has a programmatic label.** Placeholder text is not a label:
  it vanishes on first keystroke, fails contrast, and is inconsistently
  exposed. The label persists, is associated with the control, and clicking it
  focuses the control.
- **Errors are associated, not adjacent.** The error text is linked to its
  control through the described-by relationship so assistive tech reads it
  with the field; the control's invalid state is set in the accessibility
  layer, not just painted red. Color is never the only signal.
- **Required is conveyed to everyone** — visually by convention (marker or,
  better, marking the *optional* minority) and programmatically on the
  control.
- **Validation outcomes are announced.** Focus movement to the first invalid
  field is itself the primary announcement; summaries and async results that
  appear without focus movement need a live region.
- **The form submits from the keyboard** — pressing enter in a text field
  submits (single-field forms especially), and the tab order matches the
  visual order.

## The techniques

- [validation-timing](techniques/validation-timing.md) — when each rule runs:
  the change/blur/submit policy, reward-early-punish-late, and debounced
  async checks with sequence guards.
- [field-composition](techniques/field-composition.md) — the field as a
  reusable unit: label + control + hint + error wiring, the parse/format
  boundary, and specialized controls that keep the same contract.
- [error-aggregation-and-focus](techniques/error-aggregation-and-focus.md) —
  the form-level registry, the error summary, focus-to-first-invalid, and the
  announcement rules.
- [submit-lifecycle](techniques/submit-lifecycle.md) — the submit state
  machine, double-submit guarding, dirty tracking, and the unsaved-changes
  guard.
- [server-error-mapping](techniques/server-error-mapping.md) — routing the
  system of record's rejections back onto fields, and what to do with the
  ones that fit no field.
