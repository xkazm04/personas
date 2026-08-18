---
layer: technique
subject: undo-history
technique: redo-semantics
status: forged
laws: []
shared_with: []
---

# Redo semantics

Undo's semantics are settled; redo's are where designs quietly fork. The
moment a user undoes and then does something *new*, history has branched:
the undone steps describe one future, the new edit begins another. Every
undo system must pick one of two contracts for that moment — and the pick
must be total, implemented everywhere, and communicated. The defect this
technique exists to kill is not either contract; it is the unchosen middle,
where redo's behavior after divergence is an accident of the data structure.

## The linear contract: divergence invalidates redo

The standard, and the right default. History is a single line with a cursor:
undo moves the cursor back, redo moves it forward, and **any new edit while
the cursor is not at the tip truncates everything ahead of the cursor**
before appending. The undone steps are discarded — genuinely gone, their
memory released.

Why this loss is correct behavior:

- It matches the dominant mental model. Decades of editing surfaces have
  taught users exactly this contract; meeting it is worth more than the
  rescued branch.
- The alternative *inside a linear UI* is incoherent. Keeping the orphaned
  branch while showing a linear undo/redo pair means redo after divergence
  either replays a stale future onto a state it no longer matches, or
  surprises the user with time travel to a state that contradicts what they
  just did. Both are worse than honest loss.
- The loss is small by construction. The invalidated steps are ones the
  user *already chose to revert* and then edited past; regret is possible
  but rare, and checkpoints (the checkpoint-restore technique) catch the
  expensive cases.

Implementation notes that get missed:

- **Truncate on the edit, not on the next redo.** The redo side must read as
  empty the instant the divergent edit lands — a redo control that stays
  enabled and then no-ops (or worse, fires) is the unchosen middle.
- **Truncation is eviction** and follows stack policy: if anything on the
  redo side was classified destructive-to-lose, the same
  promote-to-checkpoint response applies (the stack-policy technique).
- **Undo/redo are not edits.** Only genuine document mutations truncate.
  An implementation that routes undo itself through the "new edit" door
  truncates its own redo side on every undo — the classic sign this
  contract was assembled rather than designed.

## The tree contract: divergence forks

The alternative: keep every branch. Each edit appends a node under the
current one; undo moves to the parent; a new edit after undo creates a
*sibling* branch; nothing is ever invalidated. Redo at a fork must choose a
child — typically the most recent branch by default, with an affordance for
picking another.

Price it honestly:

- **The UI is the feature.** A history tree without a navigable
  visualization is worse than linear — users cannot form a model of an
  invisible tree, and "redo" at a fork becomes a dice roll. If you choose
  the tree, you are committing to a history panel: branches visible,
  labeled (step names from gesture coalescing), current position marked,
  any node reachable by click.
- **Memory policy compounds.** Bounds and eviction (the stack-policy
  technique) now apply to a tree — evicting oldest-*visited* vs
  oldest-*created* vs whole dead branches are genuinely different policies,
  and each orphans different futures.
- **The shortcut keys keep linear semantics anyway.** Even tree-history
  products bind the platform undo/redo gestures to walk the *current
  branch*; the tree is reached through the panel. Users get the familiar
  contract at their fingers and the safety net in the panel — which is the
  real argument for the tree: it is linear undo plus a recovery surface,
  not a replacement mental model.

The tree earns its cost in surfaces where exploration is the workflow —
generative variations, parameter experimentation, branching drafts — and
where losing an abandoned direction destroys real work. For ordinary
editing, linear-plus-checkpoints delivers most of the safety at a fraction
of the complexity.

## Communicating the contract

Whichever contract, the user learns it through the controls:

- **Redo availability is always truthful.** Enabled means "there is a step
  and this will apply it"; after divergence under the linear contract it
  disables immediately. Step names on the controls ("redo move") make the
  cursor position legible for free.
- **Never resurrect silently.** If a design wants to soften linear loss
  (keeping the last orphaned branch in a "recently discarded" recovery
  affordance), the recovery is explicit and named — never spliced back
  onto redo.
- **Undo of a redo is undo.** Cursor semantics, stated once: redo then undo
  returns exactly to the pre-redo state. Any implementation where the pair
  is not a fixed point has broken cursor arithmetic, and this is the first
  property a round-trip test should assert.

## Prohibitions

1. No unchosen middle: divergence either truncates (linear) or forks into a
   navigable tree — never "whatever the arrays did".
2. No redo control that remains enabled after a divergent edit under the
   linear contract.
3. No tree contract without a visible, navigable history surface.
4. No treating undo/redo themselves as edits that truncate the redo side.
5. No silent replay of orphaned branches onto diverged state.
