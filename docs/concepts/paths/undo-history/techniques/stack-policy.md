---
layer: technique
subject: undo-history
technique: stack-policy
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Stack policy

Every history entry is an allocation, and allocations name their reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)). For an undo
stack the reaper questions are: how deep does the stack go, what is evicted
when it overflows, what happens to the stack at session and document
boundaries, and who is told when eviction crosses something they cared
about. A team that answers none of these has still shipped answers — depth:
unbounded; reaper: the out-of-memory handler; notification: a crash report.

## The bound

The stack has a **hard entry cap**, chosen from the model arithmetic (the
undo-model-selection technique): captured-slice size × depth must sit
comfortably inside the memory budget. Two secondary observations:

- **Depth is measured in gestures, not events.** With coalescing in place
  (the gesture-coalescing technique), each entry is one user intention, so
  a bound in the dozens covers minutes-to-hours of real editing. Without
  coalescing, no bound is right: eighty entries is two seconds of dragging
  *and* an afternoon of careful edits. Fix coalescing before tuning depth.
- **A byte budget can back the entry cap** when step sizes vary wildly
  (mostly-small edits punctuated by huge paste operations). Entry-capped
  stacks with unbounded entry *sizes* have only moved the leak.

## Eviction order and the destruction warning

When the cap is hit, **evict the oldest step** — the bottom of the stack.
This is the only defensible order: the user's mental model of undo is a
walk backward through recent intention, and recency is the whole structure.
Evicting by size or "importance" makes undo stop at an unpredictable point.

Eviction is *destruction of reversibility*: the state before the evicted
step is now unreachable by undo. For most fine-grained steps this is fine
and silent — nobody misses the 81st-most-recent keystroke run. It stops
being fine when a **destructive, hard-to-reconstruct step** ages toward the
bottom: a bulk delete, a paste-over, an import that replaced everything.
Two honest responses, either acceptable:

- **Promote instead of warn**: when a step classified destructive is about
  to evict, convert its before-state into a checkpoint (the
  checkpoint-restore technique) so coarse recovery survives fine-grained
  eviction. This is the better answer where checkpoints exist — silent,
  safe, no dialog.
- **Warn at the destructive act, not at eviction**: systems without
  checkpoints surface the stakes when the user *performs* the barely
  reversible act ("this replaces your arrangement — continue?"), accepting
  that undo protection is depth-limited. Warning *at eviction time* — an
  alert about an action from eighty steps ago — is noise; no user can act
  on it.

What is never acceptable: a destructive step silently aging out while the
product's own messaging says "don't worry, you can always undo".

## Redo shares the budget

The redo side (steps undone but not yet invalidated — the redo-semantics
technique) holds the same kind of entries and counts against the same
budget. In practice redo depth is naturally bounded by undo depth and needs
no separate policy — but it does need to be *included* in the byte
accounting, because an undo-to-the-bottom leaves the entire history sitting
on the redo side.

## Stack per what?

The stack's scope must match the scope of the user's intention stream:

- **Per document/workspace, not global.** Undo in document A must never
  revert an edit in document B. A global stack interleaves intention streams
  the user experiences as separate; the gesture becomes a roulette wheel.
- **Per document, not per widget — usually.** Within one document, edits
  made through different panels are one intention stream (the user did them
  in an order; undo walks that order), so they share a stack. The exception
  is a genuinely independent editing surface embedded in a larger one (a
  code editor inside a form field): its micro-history is its own while
  focus is inside, and its committed result is one step in the host's
  stack. The seam is focus plus commit — the undo-scope technique owns the
  full treatment.
- **Lifetime is the editing session's, explicitly.** Fine-grained stacks
  die when the document closes; anything meant to survive is a checkpoint
  or a durable version (different subject). If a stack *is* persisted
  across sessions, that is a real feature with real costs — serializable
  steps, migration when the schema changes, stale-reference validation on
  load — and must be chosen, not inherited from whatever the state library
  happened to serialize.

## Clearing is an event, not a hygiene habit

Some events genuinely invalidate history — the document was replaced from
outside (reload from disk after external change, a sync overwrite, a
restore to a checkpoint under a policy that clears). Clearing the stack at
those points is correct. What is not correct is clearing as a lazy escape
hatch for hard cases: clearing on save (save is not an edit; undo across a
save is expected everywhere), clearing on panel switch within one document,
clearing because a migration didn't want to update step shapes. Every
`clear()` call site should name the invalidating event it responds to; a
clear with no event attached is a bug filed by the implementation against
its own users.

## Prohibitions

1. No unbounded stack, in entries or in bytes.
2. No eviction order other than oldest-first.
3. No destructive step evicting silently while undo is advertised as the
   safety net — promote it to a checkpoint or warn at the act.
4. No global stack spanning documents the user experiences as separate.
5. No stack cleared on save, or on any event that did not invalidate the
   history.
6. No persisted-across-sessions stack that wasn't deliberately designed for
   persistence.
