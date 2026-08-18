---
layer: technique
subject: migrations
technique: transactional-ddl
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Transactional DDL

The atomic unit of a migration chain is **one step plus its ledger advance**.
Everything in this technique is about drawing that boundary correctly and
about what to do when the engine's schema verbs make it hard.

## Where the boundary goes

**Per step, not per chain.** A whole-chain transaction sounds safer and is
worse on every axis that matters here: a failure at step 9 of 10 rolls back
hours of backfill work that steps 1–8 did correctly, guarantees the next
boot repeats all of it, and holds one giant transaction open across
long-running data rewrites — the exact shape that exhausts journal space and
lock budgets on the low-end machines where migrations already run slowest.
Per-step boundaries leave the ledger honest at every failure point: the
store is at version *k*, exactly the versions ≤ *k* have been applied,
nothing else. That statement being always-true is what makes a halted
migration a resumable support case instead of a forensic puzzle.

The bump goes **inside** the step's transaction, as its last write. Bump
outside-after and a crash in the gap replays a completed step; bump
outside-before and a crash skips a step forever while the ledger claims
otherwise. Both gap states are fleet forks; the inside spelling deletes the
gap.

## Know which of your verbs are transactional

Engines differ on whether schema verbs respect transactions at all: some
roll back structure changes cleanly, some auto-commit each schema verb,
silently ending the transaction you thought you were in — which converts
"step + bump commit together" into "step committed, bump maybe". This is a
property to *verify against the actual engine and version*, not to assume
from documentation folklore, and the verification belongs in a test that
crashes a migration mid-step and inspects what survived. Where a verb is
non-transactional, the crash window it opens is covered by replayable
phrasing and post-conditions ([idempotent-steps](idempotent-steps.md)) — a
documented residue, not a shrug.

## The table-rebuild pattern

Engines with weak in-place alteration (no column drop, no type change, no
constraint edit) still support arbitrary reshaping through rebuild:

1. Create a new table at the target shape, under a temporary name.
2. Copy rows across, transforming as needed.
3. Drop the old table.
4. Rename the new one into place.
5. **Recreate the dependents.** Indexes, triggers, and views on the old
   table die with it or keep pointing at the corpse; the rebuild is not done
   until every dependent has been re-established against the new table.
   Enumerate them from the live schema *before* step 3 — the step's author
   cannot know what ad-hoc indexes exist on a machine in the field.

The rebuild's dangerous passenger is **referential enforcement**. With
foreign-key checking active, dropping the old table can cascade into
children or simply be refused; the standard choreography is: relax
enforcement for this connection → rebuild inside the transaction → run the
engine's full referential check → commit only if it is clean. The re-check
is not optional politeness — relaxing enforcement suspended the invariant,
so something must observe that the invariant still holds before the result
is committed ([gate-sees-target](../../_laws.md#gate-sees-target)). Skipping
it ships orphaned rows that no later declaration will ever catch, and the
sweep that finds them years later is
[schema-drift-detection](schema-drift-detection.md)'s problem when it should
have been this transaction's.

One subtlety worth its own sentence: on some engines a rename *rewrites*
references in other tables' definitions to follow the renamed table — which
is precisely wrong during a rebuild-swap, where the old name's departure is
intentional. Know your engine's rename semantics before trusting step 4.

## Failure inside the unit

A step that fails mid-transaction rolls back to the pre-step boundary —
that is the entire point — and then the runner **halts and reports**. The
temptation this technique explicitly forbids: catching the step's error,
rolling back, and continuing to the next step "since the transaction kept
us safe". The transaction kept the *store* consistent at version *k*; it
did nothing for the chain's contract that step *k+1* precedes *k+2*. A
chain that hops over a failed step delivers a schema no release was ever
tested against, while reporting the version of one that was — success
spelling used for a failure state
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Halt, leave the ledger at *k*, and let
[error-propagation](error-propagation.md) carry the news.
