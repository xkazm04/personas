---
layer: technique
subject: form
technique: error-aggregation-and-focus
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Error aggregation and focus

Field-level feedback answers "what is wrong *here*". A form must also answer
"what is wrong *overall*, and where do I go next" — and that second question
requires structure the fields cannot provide individually: a form-level view
of every field's validity, an ordering over the fields, and a policy for
moving the user's attention. Without it, a failed submit is a shrug: something
somewhere is red, possibly off-screen, and the user scrolls hunting for it.

## The registry

The form maintains a **registry of its fields**: identity, current validity,
current error text, and a way to reach the field (focus it, scroll to it).
Fields enroll when they appear and withdraw when they are removed —
conditional sections mean enrollment is dynamic, and a field that unmounted
must not haunt the registry as a phantom error that can never be fixed.

The registry's ordering is the **user-facing order** (visual/tab order), not
enrollment order or alphabetical — "first error" below means first as the
user reads the form, because that is where their repair pass will start.

What the registry is *not*: a second validator. Validity is computed by each
field's own constraint (one door per field); the registry aggregates results.
A registry that re-implements the rules is a drifting copy.

Two refinements that separate a solid registry from a naive one:

- **The registry holds *visible* errors, on the form's timing policy** — not
  raw validity. A field whose error is still suppressed (pristine, not yet
  blurred) must not appear in the summary; a summary listing errors the
  fields themselves are not yet showing makes the two surfaces disagree, and
  the user trusts neither. When submit forces all errors visible, the
  registry fills accordingly — visibility and aggregation move together
  because they read the same gate.
- **Enrollment traffic must not disturb the fields.** Registering and
  clearing errors is high-frequency (every validation pass); if each write
  re-renders every enrolled field, the registry taxes the whole form to feed
  one banner. Separate the stable write interface (what fields hold) from
  the changing read surface (what the summary consumes) so only the summary
  pays for updates.

## Focus goes to the first invalid field

On a submit attempt that fails validation:

1. Validate the full set (the timing technique's backstop — untouched fields
   included).
2. Move focus to the **first invalid field** in user-facing order, scrolling
   it into view with its label and error visible — not pinned at the exact
   top edge where the error sits off-screen.
3. Focus movement *is* the announcement: the assistive user lands on a field
   whose label, invalid state, and error text read out together. This is why
   the field-composition wiring (label association, described-by, invalid
   state) is a prerequisite — focus on an unwired field announces a bare
   control and the user learns nothing.

If the first invalid field sits inside a collapsed section, tab, or step,
**expand the container first, then focus** — focusing an element the user
cannot see is worse than not moving focus at all. This forces a real design
decision in sectioned forms: containers must be openable programmatically,
and the registry must know which container owns each field.

## The error summary

For short forms, focus-to-first-invalid suffices. Past a handful of fields —
or whenever errors can sit off-screen — render an **error summary**: a block
at the top of the form (or adjacent to the submit control) listing each
error, each entry an actionable link that focuses its field.

- The summary's count carries its predicate: "3 fields need attention",
  followed by *which three and why* — never a bare count the user must
  reconcile against the form themselves
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)).
- The summary appears (or updates) on the failed submit, and receives focus
  or is announced via a live region — silently materializing content above
  the viewport helps no one.
- Entries vanish as their fields are fixed; a summary still listing repaired
  errors is a stale index of the form, and stale indexes teach users to stop
  reading it.
- The summary is *in addition to* field-level errors, never a replacement.
  Errors live at the fields; the summary is a table of contents.

## Announcement rules

- **Synchronous, submit-triggered errors**: focus movement announces. A live
  region duplicating what focus just read out produces a double
  announcement.
- **Asynchronous results that arrive without a user action** (a debounced
  availability verdict, a background save failure): nothing moved focus, so
  a polite live region carries the news. Never *steal* focus for an async
  result — the user is mid-thought in another field, and yanking them is
  data loss for whatever they were typing.
- **Success is announced too.** A form that clears and says nothing leaves
  assistive users wondering whether they submitted or reset.

## Form-level errors

Some failures attribute to no field — the commit conflicted, the whole
combination is disallowed, permission was denied. These render in a
**form-level error slot** near the submit control (where the user's attention
is after submitting), styled as failure, announced, and *retained until the
next submit attempt* — not auto-dismissed while the user is still reading.
The server-error-mapping technique governs what lands here versus on fields;
this technique governs how it is shown.

## Prohibitions

1. No failed submit without focus movement (or, at minimum, an announced
   summary).
2. No focusing a field the user cannot see — expand its container first.
3. No error summary whose entries are inert text instead of links to fields.
4. No bare counts — every "N errors" names the N.
5. No unmounted field leaving a phantom entry in the registry.
6. No stealing focus for asynchronously arriving results.
7. No disabled-submit-as-error-surface: the button stays pressable, and
   pressing it produces the guided repair pass described here.
