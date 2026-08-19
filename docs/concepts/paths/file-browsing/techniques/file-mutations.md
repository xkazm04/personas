---
layer: technique
subject: file-browsing
technique: file-mutations
status: forged
laws: [count-carries-predicate, creation-names-reaper, one-validation-door]
shared_with: []
---

# File mutations

Rename, move, delete, tag: writes against a store that other writers are
mutating concurrently. Every mutation in a browser is therefore a *race
entered knowingly*, and the technique is the discipline of entering it —
validate late, report per item, keep a reversal path, and reconcile the view
afterward no matter what happened.

## The race is the normal case

Between the listing that showed the file and the click that mutates it, the
file may have been renamed, moved, replaced, or deleted by another program,
another window, or a sync agent. Consequences:

- **Preflight checks are advisory.** Checking "does the target name already
  exist" before a rename narrows the race window; it cannot close it. The
  store's own atomic answer at execution time is the only authority — the
  mutation is attempted, and its failure is caught and classified, not
  assumed away because a check passed a moment earlier.
- **Failures are designed states, not exceptions.** "Source no longer
  exists", "a different item now holds that name", "permission denied",
  "container is read-only" each get a specific, actionable rendering. A
  generic failure toast for all four teaches the user nothing and usually
  precedes them retrying the wrong fix.
- **Every failure triggers a refresh.** A failed mutation is *evidence the
  view is stale*. Leaving the ghost item rendered invites the user to click
  it again and collect the same error twice.

## Structural refusals

Some mutations are wrong *by geometry*, independent of any race, and they are
refused before the store is asked: moving an item onto itself (a no-op, not
an error), moving a container into its own descendant (which would orphan
the subtree), destroying or renaming the store root, and any escape from the
sandbox the browser is scoped to. Two rules give these teeth:

- **One guard door.** Every surface that can initiate a move — a drop onto a
  row, a drop onto the tree, a drop onto a location trail segment, a bulk
  "move to" action — funnels through one shared function that applies the
  guards and builds the operation list. Guards re-implemented per surface
  drift per surface; the copy nobody remembers is the one missing the
  ancestor check.
- **Refusal at the deepest layer too.** The backing command re-validates
  even when the interface already filtered, because the interface is only
  one of the writers and the cheapest caller to get wrong is the next one.

## Staged intent

Cut-and-paste is a mutation split across time: the cut arms an intent, the
paste fires it. Staged intent is resolved against the *live* store at fire
time — the staged items may have moved or vanished since they were cut, so
the paste re-races each one individually like any bulk operation, and a
stale entry fails per item rather than corrupting the batch. Like selection,
staged intent does not survive the session; resurrecting a days-old cut
buffer re-arms a move the user has forgotten configuring.

## Name conflicts

The conflict dialog is a real design surface, not an error: **replace**,
**keep both** (auto-suffixed), or **skip**, with "apply to all remaining"
once a bulk operation hits its second conflict. Two rules inside it: replace
states what is being destroyed (kind, size, age of the loser — enough to
choose), and keep-both states the resulting name. Auto-resolving conflicts
silently in either direction — clobber or suffix — takes a decision that
destroys or duplicates user data and hides it.

## Bulk operations report per item

A mutation applied to a multi-selection is N independent races, and some
will lose. The contract:

- **Independent application.** One failure does not abort the remainder
  (unless the operation is genuinely transactional in the store, which
  filesystem-shaped stores almost never offer).
- **Per-item outcome, aggregated honestly.** "Moved 12 of 15 — 3 failed",
  with the three enumerated, each carrying its classified reason and a
  retry affordance for just the failures. The count carries its predicate:
  "12 moved" is a different fact from "15 attempted", and a summary that
  says only "done" after a partial failure converts three lost files into
  next week's discovery.
- **Progress with cancellation for long runs.** Cancel means "stop starting
  new items", with the boundary reported — what completed stays completed,
  and the report says exactly which.

## Trash versus delete

Destruction gets one of two shapes, chosen by what the store offers:

- **Soft delete** into a recoverable holding area, when available. This is
  the better default precisely because it converts the worst mutation into
  a reversible one — the confirmation can then be light or absent, because
  the undo is real.
- **Hard delete** behind an explicit, proportionate gate when no holding
  area exists: the gate names the blast radius ("permanently delete 14
  items, including 2 folders and their contents") and is not the same
  reflexive dialog used for trivia — confirmation fatigue is how permanent
  deletions get click-throughed.

Anything the browser itself creates as a byproduct — temp copies during a
move, partially written targets after a failure, its own holding area —
names its reaper at creation: what cleans it up, and when. A crashed move
that leaves a half-copied orphan forever is the browser becoming one of the
untrusted concurrent writers it was designed to survive.

## Reconcile the view

After every mutation, the view converges to the store's actual state.
Optimistic update (apply locally, then verify) is legitimate when the
reversal is cheap and the race is rare — rename, tag. Pessimistic update
(refresh after the store confirms) is the rule when the operation crosses
containers or destroys. Either way, the invariant is the same: the surface
never *settles* showing a state the store does not hold. An optimistic
rename that failed quietly and stayed painted is the browser gaslighting
the one person who trusted it.
