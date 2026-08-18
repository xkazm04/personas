---
layer: technique
subject: async-ui-states
technique: empty-state-design
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Empty state design

Rendering "nothing here" is not a fallback — it is an **assertion about the
dataset**, and the surface making it must be entitled to it and specific
about it. The two disciplines of this technique are *when* empty may be
claimed and *which* empty is being claimed; most empty-state defects are a
failure of one or the other.

## Entitlement: settled only

An empty state may render only after a request has completed. Rendered while
the first response is in flight, it is a false statement — "you have no
data" — with a lifetime of one round-trip and a cost paid in trust: the user
saw their data gone. The state model's sticky settled bit exists precisely to
make this unreachable; the design-side corollary is that an empty state is
never the *default* rendering of a region, never what shows "until something
better arrives". Empty is earned by a response.

The same entitlement rule separates empty from failure: a request that
*could not run* or *did not complete* proves nothing about the dataset, and
rendering the empty state on failure is claiming knowledge the surface does
not have. Failure has its own state and its own design —
[failure-states](failure-states.md) — and no shared rendering with empty,
however visually tempting the reuse.

## Every empty names its cause

"No items" is true in several different worlds, and the user's next action
is different in each — so the design is typed by cause, not shared:

- **Nothing exists yet** — first run, before the user has created or
  connected anything. This is an *onboarding surface*, often the first thing
  a new user sees in the region: it explains what will live here in one
  sentence and offers the next action as its primary affordance. It deserves
  design attention proportional to first impressions — which is to say, more
  than any other empty state, not less. It splits once more on what the next
  action *is*: when the region **cannot** produce data until a prerequisite
  is met (something must be connected, configured, enabled first), the copy
  names the missing thing and the action is the *setup*; only when creation
  is genuinely possible right now is it the first-use state with a creation
  action. Offering "create your first item" to a user whose real blocker is
  an unmet prerequisite is a dead end with friendly typography.
- **Nothing matches the current query** — data exists, the filter or search
  excludes all of it. The state *names the predicate* ("no results for this
  search", "nothing matching these filters") and offers one-tap clearing.
  The user's unspoken question is "is my data gone?" — the rendering answers
  it explicitly by blaming the query, not the dataset. Reusing the first-run
  state here is a small catastrophe: a user with three filters applied gets
  told to "create your first item" while forty items sit hidden. The
  discriminator is mechanical and worth stating: **branch on the raw
  collection, not the filtered one.** Filtered-empty with a non-empty raw
  collection is no-match; both empty is genuinely nothing. Deriving the
  branch from the filtered view alone is how the wrong empty state ships.
- **Nothing visible at this permission level** — data may exist but this
  account cannot see it. Distinct again: the next action is a request for
  access or an account change, not creation and not filter-clearing, and
  pretending otherwise sends the user down dead ends.
- **Zero is the goal** — a drained queue, no open incidents, nothing awaiting
  review. Here emptiness is the *success* outcome, and orientation copy is
  wrong twice over: this is a celebration tone (a check, a quiet "all
  clear"), not an onboarding pitch, and certainly not a creation action
  inviting the user to refill the queue. Note this is a *tone chosen from
  the entity's semantics*, not a new computed state — do not add a
  "had data before" flag to detect it.

The copy register follows the cause. First-run copy is *instructional future
tense* — what will appear here and how to make it happen. No-match copy is
*diagnostic present tense* — what is being excluded and how to widen it.
Prerequisite copy names the missing thing. Register mismatches are how empty
states read as templated even when the taxonomy is right.

If the surface cannot tell which cause applies, that is a data-contract gap
to fix upstream — the response should carry enough to distinguish "empty
dataset" from "empty result of this query" — not a licence for a generic
shrug.

One more prohibition guards the whole taxonomy: **never substitute sample or
simulated data for an empty state.** The empty state is the honest answer;
a mock is a fabricated one, and it will be read — and eventually aggregated
— as real. If demonstration values render at all, they carry a visible
not-real mark and stay out of every total computed over the region.

## Design posture

- **The empty state occupies the content region only.** Chrome stays: the
  toolbar, the filters, the header. The user must be able to *act* their way
  out of emptiness (create, clear, search differently), and the actions live
  in the chrome. A full-surface empty illustration that hides the controls
  locks the exit.
- **One idea, one action.** A sentence of orientation, at most a sentence of
  guidance, one primary action. Empty states that grow feature tours,
  multiple buttons, and marketing copy become the noisiest surface in the
  product precisely where there is nothing to look at.
- **Calm, not cute-at-scale.** Illustration and warmth are welcome in
  first-run states, which the user sees once. In no-match states — seen
  dozens of times a day by power users — brevity wins; an elaborate
  illustration replaying on every over-narrow filter reads as the product
  celebrating the user's dead end.
- **Empty in composition.** When one region of a page is empty while
  siblings hold data, the empty rendering stays proportionate — a quiet line
  in the region, not a hero illustration competing with real content. The
  page-level empty (every region empty, nothing exists at all) is the only
  one entitled to the full first-run treatment.

## Transitions in and out

Empty is a settled state, and it participates in the same honesty rules as
data: a refresh from `settled-empty` does not flash a ghost over the empty
state (the region is settled; refreshing is ambient), and arrival of first
data replaces the empty state cleanly — with entrance choreography if the
product uses it, per [arrival-choreography](arrival-choreography.md).
