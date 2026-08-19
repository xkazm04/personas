---
layer: technique
subject: file-browsing
technique: selection-model
status: forged
laws: [identity-survives-reuse, count-carries-predicate]
shared_with: []
---

# Selection model

Selection is the browser's aiming mechanism: whatever set is selected is the
set the next mutation hits. That makes correctness here a safety property,
not a polish property — a selection bug does not render wrong, it *deletes
wrong*.

## Selection is a set of identities

The model is a set of item identities plus one **anchor** (the identity where
the last deliberate click landed, for range extension) and one **focus** (the
identity the keyboard cursor is on). Never positions, never indices, never
"the third visible row" — items are resorted, refreshed, filtered, and moved
while selected, and every one of those operations silently retargets a
positional selection onto different files. The user aimed at *files*; the
model must remember files.

Anchor and focus are identities too, for the same reason: a range extension
computed from a stale index after a resort selects a span the user never
looked at.

## The interaction grammar

The grammar is old, universal, and users' hands know it; deviate nowhere:

- Plain activation selects exactly one (replacing the set).
- The toggle modifier adds or removes one, leaving the rest intact, and
  moves the anchor.
- The range modifier selects from anchor to target *in current visual
  order* — range is the one legitimately positional concept, resolved to
  identities at the moment of the gesture, then stored as identities.
- Select-all, invert, and clear are keyboard-reachable.
- Keyboard traversal moves focus; modified traversal extends selection —
  the full grammar works without a pointer.

Ranges across grouping boundaries follow visual order, headers excluded.
Items excluded by an active filter are not selected by select-all — invisible
selection is the trapdoor variant of the aiming bug: the user deletes what
they can see plus something they cannot.

## Surviving refresh

The store changes under a live selection constantly — the browser's own
refresh guarantees it. The reconciliation rule: **intersect the selection
with the new listing by identity**. Surviving items stay selected; vanished
items drop out. Two disclosures attach:

- If the drop happens between aiming and firing — items vanish while a
  bulk-action bar is showing "14 selected" — the count updates visibly, and
  a mutation submitted against the old count re-validates against the live
  set rather than acting on ghosts.
- Selection is never *restored* across sessions. It is armed intent; intent
  does not survive the user walking away (the navigation-state technique
  draws the same line).

## Select-all against an unloaded universe

When the view is windowed, streamed, or capped, "select all" is ambiguous:
all *loaded*, or all *matching*? Both are legitimate; lying about which is
not. Either scope the gesture to what is materialized and say so ("52 loaded
items selected"), or represent all-matching as an explicit *predicate
selection* — "everything matching the current filter" — carried as a
predicate plus an exclusion list, and resolved at mutation time by the same
authority that owns the full set. The forbidden implementation is
materializing a partial universe and calling it everything: the count reads
complete, the action fires incomplete.

Every displayed count carries its predicate for the same reason — "14
selected" means 14 identities the next action will receive, not 14 highlight
rectangles currently painted.

## Selection drives the mutation surface

The bulk-action affordance (toolbar, context menu, floating bar) derives
everything from the selection set: which actions are available (some
mutations are single-target only; some are illegal across containers), the
count it displays, and the exact identity list it hands to the mutation. One
producer, many consumers — the moment an action button computes its own idea
of "what is selected", the aiming mechanism has two sights that can point at
different targets.
