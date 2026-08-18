---
layer: technique
subject: async-ui-states
technique: arrival-choreography
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Arrival choreography

When first content lands on a loading surface, it may *arrive* — a brief
staggered entrance across items, a quick fade-and-rise — instead of popping
in as one frame-swap. Done well, it communicates "your data is arriving" and
softens the ghost-to-content transition. Done badly, it is the most annoying
kind of motion a product can ship: animation replaying on things the user
has already seen. The technique is almost entirely a set of guards; the
visual is the easy part.

## Coupled to the load cycle, played once

The entrance cascade plays on exactly one edge: **loading → settled-data** —
the transition where content the user has never seen replaces the
placeholder. It does not play on re-render, not on refresh, not on
pagination, not on tab return, and — under the identity guard below — a
resort animates nothing, because every identity has been seen. The trigger
is the load-cycle transition itself, not "the items happen to be mounting" —
mounting is an
implementation event that fires for dozens of reasons, and coupling
animation to it is how every replay defect ships.

A refresh that changes the content updates items in place; genuinely *new*
items appearing in a settled surface (a live feed, a background update) may
individually enter with the same brief motion, but the full-surface cascade
belongs to first arrival only.

## Guarded by identity

An item animates on **its own first appearance**, and never again. The guard
is the item's stable identity — the key minted by the system of record — not
its position:

- **Positional guards replay on whoever moved into the slot.** Guarding "row
  three has animated" means a resort animates row three again with a
  different record in it, and the user watches their table shimmer every
  time they click a column header.
- **The seen-set outlives the items.** Track the set of identities that have
  entered, at *surface* scope. Guards stored inside the item die with the
  item: under windowed rendering, items unmount when scrolled away and
  remount on return, and an item-local guard replays the entrance on every
  scroll-back. The set lives with the surface.
- **The mark is written by the entrance lifecycle itself** — on the item's
  own entrance completing — never by mere mounting, which fires for dozens
  of reasons unrelated to arrival. The load-bearing part is where the mark
  *lives* (the surface-scoped set), not the exact instant it is written.
- **The set resets only on an explicit context change** — the surface now
  asking a categorically new question: a different entity, a different
  scope. A product may additionally choose to treat a *user-issued re-query*
  (a filter or sort switch whose recompute is effectively instant) as a
  reset: the brief ripple on the new result set acknowledges that the answer
  changed, and when nothing was fetched, the cascade is the only response
  the user gets. That is a legitimate policy — but a *policy*, applied
  uniformly across the product, never an accident of where the guard was
  keyed. What is never a reset: poll, refresh, scroll, or pagination
  re-delivering identities already seen.

## Timing that reads as craft

- **Small offsets, fast items.** Tens of milliseconds of per-item delay,
  with each item's own motion well under a couple hundred milliseconds. The
  whole cascade should complete before the user's eye finishes its first
  scan; choreography that makes the user *wait* for rows they can already
  partially see has inverted its purpose — it is delaying data for theater.
- **Cap the cascade.** Stagger the first screenful; items beyond the fold
  enter plainly or with negligible offset. A thousand-item stagger is a
  progress bar wearing a costume.
- **Subtle geometry.** A short rise or slight fade — motion that suggests
  settling into place. Items flying in from off-screen, scaling, or bouncing
  turn every load into a title sequence.
- **Reduced motion settles instantly.** The preference disables the
  choreography entirely — content appears settled on the first frame. This
  must be the same code path as "cascade already played", not a parallel
  implementation that drifts.

## When to skip it entirely

Arrival choreography is a garnish, and the doctrine's warmth rules outrank
it: a warm load that renders inside the placeholder delay should paint
settled content immediately, with no cascade — animating content the cache
already held advertises slowness the product does not have. Skip
choreography for tiny regions (one to three items), for high-frequency
surfaces the user reloads constantly, and anywhere the motion would replay
more than once per session in normal use. The test is simple: if a user who
has seen the surface fifty times still sees the animation, a guard is
missing or the feature should not exist there.
