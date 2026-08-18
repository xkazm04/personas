---
layer: technique
subject: scheduling
technique: trigger-matching
status: forged
laws:
  - one-authority-per-vocabulary
  - failure-not-empty-success
shared_with: []
---

# Trigger matching

An event is published; the system must determine which subscribers react. Matching is
the routing layer between "something happened" and "work fires" — and it fails in two
opposite directions with very different visibility. Over-matching produces noisy
duplicate work that someone notices. **Under-matching produces silence**, and silence is
indistinguishable from "nothing happened" unless the matcher is built to testify (law:
failure-not-empty-success).

## Procedure

1. **Give events a closed, versioned vocabulary.** Event kinds are an enumerable
   registry — one authoritative list of kind identifiers, each with a declared payload
   shape — not ad-hoc strings minted at publish sites (law:
   one-authority-per-vocabulary). Every under-matching incident in a stringly-typed
   event system is a typo or a rename that only one side received. The registry is
   what makes "list all possible events" and "this subscription references a kind that
   no longer exists" answerable at all.
2. **Make subscriptions data.** A subscription row: subscriber identity, event kind
   (or explicit pattern), optional payload filter, enabled flag, and creation
   provenance. Matching by scanning code for handlers cannot be audited, toggled, or
   listed for an operator.
3. **Match in one door.** A single dispatch function receives every published event and
   evaluates it against the subscription set. Publish sites that hand-deliver to known
   subscribers bypass filtering, logging, and fan-out limits — they are the routing
   equivalent of validation sprinkled across call sites.
4. **Filters evaluate on declared payload fields, fail closed, and report.** A filter
   referencing a field the payload lacks is a *broken filter event*, not a silent
   non-match — the subscription's author meant something, and the mismatch is a schema
   drift signal. Decide and document: does a filter error suppress the fire (safe for
   side-effectful work) or force it (safe for alerting)? Either way it is recorded.
5. **Record the match decision at the moment of dispatch**: event id → the set of
   subscriptions evaluated, matched, suppressed (disabled / filtered / rate-limited).
   This is the raw material for "why didn't my trigger fire" (see
   schedule-observability) and it can only be captured here — reconstructing it later
   re-runs the matcher against state that has since changed.

## Fan-out discipline

One event may match many subscribers; each match becomes an independent unit of work
with its own run identity, failure handling, and overlap policy. Three rules keep
fan-out from amplifying into a storm:

- **Isolation**: one subscriber's failure or slowness never blocks the others — matched
  work is enqueued per subscriber, not executed inline in the publish path.
- **Bounds**: a per-event match count above a sane ceiling is suspicious by default
  (a wildcard subscription meeting a high-frequency event); log it loudly, and prefer
  a cap with an explicit override to an unbounded default.
- **Cycle awareness**: if subscribers can themselves publish, a depth or budget
  attached to the causal chain (event carries its ancestry) is the difference between
  a feature and a feedback loop. Fires triggered by fires must decrement a budget.

## Ordering and delivery honesty

State the delivery contract explicitly, because subscribers will otherwise assume the
strongest one: at-least-once with per-subscriber ordering unguaranteed is the honest
default for anything that survives a restart via a queue. Subscribers that need
exactly-once must deduplicate on event id — which they can only do because identity was
minted at publish time and carried through (identity is the event's, not the
delivery's).

## Decision rules

- New event kind → registry first, publish site second. A publish site that mints its
  own kind string is the drift seed.
- An event that matched zero subscribers terminates as *skipped: no subscriber* —
  never as "delivered". Counting a consumerless event as a successful delivery is
  success theater: it inflates the delivery stat and makes a dead or misrouted trigger
  look handled, which is precisely the state the reason ledger exists to expose.
- If two subscribers need the same reaction, that is two subscriptions, not one
  subscription with two side effects — per-subscriber isolation depends on it.
- When matching volume grows, index subscriptions by event kind before optimizing
  anything else; linear scans of all subscriptions per event are the first wall.
- Audit question to keep runnable at all times: "list every subscription that could
  never fire" (disabled, referencing retired kinds, or filtering on retired fields).
  Dead subscriptions are silent under-matching that already happened.
