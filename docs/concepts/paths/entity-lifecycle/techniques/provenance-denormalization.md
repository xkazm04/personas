---
layer: technique
subject: entity-lifecycle
technique: provenance-denormalization
status: forged
laws: [identity-survives-reuse, failure-not-empty-success]
shared_with: []
---

# Provenance denormalization

Historical records — runs, events, results, transitions — describe what
happened, and what happened does not change when its cause is deleted.
Yet the natural way to record "this run came from that template" is a
live reference to the template's row, and a live reference gives history
exactly three fates when the template dies: block the delete (history
holds the present hostage), die with it (deletion rewrites the past), or
dangle (history becomes unreadable). All three are wrong. The technique
is the fourth option: **copy the provenance onto the historical record
at write time**, so the record carries what it needs to stay legible
with the source gone, and let the live pointer degrade honestly.

## Copy at write time — read time is too late

At the moment the historical record is created, the facts are all
present and cheap: the source's durable identifier, its contemporaneous
display name, the version or shape it had right then. Copy them into
the record as first-class fields. This is deliberate denormalization
and it is *correct* denormalization, because these fields are not a
cache of current state — they are **facts about the past**: "the name
the source had when this happened" is not supposed to track renames.
That is why the usual denormalization objection (drift against the
source of truth) does not apply: for provenance, the copy *is* the
truth, and the live row is merely the current state of a different
thing ([identity-survives-reuse](../../_laws.md#identity-survives-reuse):
the identifier is the durable fact; names are captions, and captions
are copied because they don't survive).

Backfill cannot rescue a record that skipped this: once the source is
deleted or renamed, the information no longer exists anywhere to copy.
Write-time capture is the only time the window is open.

## The pointer and the copy, together

The complete pattern keeps both fields, with different jobs:

- **The live reference** supports the present: joins to the current
  source, "navigate to it," "show me all history for this entity." It
  is declared to detach on delete — degrade to an absence — never to
  cascade (which would erase history) or block (which would let history
  veto the present).
- **The denormalized copy** supports the past: rendering, filtering, and
  attribution that keep working when the reference is gone. The
  historical record displays from its own fields, joining to the live
  row only for "is it still alive?" affordances.

A record with only the pointer loses its past when the source dies; a
record with only the copy loses its present (no navigation, no
aggregation by live entity). The pair costs a few columns and buys an
honest answer at every point in the source's lifecycle.

## The honest absence, never a fabricated sentinel

Sometimes the fact is unknowable: the record predates capture, the
source was already gone, the action genuinely had no source. The honest
value is **the absent one**. The tempting alternatives — a placeholder
identifier, a synthetic "unknown" entity, an empty-string name, a
zero-value id — are each a forged document: every future query, count,
and join treats the sentinel as a real value, and the fabrication
compounds silently (the "unknown" entity accumulates history, appears
in aggregations, and one day someone builds a feature on top of it).
An absent value, by contrast, is a queryable, countable truth
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)
in data form: *unknowable* must be spelled differently from *known*,
because a reader who cannot distinguish them holds a sample of unknown
bias). Three states, three spellings: a live value (source known and
present), a copy with a dead pointer (source known, since deleted),
and an absence (source unknowable). Collapsing any two is a lie about
history.

## What this buys the lifecycle

Deletion becomes safe for history by construction: the delete's cascade
design can declare history a survivor because the survivors are
self-sufficient. The blast-radius preview can truthfully promise "your
records remain" — and the promise is checkable, because a reader can
open any historical record after the delete and find it fully legible:
who, what, from where, under what name. Deleting the source removed an
entity; it did not rewrite what happened.
