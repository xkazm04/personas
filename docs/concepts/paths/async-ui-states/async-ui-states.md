---
layer: golden-path
subject: async-ui-states
status: forged
techniques:
  - state-model
  - placeholder-design
  - action-busy-states
  - empty-state-design
  - failure-states
  - arrival-choreography
evidence:
  - docs/design/overview-loading.md                                    # the five loading laws — this repo's own surface doctrine, matched by the state model
  - src/features/shared/components/display/UnifiedTable.tsx            # three-state body under permanent chrome; cascade coupled to the load cycle (resolveRowReveal)
  - src/features/shared/components/buttons/AsyncButton.tsx             # the pressed-control contract: synchronous disarm, promise-tied busy, finally-released guard
  - src/features/shared/components/layout/RouteChunkSkeleton.tsx       # code arrival as data arrival: delayed, header-band-only lazy fallback
  - src/features/shared/components/feedback/ScenarioEmptyState.tsx     # cause-typed empty states: scenario variants, NoResults (no-match), InboxZero (zero-as-goal)
  - src/hooks/utility/interaction/useProgressiveReveal.ts              # the surface-scoped seen-set behind one-shot entrance (useRevealTracker)
counter_evidence:
  - src/features/shared/components/feedback/LoadingSpinner.tsx         # renders null by design — every call site treating it as a busy affordance ships invisible feedback
deviations:
  - w1-async-ui-states   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Async UI states

Almost every surface in a data-driven product renders before it holds the data
it exists to show. The gap between *asking* and *receiving* is therefore not an
edge case to be patched with a spinner — it is a state the surface occupies on
**every single use**, and what the user sees during it is a designed contract:
what renders before data arrives, what renders while it is in flight, what
renders when it arrives empty, full, or not at all, and what happens when data
that already arrived is refreshed.

Products that treat this contract as an afterthought all converge on the same
defects: layouts that jump when data lands, a flash of "no results" before the
first response, headers that vanish mid-refetch, failures dressed up as empty
datasets, and spinners that answer no question anyone asked. Every one of those
is a violation of a small number of rules, and the rules are enumerable.

## Chrome and content: the stability split

Every async surface divides into two regions with different stability
guarantees, and the division is the single most consequential structural
decision in its implementation.

**Chrome** is everything derivable from what the surface already knows at
render time: its title, its layout scaffolding, its toolbar and filters, its
column or section headers, its navigation, its footer shell. Chrome comes from
the *schema and the query* — the surface's understanding of its own job — so it
renders immediately, unconditionally, and never disappears because data is in
flight. A filter bar that unmounts during a refetch is the surface forgetting
what it is; a title that appears only with the data tells the user the page
itself might not exist.

**Content** is everything derived from the *data*: the rows, the cards, the
chart series, the detail fields. Data arrives late, changes, and sometimes
fails — so all volatility belongs to content, and only content has a state
model. Chrome has none.

The classic defect family — layout shift on arrival, empty-flash, vanishing
controls — traces to exactly one mistake: content's volatility accidentally
applied to chrome, usually via a top-level "if loading, return placeholder"
branch that replaces the entire surface instead of only the content region.

## The state model

The content region of an async surface is always in exactly one of these
states, and the transitions between them are part of the design:

| State | Meaning | Shows |
| --- | --- | --- |
| **unstarted** | nothing requested yet | same as loading — from the user's seat, "about to ask" and "asking" are one state |
| **loading** | first request in flight, nothing held | chrome, with a calm geometry-matched placeholder *under* it, delayed so warm loads never flash it |
| **settled-data** | request complete, content held | the content |
| **refreshing** | content held, a request in flight | the *existing content*, with at most an ambient indicator — never a placeholder over data |
| **settled-empty** | request complete, zero content | an empty state that names *why* it is empty and offers the next action |
| **failed** | request failed, nothing held | a failure state, visually and semantically distinct from empty, with a retry path |

Two structural properties make this model honest rather than decorative:

- **The settled bit is sticky.** "Has any request ever completed" is recorded
  once and never unset. It exists to make `settled-empty` unreachable before
  the first response — the empty-flash defect is precisely this state rendered
  without the guard.
- **Data presence dominates.** Once content is held, no request may demote the
  surface below `refreshing`. A refresh that replaces rendered content with a
  placeholder punishes the user for the system doing its job.

The full derivation function, the forbidden transitions, and the reasons state
must be *derived* from the request machinery rather than hand-maintained are
the [state-model](techniques/state-model.md) technique.

## The two loading questions

Every piece of loading feedback answers one of two different questions, and
conflating them is the most common loading defect in interactive products:

- **"Where is my data?"** — asked of a *surface* (a page, panel, list, chart)
  fetching what it displays. The answer is a calm, geometry-matched placeholder
  under permanent chrome: it promises the shape of what is coming and holds the
  layout still. A spinner is the wrong answer here — it carries no shape
  information, recenters the layout twice, and reads as the surface being
  absent rather than the data being in flight.
