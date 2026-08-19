---
layer: technique
subject: draft-editing
technique: debounced-save-groups
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Debounced save groups

Continuous saving for a long-lived draft, structured around three decisions:
the **unit** of save is the region group, the **schedule** is a per-group
debounce with explicit flush triggers, and the **failure posture** is loud.
Get the third one wrong and the feature is worse than no autosave at all —
a debounced save that fails silently is **data loss on a timer**, because
the user kept working under a persistence promise the system had already
broken.

## The unit: per-group, not per-keystroke, not whole-document

- **Per-keystroke saves** are a request storm: interleaving responses,
  server load proportional to typing speed, and a conflict window on every
  character.
- **Whole-document saves** couple unrelated regions: one region's
  validation failure or transport error poisons another's perfectly good
  save, and every save widens the concurrent-edit conflict window to the
  full entity.
- **Per-group saves** — the region map from dirty-tracking doing double
  duty — keep each region's save atomic within itself and independent of
  its neighbors. A group either saves whole or fails whole.

## The schedule

Each group owns a debounce: edits within the window coalesce, the trailing
edge fires the save with the group's *current* draft state (never the state
at first edit — coalescing means the latest wins). The window is a
transport courtesy measured in a second or two, not a durability policy.

**Flush triggers override the timer.** Pending work flushes immediately on:

- leaving the region (tab switch — the user's attention moving is the
  natural commit point);
- the explicit save gesture (button, keyboard shortcut) — which flushes
  *all* groups, because the user's intent is "persist everything now";
- the exit guard engaging (the navigation-guards technique);
- surface teardown, with the caveat that teardown-time saves are
  best-effort — which is why the guard flushes *before* teardown;
- process or window death, which needs a **synchronous last-gasp drain**
  registered with the platform's closing hook. This is the flush everyone
  skips — measured across whole families of applications, the number of
  pending debounced writes that survive a window close rounds to zero —
  and a dialog that *warns* on close is not a drain: prompting the user is
  not persisting the work.

The debounce is a convenience layered over the explicit door, never a
replacement for it. An editor whose only save path is the timer strands the
user with no way to *make sure*.

## In-flight overlap: the three races

1. **Edit during in-flight save.** The user keeps typing while a save is on
   the wire. Do not drop the edit, do not abort the save: mark the group
   dirty-again and schedule a follow-up save on completion. One in-flight
   save per group, one pending slot that always holds the latest state.
2. **Completion of a stale save.** A save resolves, but the draft has moved
   since that payload was captured. The group is clean only if the current
   draft equals **the payload actually sent** — resolution of *a* save is
   not evidence about *this* state
   ([gate-sees-target](../../_laws.md#gate-sees-target): the clean-marking
   gate must see what was saved, not that saving happened).
3. **Out-of-order completion.** Two saves for one group must never be
   concurrent (rule 1 prevents it); saves for *different* groups may
   interleave freely — that independence is the point of grouping.

Two preconditions make race 2's comparison trustworthy, and both are easy
to break silently. First, the captured payload must be a **value snapshot**:
a buffer mutated in place makes the comparison hold the live object in
both hands and conclude nothing changed — replace the draft object on
every patch, never mutate it. Second, the flush must distinguish "the
schedule moved" from "the owner is going away": a flush wired to fire on
every reschedule executes a save per keystroke, which silently deletes the
debounce while looking exactly like it works.

## Failure: visible, sticky, retried

When a group's save fails:

- **The group stays dirty** — the work is not persisted, and every
  indicator must say so. Marking clean on failure is the silent-loss bug in
  its purest form.
- **The failure surfaces where the user is looking**: the region's
  indicator flips from "saving" to an error state with the save affordance
  offered ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
  — a save that did not happen must be spelled differently from a save with
  nothing to do).
- **Retry is automatic but bounded** — transient transport failures retry
  with backoff (the retry discipline is owned by the
  [retry-backoff](../../retry-backoff/retry-backoff.md) standard); a
  rejection that is the server refusing the *content* does not retry, it
  reports, because resending the same invalid payload on a timer is noise
  that ends in the same place.
- **Exit is escalated**: an exit attempt while a group is failed-unsaved is
  the guard's loudest case — this is not "you have unsaved changes", it is
  "saving has been failing".

## Baseline advance

Success advances the baseline **for that group only**, to the payload that
was confirmed. Never advance other groups' baselines, never advance to the
current draft (race 2), and never advance on scheduling — only on
confirmation.

## Prohibitions

1. No save unit smaller than a group or larger than the dirty groups.
2. No timer-only persistence — the explicit flush gesture always exists.
3. No dropped edits and no aborted-and-forgotten saves under overlap.
4. No clean-marking without comparing against the confirmed payload.
5. No silent failure: a failed save changes what the user sees.
6. No content-rejection retry loop.
7. No baseline advance on anything but per-group confirmation.
