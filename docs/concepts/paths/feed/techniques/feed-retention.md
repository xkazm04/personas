---
layer: technique
subject: feed
technique: feed-retention
status: forged
laws:
  - creation-names-reaper
  - failure-not-empty-success
  - derivation-names-recomputation
shared_with: []
---

# Feed retention

A feed accumulates by definition — every occurrence is an append, forever,
unless someone decides otherwise. "Someone decides otherwise" is this
technique. A feed created without a retention declaration has not avoided
the decision; it has made it by default in the worst form: unbounded growth,
discovered later as a slow query, a bloated store, or a migration that times
out, and then resolved in a panic by whoever hits it — which is how feeds
end up truncated by a hotfix with no design at all.

## Declare at creation

Retention is part of the feed's contract, stated when the feed is created,
in one of three shapes:

- **Age bound** — occurrences older than a horizon are reaped ("90 days").
  The natural fit for feeds whose value is recency; the horizon should be
  set from the reader's real catch-up window, not from storage anxiety.
- **Count bound** — the newest N are kept. Fits per-entity feeds (the last
  500 events of this job) where a busy entity should not hold years of
  history just because it is busy. Age and count compose; the tighter bound
  wins.
- **Windowed view over an archive** — the feed keeps a working window and
  explicitly names the durable record behind it (the audit store, the event
  log). This is the honest shape for systems that need both a readable
  digest and a complete record: the feed may forget because the archive
  does not, and the feed's retention statement *points at* the archive
  rather than gesturing at one.

Whichever shape: **the reaper is named.** What deletes, on what schedule,
invoked by what — a scheduled job, a rolling delete on insert, a vacuum
task. An unowned retention policy is a policy that stops running the first
time its accidental host is refactored away, and nobody notices until the
growth curve does. The well-formed reaper has three further properties,
each cheap at design time and expensive to retrofit:

- **Its parameters are settings, not constants** — the horizon and the
  floor are read from configuration the operator can see, with a stated
  default, so retention is a decision that can be revisited without a
  release.
- **It composes an age bound with a per-entity floor.** "Older than N days
  *and* beyond the newest K for this entity" — so a quiet entity keeps its
  last handful of history forever (a feed that reaps an agent's only run
  because it is 31 days old has deleted that agent's entire story), while
  a busy one is bounded. The floor's threshold must be a *total-order*
  cut: choosing the K-th newest row by timestamp alone, on a key that can
  tie, keeps K−1 or K+j rows at a tied boundary. Same tiebreaker rule as
  everywhere else in this subject; the reaper is one more consumer of the
  order.
- **It reaps only settled occurrences.** Rows still in flight — a running
  job, an open incident — are never eligible regardless of age; the
  predicate names the terminal states, and an occurrence that has not
  reached one is not history yet.

## The horizon is visible

Retention creates an edge, and the edge must render as an edge:

- **End-of-feed says why it ends.** Scrolling to the bottom of a retained
  feed reads "showing the last 90 days" (with the archive link, if one
  exists) — not a mute stop that is indistinguishable from "this is
  everything that ever happened". The distinction is exactly the
  failure-vs-empty-success law applied to history: *truncated* and
  *complete* must be spelled differently.
- **A cursor past the horizon resolves to a stated truncation.** History
  paging with a cursor older than the oldest retained row returns the
  oldest window plus the truncation marker — never an empty page, which
  the client would render as "no more history" with false confidence.
- **A read-position anchor past the horizon means unseen events were
  reaped.** The honest resolution: treat the reader as caught-up-by-
  forfeit at the horizon (anchor snaps forward) *and say so* ("events older
  than 90 days were removed") when the gap is material. Silently zeroing
  the badge converts "you missed things that are now gone" into "nothing
  happened" — the exact lie this subject exists to prevent.

## What reaping may not do

- **Reaping is retention, not moderation.** Deleting an embarrassing
  occurrence from the feed while it remains in the archive — or worse,
  nowhere — is not retention; it is editing the ledger. If the product
  needs redaction, that is a distinct, audited operation with its own
  trail, not a quiet reuse of the reaper.
- **Reaping does not create fake quiet.** A count-bounded feed on a busy
  entity can reap events younger than the reader's last visit. The unseen
  derivation and the horizon marker must account for it (previous point);
  the alternative — a feed that looks serenely caught-up because the
  backlog was deleted — is worse than a large honest number.
- **Derived summaries survive on their own terms.** If reaping is paired
  with rollups ("March: 4,120 events, 12 failures" persisting after
  March's rows are gone), the rollup is a derived value whose source is
  about to be deleted — it must be computed *before* the reap by a named
  process, and it must present as a summary, not impersonate the atomic
  rows. This is the storage-side cousin of clustering, and the view-not-
  storage invariant from [event-clustering](event-clustering.md) is
  precisely what it trades away: do it only at the retention boundary,
  where the atomic rows are leaving anyway.

## Sizing the horizon

The retention parameters are product decisions with engineering bounds, and
they are testable: the horizon should comfortably contain (a) the longest
realistic reader absence the product wants to absorb (vacation-length, for
team surfaces), and (b) the longest investigation lookback the feed itself
is expected to serve — anything past that belongs to the archive and its
tools. If incident review keeps needing feed history the reaper has eaten,
the fix is pointing reviewers at the archive, or lengthening the horizon
deliberately — not disabling the reaper in place, which is the unbounded
default sneaking back in wearing an exception.
