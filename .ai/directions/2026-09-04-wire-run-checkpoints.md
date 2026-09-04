---
subject: software-engineering/execution-state-checkpointing
project: personas
raised_by: intake intake-exo (peer comparison, operator gate 2026-09-04)
source: librarian/sources/2026-09-04-exo.md
stage: `src-tauri/engine/src/git_checkpoint.rs` (checkpoint/snapshot/fork/rollback, 272 lines, zero call sites) and the dev-tools stage loop that should be calling it
size: 3 files / ~180 lines / M
status: accepted
---

## Why the scope implies it

`scope.does` names *"run local AI agent personas over wrapped CLIs, local-first
storage, one operator per install"*. Every clause of that sentence is a reason
this matters more here than it would in a hosted product: the agent runs in a
real repository on the operator's machine, the storage is local-first so there is
no server-side copy, and one operator per install means **nobody else notices a
run that went sideways**. A hosted product has a replica and a support channel; a
local-first single-operator tool has the working tree and whatever the run left
in it.

The project already reached this conclusion by itself. `git_checkpoint.rs:1-8`
states the motivating problem in the present tense — *"Personas' dev-tools plugin
runs agents in real git repositories with zero checkpointing — a run that goes
sideways mid-task has no clean rewind"* — and then implements the answer: four
public functions (`checkpoint_stage`, `snapshot_stage`, `fork_from_checkpoint`,
`rollback_to`), hardened against auto-maintenance, gc, signing and hooks so a
checkpoint is fast and deterministic inside an agent workspace. A migrated table
records the stage→SHA index, and its own header says it exists so *"a future UI /
auto-checkpoint-on-stage wiring can list and roll back to them"*.

**It has zero call sites.** `git_checkpoint::` appears nowhere in the tree
outside its own file — only the `pub mod` declaration at `engine/src/lib.rs:113`
and a doc comment in the repo module. The capability is built, tested, indexed and
unreachable, and the header still describes the problem as unsolved because, from
the operator's point of view, it is.

This is therefore not a request for a new capability. It is a request to connect
one that already exists to the loop it was written for, which is why it is
proposed rather than banked.

## What the first context contains

1. **The stage-loop call.** The dev-tools run loop calls `checkpoint_stage` at
   each stage boundary and writes the returned SHA through the existing
   `dev_run_checkpoints` repo. Nothing else changes about how a stage runs.
2. **A failure posture for the checkpoint itself.** A checkpoint that cannot be
   taken must not fail the run — the run is the product and the checkpoint is
   insurance — but it must not be silent either: it records a typed reason and the
   run continues with a recorded gap. The distinction the registry subject insists
   on is that a missing checkpoint is *known* to be missing, so a later rollback
   offer can say what it cannot reach.
3. **A rollback path an operator can reach**, minimally a command that lists a
   run's checkpoints from the index and rolls the workspace back to one. The UI is
   explicitly out of the first context.

**It must NOT absorb**: forking a new attempt from a checkpoint
(`fork_from_checkpoint` stays unwired for now — forking mints a second run and
raises identity questions this context does not answer); auto-checkpointing
anything outside the dev-tools stage loop; a second reset axis for companion or
memory state; or the UI.

## The registry techniques this implements, and the one whose window is closing

Three techniques were forged from a peer system on 2026-09-04, and all three
apply here the moment the module gains its first caller:

- **`the-record-outlives-the-rewind`** — a rollback of the working tree resets
  code while leaving the local database, the run ledger and the companion event
  history untouched. That asymmetry should be *published as a matrix* before the
  first rollback ships, not discovered by an operator who rolled back and found
  the run ledger still describing work that no longer exists on disk.
- **`runtime-bound-checkpoint`** — a checkpoint is only resumable under a
  compatible runtime. Here that is narrow but real: a checkpoint SHA is meaningful
  only in the repository that produced it, so the index row should carry enough to
  refuse a rollback aimed at the wrong workspace rather than moving someone
  else's tree.
- **`resume-mints-a-duplicate`** — the one whose window closes first, and the
  reason `fork_from_checkpoint` is excluded above. Identity divergence has to be
  designed into a fork path *before* it has callers, because retrofitting it means
  reasoning about attempts already minted.

## The measurable

**Recoverable stage boundaries per dev-tools run**: today 0 by construction, since
nothing calls the module. After: one per completed stage, verifiable by listing
the run branch's commits and matching them against the index rows.

The second, sharper number is **the gap between the two**: index rows whose SHA is
not reachable in the repository. That should be 0, and it is the number that says
whether the index and the branch have drifted — which is the failure this pairing
of a SQLite index with a git branch can produce and a single store cannot.

## The falsifier

If, across a representative set of dev-tools runs, **no run ever produces a stage
boundary an operator would want to return to** — because stages are short enough
that re-running from the start is cheaper than rolling back, or because failures
cluster in the first stage — then the checkpointing is cost with no return and the
module should be deleted rather than wired. That is a real possibility and it is
the thing to measure first: instrument how often a run is abandoned after stage 1
versus later, before building the rollback path.

The weaker falsifier: if git operations in the agent workspace turn out to
interfere with the agent's own git usage (a checkpoint commit landing mid-agent-
operation), the per-run branch is the wrong isolation and the answer is a
different mechanism, not a fix.
