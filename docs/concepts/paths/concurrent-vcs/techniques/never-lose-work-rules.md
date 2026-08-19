---
layer: technique
subject: concurrent-vcs
technique: never-lose-work-rules
status: forged
laws: []
shared_with: []
---

# Never-lose-work rules

Coordination can fail, isolation can be skipped, and verification catches
faults only after they happen. Beneath all three sits a small set of rules
whose sole purpose is that **no session's work is ever destroyed by another
session's housekeeping.** They are phrased as bans and rituals rather than
advice, because the population of sessions includes ones that have read
nothing: a rule that survives only when remembered is not a guarantee, so
each rule here is designed to be checkable at the moment of action.

## The stash ban

**Never stash work that is not yours — which in a shared checkout means:
never stash.** A stash sweeps the *entire working tree* into a hidden state:
your edits, every sibling's in-flight edits, and (with the include-untracked
flag) files no version-control operation has ever seen. Hidden is the
operative word — a sibling whose files vanish will look in the log, in the
tree, in the trash, and last of all in another session's stash. The
canonical incident: a session stashing to "clean its tree before commit"
silently swept five files of a neighbor's in-flight run, including one
untracked file that survived only because it happened to be reproducible.

The legitimate need behind the stash — a clean stage — has a scoped answer:
stage *your* paths, one by one, and leave everything else where it sits. A
dirty tree that is not yours is not your problem to clean; it is a sibling's
live work.

## Per-path staging, always

Bulk staging (add-everything, add-all-modified, add-current-directory)
commits whatever the neighbors were doing at that moment. The rule has two
halves:

1. **Classify before staging.** Read the full dirty-state listing and sort
   every entry into: mine / pre-existing drift / a sibling's live work. The
   question is not "what should I commit?" but "what is here that is not
   mine?" — the inversion matters, because the default gaze sees only its
   own files.
2. **Stage by explicit path**, one path per decision. Anything you cannot
   classify, you do not stage.

## Atomic cadence

Uncommitted work is the blast radius. Every loss incident in this subject's
evidence base reduces to the same root: too much uncommitted work in flight
at once, meeting one housekeeping operation. So: one task, one commit; land
each finding, each refactor step, each unit of a rollout as it completes;
never accumulate more than a modest working interval uncommitted. When a
validation fails, fix and commit — never stack unlanded failing work on
unlanded passing work. Committed work is recoverable from history under
essentially any following disaster; uncommitted work is recoverable from
nothing.

## The recovery ladder

When something has gone wrong, the rungs are ordered by how much they can
destroy, and you take the lowest rung that works:

1. **Amend** — the failure is one commit old and mis-scoped or
   mis-attributed: fix the commit in place. The content is present; only
   the label or file set is wrong. This is the designed pairing with
   readback verification: catch at age one, repair by amend.
2. **The reference log** — a commit "disappeared" (a reset, a moved branch,
   a no-op you misread as landed): the reference log records where every
   head has been and recovers anything that was ever committed.
3. **Never reset a shared timeline.** Rewinding history that siblings are
   building on converts your one-commit problem into everyone's problem;
   what a reset "removes" is other sessions' landed work. On a shared
   branch, history moves forward only — repairs are new commits or
   amendments to the unshared tip.

## Housekeeping asymmetry

The deep principle under all four rules: **operations must be asymmetric in
whose work they can touch.** Staging your paths cannot move a sibling's
work; stashing can. A scoped amend cannot destroy a sibling's commit; a
reset can. Committing often cannot lose anything; deferring commits can
lose everything. Choose, at every step, the operation whose worst case
lands only on you.
