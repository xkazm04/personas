---
layer: technique
subject: form
technique: validation-timing
status: forged
laws: [gate-sees-target]
shared_with: []
---

# Validation timing

*When* a rule runs is as much a design decision as *what* the rule checks.
The same constraint, evaluated on every keystroke versus on blur versus at
submit, produces three different experiences — one hostile, one calm, one
negligent — and the difference is pure scheduling. Timing is therefore a
**policy chosen once per form (ideally once per product)** and applied to
every field, not an emergent property of however each field's handlers got
wired.

## The core asymmetry: reward early, punish late

Feedback has a sign, and the two signs want opposite schedules:

- **Positive and corrective transitions show immediately.** The moment a field
  that *was* invalid becomes valid, say so — on the very keystroke. The user
  is actively repairing; confirming the repair the instant it lands is the
  reward loop that makes error correction feel guided instead of adversarial.
- **Negative feedback waits for a settling point.** Flagging "too short" on
  the first character of an entry the user is still typing punishes them for
  not having finished — every partial state of a valid entry is transiently
  invalid, and eager negative validation renders that red. The natural
  settling point is leaving the field (blur), or a pause long enough to read
  as "done typing" for rules where mid-entry help genuinely helps.

This yields the standard composite policy, sometimes summarized as
**validate late, revalidate eagerly**:

| Field state | On change | On blur | At submit |
| --- | --- | --- | --- |
| pristine, never blurred | no negative feedback | first validation | validated |
| previously found invalid | revalidate every change (clear the error the moment it is fixed) | revalidate | validated |
| valid and settled | stay quiet unless it *becomes* invalid | revalidate | validated |

Two consequences worth naming:

- **A field carries a touched/blurred bit.** The policy needs to know whether
  the user has finished a first pass over the field; that bit is state, minted
  per field, reset when the form resets.
- **Errors clear on the keystroke that fixes them, never on blur.** Making the
  user leave the field to learn their fix worked forces a round trip per
  attempt.

## Submit is the universal backstop

Whatever the per-field schedule, **submit validates everything, through the
same predicates** — including fields never touched, because an untouched
required field is exactly the case blur-based scheduling never reaches. Submit-
time validation is not a different validator; it is the same field constraints
run against the full set, feeding the aggregation and focus machinery (the
error-aggregation-and-focus technique). A form whose submit trusts the
accumulated per-field results has a hole the width of the fields nobody
entered.

## Expensive checks: debounce the question, guard the answer

Some constraints cannot be answered locally — "is this name taken", "does
this endpoint respond", "is this key accepted". They differ from local rules
in every dimension that matters for scheduling:

- **Never per keystroke.** Debounce behind a pause that reads as intent
  (roughly 300–500ms), and only fire when the local (cheap) constraints
  already pass — asking the server about a value the client already knows is
  malformed wastes the round trip and produces a confusing second opinion.
- **The result must be pinned to the value that was asked about.** Responses
  return out of order; a slow answer about an old value must never land on a
  new one. Guard with a sequence: stamp each request, accept a response only
  if its stamp is the latest issued (or compare the asked-about value against
  the current value). An async validator without this guard is a gate reading
  a proxy — it passes or fails the *previous* entry while appearing to judge
  the current one ([gate-sees-target](../../_laws.md#gate-sees-target)).
- **The check has four states, and all four render**: idle, checking,
  confirmed, rejected. "Checking" must be visible (the user is about to make
  a decision on the answer) but calm — an inline affordance at the field,
  never a blocking overlay. And it must be *steady*: enter the checking state
  at the keystroke (the debounce window counts as checking), so consecutive
  keystrokes extend one continuous checking state instead of flickering
  idle → checking → idle mid-word. A status line that strobes while the user
  types teaches them to ignore it. And a check that *errored* (network failed) is not
  a rejection: say "couldn't verify", allow proceeding if the server will
  re-enforce at commit, and never render the could-not-ask state in the
  clothes of the asked-and-refused state.
- **The answer is advisory at the edge, enforced at the center.** Availability
  can change between the check and the commit; the submit path must still
  handle rejection of a value the async check blessed (the
  server-error-mapping technique). The async check exists to save the user a
  failed submit, not to replace the server's enforcement.

## Cross-field rules run at the latest participant

A constraint spanning several fields (two entries must match, a range's end
after its start, at least one of a group) cannot be judged before all its
participants have settled. Schedule it at the blur of the *last* participant
the user has visited, and revalidate it on change of *any* participant once it
has fired. Attribute the error to the field the user can actually fix —
conventionally the second/confirming entry, not the first — or to the group as
a whole when no single field owns the repair.

## Prohibitions

1. No negative feedback on a pristine field before its first settling point.
2. No error that persists through the keystroke that fixed it.
3. No submit that trusts accumulated per-field state instead of revalidating
   the full set.
4. No async validation without a stale-response guard.
5. No async "could not check" rendered as "checked and rejected".
6. No per-field deviation from the form's timing policy — a form where one
   field yells on keystroke and its neighbor waits for blur reads as broken,
   whichever policy is right.
