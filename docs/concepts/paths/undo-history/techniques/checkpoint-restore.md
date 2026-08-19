---
layer: technique
subject: undo-history
technique: checkpoint-restore
status: forged
laws: [deletion-is-not-repair, identity-survives-reuse]
shared_with: []
---

# Checkpoint & restore

Fine-grained undo covers the last few dozen intentions; durable versioning
covers named releases across sessions and users. Between them sits a gap
that swallows real work: "the last twenty minutes went wrong and I want to
be back where I was before this *operation* started". Checkpoints fill it —
coarse restore points captured at meaningful boundaries, cheap enough to
take automatically, durable enough to survive the fine-grained stack's
eviction, and restorable without fear. They complement gesture-level undo;
neither substitutes for the other, and surfaces that try to stretch one
across both scales fail predictably (undo-spamming to reach a past state;
checkpoint-restoring to fix a typo).

## Capture at boundaries of meaning

A checkpoint's value is proportional to how *nameable* its moment is.
Capture automatically at the boundaries the user already thinks in:

- **Before a risky operation begins** — an import, a bulk transformation, a
  generated change about to be applied, anything that will replace rather
  than accumulate. The checkpoint is the operation's safety contract:
  "whatever this does, the before-state survives".
- **After a unit of work completes** — a turn in a conversational workflow,
  an operation that ran to success, an explicit "this is good" moment. The
  after-checkpoint is what makes *progress* recoverable, not just mistakes.
- **On the user's demand** — a manual checkpoint affordance, for the moments
  only the user recognizes as worth keeping.

Per-boundary, not per-time: a timer-based checkpoint ("every five minutes")
lands mid-gesture, mid-operation, mid-thought — restoring one recovers a
state nobody ever considered coherent. If a time-based net is wanted as a
crash backstop, that is autosave, a different mechanism with a different
contract (latest-wins, not browse-and-choose).

Each checkpoint carries **identity and provenance minted at creation**
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): a
stable id, a timestamp, and a label naming the boundary ("before import",
"turn 14 — added pricing section"). A list of checkpoints distinguishable
only by time forces the user to restore-and-look, which — see below — must
be safe, but should never be the *only* way to know what a checkpoint
holds. Where cheap, attach a summary or preview.

## Restore is non-destructive — restoring is itself undoable

The cardinal rule. Restoring checkpoint C must not delete the states that
came after C. The naive implementation — roll back to C, truncate
everything since — turns the safety mechanism into the most dangerous
operation in the product: one misclick discards all work since the
checkpoint, precisely when the user is anxious and browsing old states.
Deleting the newer history is not part of repairing the document
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)).

The correct mechanics: **restore is a forward move**. Applying checkpoint C
captures the current state first (as its own checkpoint — "before restore
to C"), then makes C's content the new current state, appended to the
timeline rather than rewinding it. Consequences, all load-bearing:

- Restoring is reversible by the same mechanism: restore the
  "before restore" checkpoint. No special undo path, no confirmation
  dialog needed — the safety property is structural.
- Browsing is free: the user can restore, look, and restore back without
  loss, which converts the checkpoint list from an emergency lever into an
  exploration surface.
- The timeline stays append-only, which is also what makes the storage
  side simple: content-addressed or delta-chained storage never rewrites,
  only adds.

The fine-grained stack needs a policy at the restore boundary, chosen
explicitly: either the restore lands as one (large) undoable step in the
in-session stack, or the stack clears because the document was replaced
wholesale (a legitimate clear event — the stack-policy technique). Both
are defensible; the first is better when the restore is small, the second
when it replaces everything. What is not defensible is a stack that
survives restore still pointing at pre-restore structure — undo after
restore then corrupts.

## Retention: checkpoints have a reaper too

Checkpoints are bounded like everything else, but their eviction is not
oldest-first-and-silent — they exist precisely because some old states
matter. The standard policy is **thinning by age**: keep everything recent,
then progressively sparser samples going back (all from today, dailies for
the week, one per week beyond), always exempting user-pinned and
named-boundary checkpoints from automatic eviction. Deleting a pinned
checkpoint is a user action with the checkpoint's name on it, never a
janitor's.

Storage cost is what boundary-frequency capture makes affordable:
checkpoints are rare (per operation, not per keystroke), so even full
snapshots are usually fine, and delta or content-addressed storage makes
them nearly free. If checkpoint storage is a problem, the capture
frequency is wrong before the storage engine is.

## The trust loop

The mechanism's product value is behavioral: users who trust restoration
attempt things. Every hedge — a warning dialog on restore, a destructive
restore that eats newer work once, a checkpoint list with unlabeled
entries — teaches the user to fear the mechanism, and a feared safety net
changes no behavior. The investment order follows: non-destructive
mechanics first (trust), labels and provenance second (choice), previews
and diffs third (confidence). A restore feature shipped destructive "for
now" is shipped backwards — the safety property is the feature.

## Prohibitions

1. No destructive restore: applying a checkpoint never discards the states
   after it, and always captures the pre-restore state first.
2. No timer-based checkpoints posing as boundary checkpoints — coherent
   moments only; crash protection is autosave's job.
3. No checkpoint without minted identity and a boundary-naming label.
4. No automatic eviction of pinned or named-boundary checkpoints.
5. No fine-grained stack surviving a restore it cannot correctly apply to.
6. No confirmation dialog standing in for structural safety.
