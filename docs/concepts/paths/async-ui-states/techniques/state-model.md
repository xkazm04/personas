---
layer: technique
subject: async-ui-states
technique: state-model
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# The state model

The content region of an async surface has a small, closed set of states, and
the craft is not in naming them — it is in *deriving* them correctly and in
refusing the transitions that produce the classic defects. Most loading bugs
are not missing states; they are legal-looking transitions that should have
been forbidden.

## Inputs and derivation

State is a pure function of four inputs:

- `inFlight` — is a request currently outstanding
- `content` — what data the region currently holds
- `settled` — has *any* request ever completed (sticky, never unset)
- `error` — the last failure, cleared by the next success

```
state(inFlight, content, settled, error):
  if content is non-empty            -> SETTLED-DATA (REFRESHING if inFlight)
  if error                           -> FAILED
  if inFlight                        -> LOADING
  if settled                         -> SETTLED-EMPTY
  else                               -> LOADING        # unstarted ≈ loading
```

The ordering *is* the content of the model:

- **Presence of content dominates everything.** Held data outranks an
  outstanding request and even a failure — a failed refresh over rendered
  content stays in `SETTLED-DATA`, with the failure surfaced ambiently, never
  by demoting the region.
- **Failure outranks loading when nothing is held**, so a retry in flight
  after a failure may legitimately render as loading again — but only because
  the retry clears `error` when it starts, not because loading "wins".
- **Empty requires settling.** `SETTLED-EMPTY` is reachable only through the
  sticky bit; there is no path to "nothing here" that does not pass through a
  completed response.
- **Unstarted collapses into loading.** From the user's seat, "about to ask"
  and "asking" are indistinguishable and should render identically. Keep the
  distinction in instrumentation if the difference matters operationally, but
  never in the rendering.

## The sticky settled bit

`settled` is the guard that makes the empty-flash structurally impossible
rather than usually avoided. It is set on the first completed response —
success or failure — and never unset, not on refresh, not on filter change
within the same context. It resets only on an explicit *context change*: the
region is now asking a categorically different question (a different entity,
a different scope), at which point the region genuinely is a new surface and
may ghost again.

The subtle decision is what counts as a context change. A filter tweak on the
same dataset is not one — the honest renderings are either the old content
dimmed until the new response lands, or a return to loading; pick one policy
per product and apply it everywhere, because mixing the two makes the product
feel nondeterministic.

## Derive, never hand-maintain

The inputs must come from the request machinery itself — the thing that knows
whether a request is outstanding — not from booleans set and cleared by hand
at call sites. Hand-maintained flags drift in exactly the ways that matter:

- a flag set before the request and cleared in the success path stays `true`
  forever on failure — the surface loads eternally;
- a flag cleared in a shared completion path goes wrong the moment two
  requests overlap — the first completion clears the flag while the second
  request is still in flight;
- a flag owned by the surface dies with the surface, so remounting re-ghosts
  content the user already saw.

Overlap deserves explicit treatment: when a second request starts before the
first completes, the model needs a *latest-wins* rule — a response is applied
only if it belongs to the most recent request, checked by a token or sequence
carried with the request. Without it, a slow stale response lands after a
fast fresh one and the surface silently shows the wrong answer while claiming
to be settled.

## Forbidden transitions

The state table looks permissive; these edges are the ones implementations
ship by accident, and each is a named defect:

| Forbidden edge | The defect it ships |
| --- | --- |
| `SETTLED-DATA -> LOADING` on refresh | placeholder over rendered content — the refresh blanks the surface |
| anything `-> SETTLED-EMPTY` while unsettled | the empty flash — a false "nothing here" for one round-trip |
| `FAILED -> SETTLED-EMPTY` | failure dressed as empty success — the surface lies about what it knows |
| `SETTLED-DATA -> FAILED` on refresh failure | held data discarded because an update failed |
| chrome unmounting on any edge | the surface forgetting what it is |

## One model per region

A page composes many async regions, and each runs this model independently
over its own request. A single page-level busy flag is the model's most
common corruption: it couples every region to the slowest request, produces
the all-or-nothing reveal, and — because it is a scalar — cannot express one
region refreshing while another is settled. The same scoping rule applies
downward: a per-item operation (delete this row, approve this entry) owns a
per-item state, never a shared flag that marks every sibling busy.
