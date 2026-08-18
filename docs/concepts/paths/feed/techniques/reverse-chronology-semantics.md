---
layer: technique
subject: feed
technique: reverse-chronology-semantics
status: forged
laws:
  - identity-survives-reuse
  - one-authority-per-vocabulary
  - count-carries-predicate
shared_with: []
---

# Reverse-chronology semantics

"Newest first" sounds like one decision; it is four. Which time orders the
feed, how ties are broken, what happens when events arrive out of order, and
how time is displayed to the reader. Each has a wrong answer that ships fine
and fails weeks later, when the producers get busy or the clocks get weird.

## Decision 1: which time

Every occurrence carries at least two timestamps:

- **Event time** — when the thing happened, stamped by the producer.
- **Arrival time** — when this store learned of it, stamped by the store.

They diverge whenever production and ingestion are decoupled: offline
producers syncing up, retried deliveries, batch imports, cross-machine clock
skew. The feed must pick one as its ordering key and hold that choice
everywhere — the query, the cursor, the read-position anchor, the dedupe
window all inherit it, which makes this a vocabulary with one authority: the
ordering key is defined once, and every consumer derives from that
definition rather than choosing per call site.

The default is **event time**, because the feed's promise is "what happened,
in the order it happened", and a batch of synced-up history interleaving at
its true positions is that promise kept. Choose **arrival time** only when
the feed's real job is "what did this system learn, in the order it learned
it" — an ingestion monitor, a replication tail — and then say so in the
surface's own framing, because readers assume event time.

The one configuration that is never acceptable: ordering by one time and
cursoring or anchoring by the other. The cursor is the ordering-key tuple;
if they disagree, pages tear at exactly the rows where the two times
diverge.

## Decision 2: the total order

Timestamps are not unique — equal values within one clock tick are routine
under bursty producers, and equality is precisely where an underspecified
order bites. The feed's order is the composite: **timestamp descending, then
identity descending** (any deterministic direction on the tiebreaker works;
pick one and keep it). This is the row-identity invariant doing its quiet
work: because identity is unique and immutable, the composite is a total
order, so two renders, two pages, and two replicas agree on the sequence,
and the keyset cursor — which is this same tuple — resumes unambiguously.

The observable defect of a partial order is rows swapping places across a
refetch. In most surfaces that is cosmetic; in a feed it is a broken
contract, because position *is* the meaning.

Three corollaries, each with a measured failure behind it:

- **Normalizing a key for comparability destroys resolution, and whoever
  destroys it owes the tiebreaker in the same change.** Merging sources
  whose timestamps use different precisions forces a projection to a common
  form — and truncating a nanosecond key to seconds took one measured event
  stream from zero collisions to 72% collisions at the projection site. The
  raw columns were innocent; the read manufactured the ties. After the
  projection no consumer can tell a real tie from a manufactured one, so the
  layer that projects is the last layer that can pay correctly.
- **Every consumer of the ranking ranks identically.** A store that pages on
  the composite tuple and a rendering layer that re-sorts on the timestamp
  alone do not disagree loudly — under a stable sort, tied rows silently
  fall into *input iteration order*, and any window cut through a tie keeps
  or drops rows by that accident. The comparator is written once and copied
  verbatim to every rank site, with the copy marked as a copy.
- **A comparator must be able to say "equal".** A two-branch comparison
  (`a < b ? after : before`) reports "greater" for equal keys, which is not
  a consistent total order — the sort's result is then formally undefined.
  Three-way comparison, always; equality falls through to the tiebreaker.

## The key is minted by the authority, never by the renderer

An occurrence's ordering key must come from whoever timestamps its
neighbors — normally the system of record at write time. The recurring
violation is the optimistic item: the surface appends a locally-created row
and stamps it with the rendering device's clock, placing one clock's reading
into a sequence minted by another. Even a perfectly synchronized client
clock reads a different instant than the one the server will assign, so the
optimistic row lands at an arbitrary point in the order — and when the
server's confirmation arrives with the real key, the row *moves*.

Two honest forms: render the optimistic item **outside the ranked list**
(a pending strip at the feed's edge) until the authority assigns its key,
or adopt the server-echoed key on confirmation and only then admit it to
the ranking. Never "fix" this by switching clock APIs — the defect is whose
clock, not which call.

## Bucketing: the group key is the sort key

Long feeds bucket under day dividers ("Today", "Yesterday") and often under
sticky group headers. Two coherence rules:

- **Bucket on the same expression the order uses.** If the feed orders on
  a fallback chain (started-time, else created-time), the day bucket must
  be computed from the same chain — a row ordered by one field and bucketed
  by another lands under the wrong header whenever the two straddle a
  boundary.
- **The boundary and the label share a time zone.** A day boundary computed
  in universal time with a label computed at local midnight places the
  divider hours away from midnight and files the first hours of each local
  day under the previous day's header — measured live at exactly the
  operator's offset. Compute both in the reader's zone, from one helper,
  and never derive a calendar day by slicing a zone-suffixed string.

## Decision 3: late arrivals

Under event-time ordering, an occurrence can arrive whose true position is
below rows the reader has already seen. Two honest behaviors exist:

- **Insert at true position, silently.** Correct for history the reader has
  not reached yet — the past assembles itself before the reader gets there,
  and no promise is broken.
- **Insert at true position, and treat it as unseen.** Required when the
  insertion lands *above* the read-position anchor's horizon — the reader's
  "caught up" claim is now stale, and the unseen derivation must count the
  late row even though it is not the newest. An anchor-comparison scheme
  based purely on "newer than anchor" misses exactly these; the technique
  owning that trade-off is
  [read-position-and-unseen](read-position-and-unseen.md).

The dishonest behavior is appending late arrivals at the top because that is
where insertion is cheap — it fabricates a chronology that never happened
and poisons the cursor sequence (the row's tuple disagrees with its
position).

A feed whose producers are seriously out-of-order (multi-device, offline-
first) should surface the seam rather than hide it: a quiet "synced 12
earlier events" divider preserves trust in a way silent reshuffling never
can.

## Decision 4: displaying time

- **Relative timestamps for the recent past** ("4m ago") — recency is the
  reader's actual question, and relative form answers it without arithmetic.
  They must tick, or a feed left open lies within the hour.
- **Absolute recourse always.** Hover, tap, or expansion reveals the full
  timestamp; the accessible name carries it too. Relative-only is data loss;
  absolute-only is homework.
- **Cross the day boundary explicitly.** "Yesterday", then dates. Day
  divider rows are the cheapest orientation device a long feed has — they
  turn an undifferentiated scroll into navigable strata.
- **One clock for the rendering.** Producer-local times displayed raw
  produce feeds where scrolling down goes forward in time across a timezone
  seam. Normalize to the reader's clock at render; keep the stored value
  zone-unambiguous.

## What this technique refuses

No user-facing sort controls, ever. The moment "oldest first" or "by actor"
is offered, the surface has conceded that its job is comparison or lookup —
and the honest response is to build the table or the search view, not to
grow feed chrome sideways. Filtering (by kind, by actor) is legitimate feed
machinery — it narrows *which* occurrences show, not *how* they are ordered
— but every filter chip re-scopes the unseen count's predicate, and the
count must follow (a badge computed over the unfiltered stream rendered
beside a filtered list is a small honest number in the wrong context,
which makes it a lie).