- **"Did my press register?"** — asked of a *control* the user just activated
  (save, send, retry, approve). The answer is a real, visible busy affordance
  on the control itself — in place, immediate, paired with disabling so the
  press cannot double-fire. A ghost is the wrong answer here; the user is not
  waiting for shape, they are waiting for acknowledgment.

Same product, opposite prescriptions, and the boundary is bright: **spinners
belong to pressed controls; placeholders belong to loading surfaces.** The two
sides are elaborated in [placeholder-design](techniques/placeholder-design.md)
and [action-busy-states](techniques/action-busy-states.md).

## The honesty rules

An async surface can lie in three ways, and each lie has a rule against it:

1. **Never assert empty before settling.** "Nothing here" rendered while the
   first response is in flight is a false statement with a lifetime of one
   round-trip and a cost of trust — the user saw their data missing. Empty is
   a *claim about the dataset*, assertable only after a response has arrived.
2. **Never dress failure as empty.** Zero-because-nothing-exists and
   zero-because-the-request-died are different facts, must look different, and
   offer different next actions (create or adjust the query vs retry). A
   surface that renders its empty state on failure is telling the user "you
   have no data" when the truth is "I couldn't look".
3. **Never hide held data.** Once content is rendered, refreshes are invisible
   or ambient; a failed refresh keeps the content on screen, admits the
   failure quietly, and says how stale the data now is. Blanking a populated
   surface — for a refresh, a filter change handled carelessly, or a failure —
   destroys context the user was standing on.

The taxonomy of honest empty states is
[empty-state-design](techniques/empty-state-design.md); the taxonomy of honest
failure is [failure-states](techniques/failure-states.md).

## Warmth: the best loading state is none

Loading feedback is a cost paid when the system is slow; the senior move is to
make the feedback unnecessary before making it pretty.

- **Delay every placeholder** (on the order of 100–300ms). Responses that
  arrive inside the delay render no loading state at all — the fastest loading
  state is the one that never appears. Without the delay, every warm path
  flashes a ghost for two frames, which reads as flicker, not feedback.
- **Content is never held.** The inverse rule, equally binding: the moment
  data exists it renders. No minimum placeholder duration, no exit animation
  gating the swap, no choreography that makes arrived data wait for a ghost
  to finish performing. The delay lives on the placeholder's *entrance*,
  never on the content's.
- **A surface that unmounts should not forget.** Navigation that destroys and
  recreates a surface must not re-ghost content the user already saw; retain
  the last-known content beyond the surface's own lifetime, paint it
  immediately on return, and refresh behind it. Return visits land in
  `refreshing`, not `loading`.
- **Code arrival is data arrival.** When the surface's own implementation
  loads lazily, that wait is part of the same contract: the region shows a
  placeholder consistent with the eventual chrome, not a blank hole or a
  centered spinner. The user does not distinguish "your code is coming" from
  "your data is coming", and the surface should not either.

## States are per-region, not per-page

A page composes many async regions — a summary strip, a list, a side panel —
each with its own request and its own state. Collapsing them into one page
that waits for the slowest request (or one shared busy flag) couples every
region's fate to the worst one and produces the all-or-nothing reveal that
makes products feel heavy. Each region runs the state model independently;
chrome shared between them renders once, unconditionally. The corollary for
actions: a busy affordance scopes to the *item* acted on, never to a shared
scalar that lights up every sibling.

## Announced, not just drawn

The state model must reach assistive technology, not only the pixels:

- Loading and busy states are exposed to the accessibility layer on the region
  or control that owns them, and meaningful transitions (finished loading,
  failed) are announced via a live region rather than relying on visual change.
- A busy control is disabled *and* announced as busy — disabling alone reads
  as "broken" to a non-visual user.
- Arrival must not steal focus, and a placeholder is never focusable content;
  it is presentation, hidden from the accessibility tree.
- Motion in placeholders and entrance choreography honors reduced-motion
  preferences by settling instantly.

## The techniques

- [state-model](techniques/state-model.md) — the derivation function, the
  sticky settled bit, forbidden transitions, and why state is computed from
  the request machinery instead of hand-maintained flags.
- [placeholder-design](techniques/placeholder-design.md) — geometry-matched
  ghosts, appearance delays, zero layout shift, calm motion.
- [action-busy-states](techniques/action-busy-states.md) — the pressed
  control's contract: real progress in place, double-fire prevention, per-item
  scope, announced state.
- [empty-state-design](techniques/empty-state-design.md) — settled-only
  assertion and the cause-typed taxonomy: first-run, no-match, permission.
- [failure-states](techniques/failure-states.md) — failure as a first-class
  state: distinct from empty, retry that retries, staleness admitted.
- [arrival-choreography](techniques/arrival-choreography.md) — staggered
  entrance coupled to the load cycle, guarded by identity, played once.

Where the surface is specifically a table, the table subject specializes this
doctrine — chrome/body split, row-shaped ghosts, and the body state machine —
in its [loading-and-empty-states](../table/techniques/loading-and-empty-states.md)
technique.
