---
layer: technique
subject: triage-queues
technique: source-normalization
status: forged
laws:
  - one-authority-per-vocabulary
  - failure-not-empty-success
shared_with: []
---

# Source normalization

A unified inbox earns the word "unified" at exactly one boundary: the
adapter layer where every source's native shape is translated into one item
contract. Everything downstream — ordering, grouping, focus presentation,
bulk verdicts, counts — is written once against that contract. Everything
upstream stays as heterogeneous as reality demands. The technique is the
discipline of keeping that boundary absolute.

## The item contract

One shape, declared in one place, that every adapter must produce in full:

- **Identity** — a key that is stable across refreshes and unique across
  *all* sources, not just within one. The safe construction is a composite
  of source tag and the source's own identifier; two sources' raw numeric
  ids will eventually collide, and the collision manifests as a verdict
  landing on the wrong item.
- **Source tag** — a value from a closed, centrally declared set. The set of
  sources is a vocabulary, and it must have exactly one authoritative
  definition that adapters, verdict routing, filters, and per-source counts
  all derive from — two hand-maintained copies of the source list drift the
  day someone adds a source and finds only one of them
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
- **Severity or priority** — mapped *into the queue's scale*, not passed
  through. Every producer grades on its own curve; one producer's "high" is
  another's background noise. The adapter is where the exchange rate is
  applied, explicitly and reviewably, so the queue's ordering compares like
  with like.
- **Timestamps** — normalized to one epoch and one meaning (raised-at, not
  a mix of created-at, updated-at, and last-seen-at depending on source).
- **Presentation fields** — a summary the operator can judge from, composed
  by the adapter from source fields. Composing it downstream in the view
  layer reintroduces per-source branching at the exact place the contract
  was supposed to remove it.
- **The verdict set** — which decisions this item admits. Not all sources
  support all verdicts; the contract carries the admissible set so the
  surface renders real controls, never a button whose write-back has no
  route.
- **Origin link** — enough addressing to navigate back to the item's home
  surface. The queue is a work surface, not the system of record; there
  must always be a door back to the record.

## Per-source metadata survives — inside a compartment

Normalization flattens what the *shared* machinery needs; it must not
destroy what the *verdict* needs. The contract carries a per-source payload
compartment — opaque to ordering and grouping, available to the detail
presentation and to write-back. The two failure modes are symmetric: leak
the native shape into the shared fields and downstream code forks per
source; strip the native detail entirely and the operator must navigate to
the origin before every verdict, which forfeits the queue's entire
efficiency claim.

## Fan-in is a read model

The aggregation reads N sources and merges; it owns no items. This has two
consequences worth engineering deliberately. First, the merge must tolerate
per-source latency skew — sources refresh on their own cadences, and the
merged view recomputes as each arrives rather than blocking on the slowest.
Second, the aggregation never becomes a second store of truth: it holds no
state a refresh cannot rebuild from the sources, because any state it did
hold would need its own reconciliation protocol against N owners.

## Source-count honesty

The surface reports per-source counts — and a source that **failed to load
is not a source with zero items**. Rendering a fetch failure as an empty
contribution is the most expensive lie an aggregation surface can tell: the
operator sees a calm queue, concludes there is nothing to do, and the
failed source's items age silently until they become incidents. The merged
view carries per-source status (loaded, loading, failed) alongside the
counts, and the surface renders a failed source as *visibly failed*
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The same rule applies to the queue's headline count: it is a sum over
*loaded* sources and should say so when any source is dark.

Honesty has a second, quieter clause: **a full fixed-limit page is a slice,
not a total**. A source read at a cap of fifty that returns fifty has said
nothing about what sits behind the page — so the surface may not print a
number for it, and above all its *cleared* state may not claim "nothing is
waiting" while any source's working set is a slice. The rule that survives
transplant: only a source that reports its own total may be quoted as a
count; every capped source that came back full contributes "there may be
more", and the empty-queue ending must distinguish "the world is clear"
from "your working set is clear" whenever any source is capped or dark. A
triage surface that under-reports work is worse than one that is visibly
broken, because the operator stops looking.

## Adding a source is the acceptance test

The technique's success criterion is concrete: adding source N+1 means
writing one adapter, one entry in the source roster, and one verdict
route — zero edits to ordering, presentation, focus mode, or bulk
machinery. The roster entry is not bookkeeping: the golden path's largest
measured failure is producers that never registered, whose queues no
unified surface reports and no human ever drains. The first time a new
source requires a special case downstream of the adapter, the boundary has
been breached, and the cost of re-sealing it only grows with each further
source admitted through the breach.
