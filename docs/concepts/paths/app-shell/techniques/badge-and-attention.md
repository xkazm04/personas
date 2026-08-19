---
layer: technique
subject: app-shell
technique: badge-and-attention
status: forged
laws: [count-carries-predicate, derivation-names-recomputation]
shared_with: []
---

# Badge and attention

The navigation is on screen for the whole session, which makes it the
product's ambient attention channel: the place that says *something in a
section you are not looking at wants you*. This technique is about spending
that channel without bankrupting it — a nav where every entry glows is a nav
where nothing does.

## A badge is a count with a predicate and a lifecycle

Every badge answers three questions, in writing, before it ships:

1. **What does it count?** The predicate is exact — "executions in failed
   state awaiting acknowledgment", not "activity". A number that travels
   onto the nav carries what was counted and how, or it will be read as a
   claim it does not support
   ([law: a count carries its predicate](../../_laws.md#count-carries-predicate)).
2. **What makes it appear?** The event or state change that increments it,
   and whether it counts *entities in a state* (recomputable) or *events
   since a mark* (requires the mark to be stored).
3. **What makes it go away?** The forgotten question, and the one that
   decides whether the badge is trustworthy. A badge with no defined
   clearing rule converges on "always on", and an always-on badge is dead
   pixels the user has learned to unsee.

## Badges are derived, never hand-incremented

The badge value is a derivation from owned state — a query the shell can
re-run at any time — not a counter that event handlers increment and decrement
by hand
([law: a stored derivation names its recomputation](../../_laws.md#derivation-names-recomputation)).
Hand-maintained counters drift on every missed event, every double-fire,
every crash between increment and display; and a drifted badge is worse than
none, because the user opens the section, finds nothing, and learns the
product cries wolf. If the display caches the value (cheap re-render), the
cache names its recomputation and re-runs it on section entry, on
reconnection, and on any event that could have changed the predicate.

"Seen" is part of the state, not part of the display. Clearing a badge means
recording the mark (last-seen time, acknowledged ids) in the same owned state
the derivation reads — so the badge survives restart correctly in both
directions: still on if unhandled, still off if handled.

## Severity is a vocabulary, not a free-for-all

Attention has grades, and the nav renders them as a small closed set — at
most: a **count** (things await you), an **alert** (something failed and
needs a decision), and a **pulse/dot** (ambient newness, no action owed).
Each grade has one visual treatment defined at the shell level, so the user
learns three signals once — not one dialect per section. A section does not
get to invent a fourth grade because it feels important; importance is
expressed by *choosing the right grade*, and the scale stays meaningful
precisely because it is rationed.

Color alone never carries the grade: a count is a number, an alert has a
shape or icon, so the scale survives color-vision differences and
collapsed-to-dot renderings still have accessible text equivalents.

## Clearing rules, by badge kind

- **Inventory badges** ("N things in state X") clear themselves: the badge
  is a live query, and the count falls as the underlying items are handled.
  Merely *viewing* the section does not clear an inventory — the work still
  exists. This is the correct kind for actionable items.
- **Newness badges** ("things since you last looked") clear on genuine
  exposure: the user visibly reached the content, not merely hovered the
  entry, and clearing records the mark in owned state. Batch-clear ("mark
  all seen") is offered where volume is real.
- **Attention decays honestly.** If the product auto-decays a signal (an
  alert older than a threshold stops pulsing), the decay is a policy the
  user could be told, not an accident of a re-render — and decay never
  silently discards the underlying item; it demotes the *signal*, the work
  remains findable in the section.

## Routing: the badge points where the answer lives

A badge on a section entry is a promise: *enter here and you will find what
this is about*. The promise binds:

- The badged section's landing surface makes the badged items findable
  immediately — the failed items are surfaced, not buried three tabs deep
  behind the default view. If reaching the cause takes exploration, route
  the attention deeper (badge the sub-entry) or bring the cause to the
  landing surface.
- Parent aggregation is honest: a collapsed or parent entry may sum its
  children's badges, but entering it must reveal *which* child carried the
  count.
- One cause, one badge trail. The same underlying event does not light
  three sibling sections; attention converges on the one place the user
  should go.
- **One slot, ranked.** A nav entry offers one badge slot; when several
  signals compete for it, they are priority-ranked, the winner renders, and
  the losers are admitted as a small overflow marker with an on-demand
  enumeration (a hover or focus surface listing every active signal). Two
  full badges jostling on one entry is layout noise; a silent winner that
  hides its rivals is a lie about how much attention is owed.

## Budget: the channel is shared

Individual badges are designed one at a time; the nav is read as a whole.
Shell-level discipline:

- **Admission is deliberate.** A new badge source is a product decision
  (what grade, what predicate, what clearing rule), not a per-feature
  decoration. The scale of grades is owned once at the shell, and the shell
  can enumerate every badge source that feeds it.
- **Steady state is quiet.** For a healthy user on a healthy day, the nav
  shows zero or near-zero signals. If the default experience lights up half
  the entries, the predicates are wrong — recalibrate them, do not train
  the user to ignore the channel.
- Counts cap their display ("99+") — past a threshold the number stops
  informing and starts shaming.

## The prohibitions, collected

1. No badge ships without a written predicate and clearing rule.
2. No hand-incremented badge counters — derive, and name the recomputation.
3. No clearing on hover or on render — exposure means the user reached the
   content.
4. No section-invented signal grades; the scale is owned by the shell.
5. No badge whose section landing surface does not surface the cause.
6. No signal that never turns off.
