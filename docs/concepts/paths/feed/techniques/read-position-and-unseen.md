---
layer: technique
subject: feed
technique: read-position-and-unseen
status: forged
laws:
  - derivation-names-recomputation
  - count-carries-predicate
  - identity-survives-reuse
shared_with: []
---

# Read position and unseen

The feed's promise — "what happened since you last looked" — is only as good
as its memory of when you last looked. That memory is the **read-position
anchor**, and the discipline around it splits into four questions: what is
stored, what is derived, when does "seen" happen, and what the badge is
allowed to claim.

## Store an anchor, derive the count

The durable record is an **anchor**: the ordering tuple — (timestamp,
identity) — of the newest occurrence the reader had seen when they last
disengaged. Everything else is derived:

- **unseen(occurrence)** = its tuple is newer than the anchor;
- **unseen count** = the number of occurrences newer than the anchor,
  under the feed's visibility predicate;
- **the "new since last visit" divider** = rendered at the anchor's
  position in the sequence.

The rejected alternative is a maintained counter — increment on arrival,
zero on view. Counters drift: an increment races a reset, a crash loses a
decrement, a second device zeroes what this one still shows, and once wrong
a counter has no way home, because it remembers nothing but itself. An
anchor cannot drift — it can only lag, and lag self-corrects the next time
the reader looks. This is the derived-value law in its cheapest, most
profitable application: the recomputation is a one-comparison query, so
store the anchor and run the query.

Anchor mechanics inherit the cursor rules: the tuple, not a bare timestamp
(two occurrences in one tick straddle a bare-timestamp anchor ambiguously),
and not an id alone (an id is not ordered; the anchor must be seekable in
the feed's order). It is the same composite the keyset cursor uses, doing
resumption for the reader instead of the query.

## When does "seen" happen

Three defensible definitions, in increasing strictness:

1. **Surface-opened** — opening the feed marks everything current as seen.
   Cheapest, honest for glanceable feeds, but it claims the reader saw rows
   they never scrolled to.
2. **Scrolled-past** — an occurrence is seen when its row has actually been
   within the viewport (with a dwell threshold so flinging past does not
   count). The anchor advances to the newest row that has met the test.
   Strictest honest default for feeds people catch up on.
3. **Explicitly acknowledged** — seen only on interaction (expand, click,
   mark-read). This is queue semantics leaking in; if most rows need it,
   the surface is a triage queue, not a feed.

Pick one per feed, deliberately, and hold it — the reader calibrates trust
in the badge against observed behavior within a session or two, and a
definition that shifts between releases burns that calibration. Whichever
definition holds, **advancing the anchor is the reader's fact, not the
renderer's**: rendering rows into the buffered, out-of-view region (see
[live-prepend](live-prepend.md)) must never count as seen.

**Mark-all-read** is anchor-set-to-head — one write, idempotent, safe to
offer prominently. Its inverse ("keep unread") is anchor-hold, which is why
the anchor model gives both for free where counter models grow ad-hoc
correction paths.

One sequencing subtlety that separates working implementations from
self-erasing ones: **read the anchor once at entry and freeze that value
for the session's delta.** The surface that shows "since you were away"
typically also *advances* the stored anchor while open (on a heartbeat, on
hide/close, so a crash does not replay a week). If the delta is computed
against the live stored value instead of the frozen entry-time snapshot,
the surface's own heartbeat erases the delta it is about to display — the
badge flashes and zeroes, and the race is invisible in testing because it
needs the heartbeat to fire first. Two values, two jobs: the frozen
snapshot renders the delta; the advancing store is only ever written.

## The badge

The unseen count travels — to a tab, a sidebar item, a dock badge, an
outbound notification — and every hop strains its honesty:

- **The count carries its predicate.** A badge over the *whole* stream
  rendered on a surface whose list is *filtered* answers a different
  question than the list does. Either scope the badge to the same predicate
  or label the difference; never let one number sit ambiguously over two
  scopes.
- **Cap displayed magnitude, not the underlying truth.** "99+" is honest
  compression; a count frozen at some internal fetch limit while presenting
  as exact is not. If the derivation is bounded (count up to N), the
  display must show the bound ("N+"), which is the count-honesty rule from
  the shared pagination discipline applied to a badge.
- **Zero is a claim.** Badge-zero asserts "you have seen everything", which
  is only true if the anchor derivation includes late arrivals — an
  occurrence inserted *below* the head but *above* the anchor (see
  [reverse-chronology-semantics](reverse-chronology-semantics.md)) is
  unseen by any honest reading, and a naive newer-than-head-at-last-visit
  scheme misses it. Deriving from the anchor comparison, not from a
  remembered head snapshot, gets this right automatically.
- **The badge and the jump affordance agree.** "12 new" on the tab and
  "8 new" on the in-feed pill is two predicates leaking; if they genuinely
  differ (total unseen vs held-buffer arrivals this session), the surface
  is showing two numbers it understands — make sure it does.
- **A jump affordance without a count is half an affordance.** "Jump to
  latest" tells the reader there is *something*; "3 new" tells them whether
  it is worth interrupting what they are reading for. The count is cheap —
  it is the held buffer's size — and its absence is the most common form of
  this technique being half-adopted: the scroll contract implemented, the
  reader's decision left uninformed.

## Durability and multiplicity

- **The anchor persists across restart** — with the reader's profile, not
  the device session, if the product has identity that roams. Losing the
  anchor resets the feed to all-seen or all-unseen, both wrong; treat it as
  small, hot, durable state.
- **One anchor per (reader, feed).** Filters do not get their own anchors —
  a filtered view is a lens on the same feed, and per-filter anchors
  multiply into contradictory "caught up" claims. The badge under a filter
  is the same anchor with a narrower predicate.
- **Multiple devices converge by max.** Anchors from two devices merge to
  the newest tuple — seen anywhere is seen everywhere. This merge is
  trivially correct for anchors (take the max) and famously wrong for
  counters (sum? min? last-write?) — one more reason the anchor is the
  stored form.
