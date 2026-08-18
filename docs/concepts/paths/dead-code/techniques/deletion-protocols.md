---
layer: technique
subject: dead-code
technique: deletion-protocols
status: forged
laws:
  - deletion-is-not-repair
  - count-carries-predicate
  - gate-sees-target
---

# Deletion protocols

Deletion looks like the easiest change a codebase can absorb — no new behavior,
nothing to design — and that is exactly why it produces outages: the ease invites
skipping the verification that every other change class gets by default. The shared
detection technique ends at a verified candidate list; this protocol turns a
candidate into a shipped subtraction. Its stages are ordered, and each exists
because skipping it has a named failure mode.

## 1. Establish the boundary by instrument, not by name

The deletion set is *computed*, never assumed from a folder name or a tribal "that
whole area is dead." The instrument that certified the candidates re-runs **as a
simulation of the deletion** at the moment of deletion — the graph moves between
report and act — and the simulation must answer three questions, each a set with
its predicate:

- **Still reachable from a live entry** — candidates the deletion must *keep* or
  explicitly re-point. The set is usually not empty: dead trees grow one tendril
  into live code (a provider wrapping a live tree, a type imported for a signature),
  and that tendril is where a name-based deletion breaks the build — or worse,
  ships and breaks behavior.
- **Newly unreachable because of the deletion** — the transitive closure: survivors
  orphaned *by* the removal. An empty closure is evidence the boundary was drawn
  correctly; a large one means the boundary was drawn too small and the island is
  bigger than believed. Either way the number is known before the act, not
  discovered across the next month of follow-up deletions.
- **Tests referencing the removed set** — each one is either deleted with its
  subject or re-pointed, decided per test, because a test suite that silently loses
  coverage is a second defect riding the first change.

## 2. Verify inertness before deleting anything that reads as load-bearing

A dead guard, gate, or safety check is a special case with a stricter bar, because
its *presence is a claim* — readers and documentation believe it protects them. The
sequence for removing one:

1. **Prove inertness structurally** — show the code path can never bind: the lookup
   key never matches, the branch is unreachable, the verdict is computed and
   discarded. "It seems unused" is not proof; "the condition is false on 100% of
   invocations, for this structural reason" is.
2. **Verify the callers** — confirm nothing anywhere branches on its output. A
   check whose result is read is not inert, however wrong its result.
3. **Then remove — and leave the autopsy at the deletion site.** The reasoning is
   the tombstone: why it was inert, what actually enforces the property it claimed
   to enforce, and the precondition anyone must meet to re-add it. A future reader
   who wants the check back must first refute the autopsy, which converts a
   recurring "should we re-add this?" debate into a one-time documented verdict.

The inversion is the point: a control that looks like protection and is inert is
*worse than none*, because it teaches everyone to stop looking. Removing it is
repair. This is the mirror image of
[deletion-is-not-repair](../../_laws.md#deletion-is-not-repair): deleting a dead
gate removes a lie; deleting a *failing* gate to quiet a report installs one. The
two moves are spelled identically in the diff, which is why the autopsy — present
in one, impossible in the other — is what reviewers should demand.

## 3. One island per reviewable unit

A dead cluster ships as a single change: the island's files, the re-pointing edits
from stage 1, and nothing else. The review then sees a self-consistent removal —
"this subsystem and its tendril" — instead of twenty fragments across unrelated
changes, and the revert, if ever needed, is one operation. The discipline cuts both
ways: nothing else rides along (no opportunistic refactors inside a deletion — a
deletion diff should be verifiable *as* a deletion at a glance), and every
non-deletion line in the change is individually named and justified as re-pointing.

## 4. Attribute every downstream movement

Deletions move numbers: gate baselines drop, warning counts fall, dependency
importer counts shrink. **Every movement is attributed to the deleted files** —
checked against the pre-deletion content, not assumed — before the change ships. An
attributable drop confirms the deletion did what it claimed; an *unattributable*
drop means either a matcher broke or the change swept a bystander, and both are
stop-the-line findings ([gate-sees-target](../../_laws.md#gate-sees-target)). The
same record states what was deliberately **not** deleted and why: the adjacent code
that shares vocabulary with the island but is provably live. Naming the survivor is
what prevents the next session from "finishing the job" on code that was never dead
([count-carries-predicate](../../_laws.md#count-carries-predicate)).

## 5. After: the detector keeps running, and the record says how to undo

Resurrection — the deleted name reappearing, or a survivor newly orphaned in a later
change — is a regression the very next sweep should catch, which requires the sweep
to keep running after the cleanup rather than being retired with a "done" label.
And the change record states the undo explicitly: version control holds the entire
island, restorable as one operation. Deletion of verified-dead code is the cheapest
change in the repo to reverse — which is precisely why the protocol can afford to
be decisive once its stages pass.
