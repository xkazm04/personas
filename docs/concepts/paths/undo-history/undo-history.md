---
layer: golden-path
subject: undo-history
status: forged
techniques:
  - undo-model-selection
  - gesture-coalescing
  - stack-policy
  - redo-semantics
  - undo-scope
  - checkpoint-restore
evidence:
  - src/features/plugins/artist/sub_media_studio/hooks/useMediaStudio.ts   # bounded (80) snapshot stack, tag+window coalescing, machine writes bypass history — canonical fine-grained exemplar
  - src/features/plugins/artist/sub_media_studio/hooks/useTimelineKeyboard.ts  # the universal gesture wired: Ctrl/Cmd+Z, Shift+Z, Y
  - src/features/plugins/artist/sub_media_studio/TimelineClip.tsx          # the coalesced gestures: drag-to-move and trim, continuous mutation during drag
  - src-tauri/src/webbuild/versions.rs                                     # checkpoint exemplar: snapshot per turn, files-only restore that keeps history and commits forward
  - src/features/studio/StudioVersions.tsx                                 # the restore surface: browse turn snapshots, one-click non-destructive restore
  - docs/concepts/golden-paths/undo-persisted-operation.md                 # measured census of persisted-side reversibility: capture-bypass, unkeyed journal rows, unreachable undo
counter_evidence:
  - src-tauri/db/src/backup.rs   # boot-rotating 3-set backup: evicted every pre-incident snapshot within hours — retention with no thinning or pinning
deviations:
  - w7-undo-history   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Undo & history

Undo is a **promise made to the user about their intent**, not a mechanism for
replaying state deltas. The promise reads: *whatever you just did, one gesture
takes it back — completely, immediately, and without side effects you didn't
ask for.* Every architectural decision in this subject is downstream of that
sentence, and every classic undo defect is a place where the implementation
kept its own promise (reverted a delta) instead of the user's (reverted an
intention).

The distinction has teeth. Users do not think in state transitions; they think
in **gestures** — "I dragged that clip", "I typed that sentence", "I applied
that preset". The unit of undo is therefore the unit of intention: one gesture,
one step. A drag that recorded forty position updates and undoes in forty
increments did not implement undo forty times — it broke the promise forty
times, because no user ever intended forty micro-moves. Collapsing continuous
manipulation into single steps is not polish; it is the difference between
undo and a stack trace (the
[gesture-coalescing](techniques/gesture-coalescing.md) technique).

## Where this subject ends

Reversibility exists at three time scales, and conflating them produces
systems that do each badly:

- **In-session undo** — fine-grained, gesture-level, lives in memory, dies
  with the session. Owned here.
- **Checkpoints** — coarse-grained restore points at meaningful boundaries
  (an operation completed, a turn of work, an import applied). Bridge-scale:
  bigger than a gesture, smaller than a release. Also owned here (the
  [checkpoint-restore](techniques/checkpoint-restore.md) technique), because
  a checkpoint is still a promise about *this working session's* trajectory.
- **Durable version history** — named, persisted versions of an entity that
  survive the session and support audit, comparison, and rollback across
  users and time. That is the versioning-snapshots subject, not this one.
  The tell: version history answers "what did this look like last week";
  undo answers "take back what I just did".

Adjacent but distinct: the draft/commit lifecycle (edit freely, then commit
or discard the whole draft) is the draft-editing subject. A draft's *discard*
looks like undo but is a different contract — it reverts to the last commit
point, not the last gesture. A surface can and often does carry all three:
gesture undo inside the draft, checkpoints across operations, durable
versions at commit.

## The two architectures, priced honestly

There are two ways to make an action reversible, and the choice is the
load-bearing decision of the whole subject (the
[undo-model-selection](techniques/undo-model-selection.md) technique):

- **Command-inverse**: record each operation with enough information to
  construct its inverse; undo executes the inverse. Memory-proportional to
  the *change*, so it scales to large documents — and it collapses when
  inverses are hard to derive (operations that destroy information, effects
  that fan out through derived state) or when the inverse code drifts from
  the forward code it mirrors.
- **Snapshot**: capture the relevant state before (or after) each step; undo
  restores the capture. Trivially correct — restoration cannot drift from
  mutation because there is no second code path — and memory-proportional to
  the *document*, so it collapses when the document is large or steps are
  frequent.

Neither is the default. The honest question is arithmetic: document size ×
stack depth × step frequency against memory budget, and inverse-derivation
difficulty against correctness budget. Small documents with complex
operations want snapshots; large documents with local edits want commands;
real systems routinely want a hybrid — snapshots for the tangled operations,
inverses for the cheap local ones, structural sharing to make snapshots
affordable.

