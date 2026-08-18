---
layer: technique
subject: table
technique: loading-and-empty-states
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Loading and empty states

A table body is asynchronous by nature, so "what does the user see between
asking and receiving" is not an edge case — it is a state the surface occupies
on every single use. The technique is a small state machine plus a set of
prohibitions, and the prohibitions matter more than the visuals: every classic
loading defect is one of the forbidden transitions shipped by accident.

## The state machine

Body state is a function of two inputs: `inFlight` (is a fetch outstanding)
and `rows` (what data is currently held), plus a sticky `settled` bit (has any
fetch completed) and the last failure.

```
state(inFlight, rows, settled, error):
  if error and rows is empty        -> ERROR
  if inFlight and rows is empty     -> EMPTY-LOADING
  if rows is non-empty              -> POPULATED (refreshing if inFlight)
  if settled                        -> EMPTY-SETTLED
  else                              -> EMPTY-LOADING   # not yet asked ≈ asking
```

The ordering is the content: presence of rows dominates everything except a
hard failure with nothing to show, and "empty" is only assertable after
settling.

## EMPTY-LOADING — the ghost under the chrome

- **Chrome renders first and always.** Header row, toolbar, footer shell —
  everything derivable from schema and query state appears immediately. The
  placeholder describes only the *body*.
- **The placeholder is geometry-matched**: row-shaped blocks at the real row
  height, roughly the real column layout, in low-contrast neutral tone with a
  slow, calm shimmer or none. Its job is to promise the shape of what is
  coming and hold the layout still so the arrival of data moves nothing. Vary
  the placeholder bar widths deterministically across rows and columns so the
  block reads as rows of data, not a barcode of identical stripes.
- **Delay its appearance** (on the order of 150–300ms). Warm loads settle
  inside the delay and the user never sees a placeholder — the fastest
  loading state is the one that never renders. Without the delay, every warm
  path flashes.
- **A spinner is not a table loading state.** A centered spinner carries no
  shape information, recenters the layout twice (appearing and vanishing),
  and reads as the *surface* being absent rather than the *data* being in
  flight. Spinners belong on action controls the user just pressed, where
  they answer "did my press register" — a different question owned by a
  different surface.

## POPULATED-REFRESHING — data never yields to its own refresh

Once rows are on screen, no fetch may replace them with a placeholder. The
user's mental model is "my data, being updated", and the rendering must match:
existing rows stay put and interactive; at most an ambient indicator (a thin
progress affordance in the chrome, a subtle opacity shift) admits the fetch.
When the response lands, rows update in place — keyed by identity, so update
means *update*, not teardown-and-recreate.

This rule has a corollary for filter changes: applying a filter re-enters
in-flight with rows present. Either keep showing the old rows dimmed until the
new response lands, or clear to EMPTY-LOADING — but pick one per product and
apply it everywhere; mixing the two makes the surface feel nondeterministic.

## EMPTY-SETTLED — empty is a claim, and it names its cause

Rendering "no results" is asserting a fact about the dataset. Two rules:

1. **Only after settling.** Rendering the empty state while the first fetch is
   in flight shows the user a false "nothing here" for however long the
   round-trip takes — the *empty flash*, the single most common table defect.
   The sticky `settled` bit exists precisely to make this state unreachable
   before data has ever arrived.
2. **Empty states are typed by cause**, because each cause has a different
   next action:
   - **Nothing exists yet** → orientation plus the creation or setup action.
     This is a first-run surface; it deserves design attention, not a shrug.
   - **Nothing matches the current query** → say so *naming the predicate*
     ("no results for ‘…’ / with these filters") and offer one-tap clearing.
     The user's next question is "is my data gone?" — answer it.
   - **Nothing visible at this permission level** → distinct again; the fix is
     a request or an account action, not a filter change.

## ERROR — failure is not empty success

A failed fetch with nothing to show renders a **failure state**: visually and
semantically distinct from empty, stating that the system could not answer
(not that the answer is zero), preserving the user's query state, offering
retry. Collapsing failure into the empty state is the surface lying about
what it knows — the user reads "you have no data" when the truth is "I
couldn't look". If a *refresh* fails while rows are shown, keep the rows,
surface the failure ambiently, and say how stale the data now is.

## Arrival choreography

When first data lands, rows may enter with a brief stagger — it communicates
"arriving" and softens the placeholder-to-data swap. Constraints that keep it
craft instead of noise:

- **Coupled to the loading transition**: the cascade plays once, on the
  EMPTY-LOADING → POPULATED edge, not on every render.
- **Guarded by identity**: a row animates on *its own first appearance*, and
  never again for resorting, refresh, or pagination reuse. Track which
  identities have been seen; positional guards replay animation on whoever
  moved into the slot.
- **The seen-set outlives the rows.** Under windowed rendering, rows unmount
  when scrolled away and remount on return; a guard stored in row-local state
  dies with the row and the animation replays on every scroll-back. The
  set of entered identities lives at table scope (and resets only on an
  explicit context change, such as a new filter), not inside the row.
- **Fast and settle-able**: tens of milliseconds of per-row offset, quick
  fade/rise, honoring reduced-motion preferences by settling instantly.

## The prohibitions, collected

1. Chrome never unmounts because data is in flight.
2. A placeholder never covers rendered rows.
3. Empty is never asserted before the first settle.
4. Error never wears the empty state's clothes.
5. A placeholder never appears on a warm load (delay it).
6. Entrance animation never replays for a row that merely moved.
