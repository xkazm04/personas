---
layer: technique
subject: outbound-notifications
technique: subscription-patterns
status: forged
laws: [one-validation-door, failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Subscription patterns

A subscription binds three user decisions together: *which events* (a
pattern list), *to where* (a channel + endpoint or credential), *rendered
how* (an optional template). It is user data with a lifecycle — created,
edited, disabled, re-enabled, deleted — and every discipline in this
technique exists because one of those transitions, done naively, produces
a spam incident, a disclosure, or a silently dead channel.

## The pattern grammar: exact, plus families with anchored edges

Users think in two granularities: "this exact event" and "everything in
this family". Give them exactly those two:

- **Exact match** on the full event type.
- **Family match** as a prefix pattern with an explicit family marker
  (`execution.*`), where the match is anchored at the vocabulary's segment
  separator: the pattern matches the bare family name and any type that
  continues *past a separator* — never a raw string prefix. `exec.*` must
  not match `execution.finished`; a family pattern written for one family
  must be structurally unable to bleed into a sibling that shares
  spelling. The event vocabulary's hierarchy is the authority on where
  segments break; the matcher just honors it.
- Optionally **match-all** — legitimate for firehose channels and audit
  sinks — as its own explicit spelling, so "everything" is a choice the
  reader of the subscription can see, not an accident of an empty filter
  meaning "no filter".

Resist regex. A pattern language users can get catastrophically wrong
turns the subscription editor into an injection surface and every match
into a performance question. Two constructs cover the real demand and can
be validated at the door.

## One validation door, strict on write

Every path that creates or edits a subscription passes one door
([one-validation-door](../../_laws.md#one-validation-door)), and the door
enforces the invariants that make the rest of the layer safe to build on:
a non-empty label (someone must be able to recognize this thing in a
list), a channel class from the closed vocabulary, **at least one
pattern**, and **a destination** — inline endpoint or credential
reference, at least one present. Partial updates need pinned merge
semantics for clearable fields (absent = keep, explicit-empty = clear),
and the door re-checks the invariants *after* the merge — the classic leak
is an update that clears the endpoint while leaving the credential absent,
passing a per-field check and violating the row-level one.

The door is strict so the read path can be lenient. Stored pattern lists
that fail to parse at dispatch time must degrade to *match nothing* — but
loudly, with a log naming the subscription, because a match-nothing
subscription is behaviorally identical to a healthy one whose events
simply haven't occurred
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Better still, treat parse-failure-at-read as a health event on the
subscription itself, visible to its owner, not just to whoever reads logs.

## Forward-only enablement

Enabling a subscription — first creation, or re-enable after a pause —
means **from now on**. The watermark mechanics that implement this live
with the shared [fan-out](../../realtime-events/techniques/outbound-fan-out.md)
technique; what this technique owns is the *product rule* and its edge:
the zero-subscription window. When the last subscription is deleted,
dispatch bookkeeping must keep advancing past new events anyway, so the
next subscription created — days later — starts at "now" rather than
inheriting the accumulated backlog of an unwatched gap. The failure is
vivid: a user creates their first subscription and their channel receives
the entire retained event history, two hundred messages at a time. For a
receiver whose authorization is minutes old, that is not just spam — it is
disclosure of history the subscription never covered.

Backfill is a legitimate want ("send me last week's failures") and gets
its own explicit, bounded request path with its own consent. It is never
the meaning of "on".

## Identity and the disable/delete distinction

A subscription's identity is minted at creation and survives edits
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)) —
health counters, delivery ledgers, and breaker state all key off it, and
an edit that re-mints identity silently amnesties a failing channel.
**Disable** preserves identity and standing: patterns, template, ledger
all wait intact, and re-enable is forward-only. **Delete** reaps — the
row, and everything keyed by the id: breaker entries, per-subscription
cursors if the fan-out machine keeps them, pending dead-letter records.
The deliberate wrinkle for in-memory standing: process restart may reset
failure counters by design (a restart re-probes every sink afresh), and
that is a *decision to write down*, not an accident to discover.

## Scope composition

Real systems grow a second filter axis: the subscription may be scoped to
a subset of sources (one project, one agent, one team) alongside its
event-type patterns. Compose the axes as an explicit AND with the same
anchored-match discipline per axis, and keep the axes visibly separate in
the data model. A single free-form filter string that mixes type patterns
with source patterns cannot be validated at the door, cannot be rendered
back to the user honestly, and cannot be reasoned about when the
quiet-channel question arrives — *why did nothing match?* must be
answerable per axis.
