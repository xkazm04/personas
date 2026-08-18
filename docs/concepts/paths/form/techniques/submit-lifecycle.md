---
layer: technique
subject: form
technique: submit-lifecycle
status: forged
laws: [one-validation-door, identity-survives-reuse]
shared_with: []
---

# Submit lifecycle

Everything between "the user pressed submit" and "the outcome is on screen"
is a state machine, and it is the same machine in every form. Designing it
once — states, transitions, and the prohibitions on the edges — is what makes
submits feel solid; leaving it to each handler produces the classic quartet
of defects: double submits, buttons that lie about being busy, successes that
look like nothing happened, and drafts destroyed by a mis-click.

## The states

```
IDLE ──submit──▶ VALIDATING ──fail──▶ IDLE (errors shown, focus moved)
                     │pass
                     ▼
                 IN-FLIGHT ──reject──▶ IDLE (errors mapped onto fields/form)
                     │resolve
                     ▼
                 SUCCEEDED (form's afterlife: close, reset, or navigate)
```

- **VALIDATING** runs the full field set through the same constraints the
  fields use individually — one validation door, submit is just the caller
  that opens it for everyone
  ([one-validation-door](../../_laws.md#one-validation-door)). On failure the
  machine returns to idle *with the aggregation and focus behavior* of the
  error-aggregation technique; validation failure is a normal, cheap,
  expected transition, not an exception.
- **IN-FLIGHT** is entered at most once per user intent. The submit control
  shows a busy state *on itself* — the control the user pressed answers "did
  my press register" right where they pressed it — and the double-submit
  guard engages (below). The rest of the form stays visible and readable;
  fields lock only if editing mid-flight would genuinely corrupt the request.
- **Rejection re-enters IDLE with the rejection routed** — onto fields where
  attributable, into the form-level slot otherwise (the server-error-mapping
  technique). The draft is preserved exactly as submitted; the user repairs
  and resubmits. A rejection that clears the form converts one failure into
  two.
- **SUCCEEDED commits to an afterlife, chosen per form**: close the surface,
  navigate to the result, or reset for another entry. Whatever the choice,
  success is *visible* — a form that quietly returns to idle leaves the user
  unsure whether to press again (and pressing again is now a duplicate).

## The double-submit guard

The guard is structural, not visual. Disabling the button is presentation;
the *machine* refuses re-entry: a submit arriving while one is in flight is
dropped (or coalesced), regardless of which path delivered it — button,
enter key, keyboard shortcut, programmatic call. Guards that live only on the
button forget that enter in a text field submits too.

The guard binds to **this form instance's in-flight intent**, not to a global
"something is saving" flag. Two independent forms (or two rows each with a
row-level save) must not lock each other; conversely, reopening a dialog must
not inherit a stale busy state from its previous life — the guard's identity
is the submission, and it survives nothing beyond it
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).

When the transport offers no idempotency, the guard is the *only* thing
between a slow network and a duplicate record — treat gaps in it as data
corruption bugs, not UX polish.

## Dirty tracking

A form knows its **baseline** — the values as of the last commit (or the
initial values for a create form) — and *dirty* is a comparison against that
baseline, not a "user touched something" bit. The distinction matters: typing
a character and deleting it returns the form to clean; a touched-bit
implementation nags about abandoning changes that no longer exist.

Dirty state drives:

- **Save affordance honesty** — "Save" on a clean form is a no-op button;
  either disable it *for this reason only* (no-op, not error — the one
  legitimate disabled-submit) or keep it enabled and make save idempotent.
- **The baseline advances on success** — after a commit, the just-saved
  values are the new clean state. Forms that keep comparing against the
  original load stay dirty forever after the first save.
- **Reset means return to baseline**, not to empty.

## The unsaved-changes guard

Navigation away from a dirty form — closing the dialog, switching tabs,
leaving the page, dismissing via the backdrop or escape — is **data loss with
one keystroke of warning available**. The guard:

- Intercepts *every* exit path the surface owns. The classic hole is guarding
  the close button while backdrop-click and escape dismiss freely; an exit
  path added later that forgets the guard is the same hole again, so route
  all exits through one interceptor.
- Asks, with the destructive option spelled honestly ("discard changes", not
  "cancel" versus "Cancel") — the double-negative dialog where "cancel"
  might mean "cancel the leaving" or "cancel the draft" is a coin flip that
  costs someone their work.
- Never fires on a clean form. A guard that cries wolf on every close trains
  users to click through it, which un-guards the one close that mattered.
- For long-lived drafts, the stronger answer is to make the question moot:
  persist the draft (locally or as a server-side draft) and restore it, so
  "leave" stops being destructive at all.

## Prohibitions

1. No submit path (button, enter, shortcut, programmatic) outside the
   machine's re-entry guard.
2. No busy state anywhere but the control that was pressed — a full-form
   overlay for a row-level save punishes the whole surface.
3. No rejection that discards or resets the user's draft.
4. No silent success.
5. No global busy flag shared between independent forms or rows.
6. No exit path that bypasses the unsaved-changes guard, and no guard that
   fires on a clean form.
7. No "Save" that is secretly disabled for validation reasons — disabled is
   reserved for "nothing to save".