## The stack is bounded, and the bound is a policy

An unbounded history is a memory leak with a user-facing alibi. Every history
grows without limit unless something evicts, so the eviction rule is a design
decision made explicitly: how many steps survive, what gets dropped first,
whether eviction is silent or owed a warning when it crosses something the
user would care to keep, and whether the stack is per-document or shared
(the [stack-policy](techniques/stack-policy.md) technique). A team that never
chose a bound has still chosen one — the process's memory ceiling — and that
bound evicts by crashing.

## Redo dies on divergence — or you chose a tree

The default contract is linear: undo walks back, redo walks forward, and a
**new edit after undo invalidates everything on the redo side**. The user
forked history, and the abandoned branch is gone. This loss is correct
behavior under the linear contract — silently keeping both branches without a
model for them is worse — but it must be a *decision*: either linear history
with honest invalidation, or a real history tree with navigation the user can
understand. The unacceptable middle is a linear UI over tree-shaped
bookkeeping, where what redo will do after an edit is anyone's guess (the
[redo-semantics](techniques/redo-semantics.md) technique).

## Scope is declared, not discovered

Undo touches some state and not other state, and the user should be able to
predict which. The near-universal convention: **document state is in;
view state is out**. Selection, scroll position, zoom, panel layout, and
which item is focused are how the user *looks at* the document, not what
they *said about* it — undoing them makes the surface feel haunted. But the
boundary has genuinely hard cases (selection that participates in the edited
meaning; an edit in one panel whose undo mutates another panel the user is
not looking at), and each surface owes an explicit answer rather than
whatever its reducer happened to capture (the
[undo-scope](techniques/undo-scope.md) technique).

## The contract with the user

Mechanics aside, undo carries interaction obligations that hold across every
architecture:

- **The gesture is universal and instant.** The platform's undo shortcut
  works everywhere editing works, without a mode, without a dialog, without
  perceptible latency. Undo that opens a confirmation defeated itself —
  undo *is* the confirmation mechanism, the thing that makes "are you sure?"
  dialogs unnecessary for reversible acts.
- **Availability is visible.** Controls for undo/redo reflect whether a step
  exists; invoking undo with nothing to undo does nothing loudly enough to
  be understood (a disabled control, a brief "nothing to undo") and never
  silently no-ops in a way the user reads as "it undid something, but what?"
- **Steps are nameable.** The system knows what the next undo will revert
  ("undo typing", "undo move"); surfacing that name in the control's label
  or tooltip converts undo from a gamble into a decision. This falls out
  free from gesture coalescing done right — a coalesced step carries the
  intention's name because it was built around the intention.
- **Undo is not a save-state hack.** Reverting to "how it was when I opened
  this" is a checkpoint or draft-discard operation with its own affordance;
  asking users to hammer undo an unknown number of times to get there is a
  scope failure.
- **Destruction converts to reversibility wherever possible.** The strongest
  use of this machinery is making "delete" safe: an app with trustworthy
  undo can retire most warning dialogs, act immediately, and offer the
  inverse. Every confirmation dialog is a tax paid on every invocation for
  the sake of the rare mistake; undo moves the cost to the mistake itself.
  One condition is load-bearing: **the inverse is offered at the site and
  moment of the act.** A reversal affordance buried on a surface where the
  destruction never happens protects nobody — reversibility that exists but
  is unreachable from the acting surface is indistinguishable, to the user
  mid-mistake, from no reversibility at all.

## The techniques

- [undo-model-selection](techniques/undo-model-selection.md) — command-inverse
  vs snapshot vs hybrid: the memory and correctness arithmetic, structural
  sharing, and when a document is small enough that snapshots simply win.
- [gesture-coalescing](techniques/gesture-coalescing.md) — collapsing
  continuous manipulation into intention-sized steps: explicit tags vs time
  windows, and the boundary events that close a step.
- [stack-policy](techniques/stack-policy.md) — bounds, eviction order, what a
  destructive eviction owes the user, and per-document vs global stacks.
- [redo-semantics](techniques/redo-semantics.md) — linear invalidation vs
  history trees, and communicating the loss honestly.
- [undo-scope](techniques/undo-scope.md) — what undo touches: document vs
  view state, cross-object operations, and the multi-surface question.
- [checkpoint-restore](techniques/checkpoint-restore.md) — coarse restore
  points as fine-grained undo's complement, and restores that are themselves
  reversible.
