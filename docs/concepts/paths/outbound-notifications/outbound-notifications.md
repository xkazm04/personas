---
layer: golden-path
subject: outbound-notifications
status: forged
techniques:
  - channel-adapter-traits
  - per-channel-templating
  - subscription-patterns
  - channel-health-tracking
  - compose-at-the-locale-layer
  - inbound-counterparts
  - outbound-fan-out@realtime-events
evidence:
  - src-tauri/src/engine/webhook_notifier.rs              # the channel layer end to end: EventProcessor trait, provider body shapes, placeholder templating, pattern matching, per-sink breaker, watermark dispatch
  - src-tauri/db/src/repos/resources/notification_subscriptions.rs   # subscriptions as user data: one validation door (label, provider vocabulary, endpoint-or-credential, ≥1 pattern), last-delivery ledger, watermark store
  - src-tauri/src/notifications.rs                        # the second outbound stack: per-persona channel specs fanned to five channel classes + test-delivery ritual with rate limit
  - src-tauri/src/engine/slack_bridge.rs                  # bidirectional binding parsed once for both lanes; is_echo — the single named loop-prevention invariant
  - src-tauri/src/engine/slack_poller.rs                  # inbound counterpart: per-channel cursor, bounded fetch + bounded drain, reply correlation, bridge fork on a discriminator
  - src-tauri/src/engine/discord_poller.rs                # the sibling poller: same shape, per-route rate budget sized in the constants' comments
  - src-tauri/src/engine/team_slack_relay.rs              # outbound half of the bridge: mirrors team-channel rows out under per-bridge flags
  - src/lib/notifications/notifyProcessComplete.ts        # the compose-at-the-locale-layer exemplar: text resolved from the live catalog at send time, durable record written outside the try
counter_evidence:
  - src-tauri/src/notifications.rs                        # ALSO the key counter-example: 31 backend send sites compose English literals on the side of the boundary that has never heard of the user's locale (52/57 across five doors, measured 2026-08)
deviations:
  - w12-outbound-notifications   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-realtime-events        # shared watermark, in-memory-only breaker strikes, no dead-letter — the fan-out-side gaps this subject inherits
  - w3-toasts-notifications   # five delivery doors / 52-of-57 hardcoded-English measurement on the OS-escalation door
---

# Outbound notification channels

Long-running systems do their most important work while nobody is watching.
A job finishes at 02:40; a pipeline fails on the third retry; an approval
blocks a teammate in another timezone. The in-app tiers — toasts, the
notification center, the OS banner — reach a user who is *at* the
application or at least at the machine. This subject is the layer beyond
that: **pushing internal events out to channels the user already inhabits**
— a team-chat room, a generic JSON endpoint, an inbox, a mobile push relay —
under subscriptions the user configured, in messages the receiving surface
can actually render.

The defining property of this layer is that **you own neither end of the
last hop**. The transport is someone else's API with its own rate limits,
markup dialect, size caps, and outage calendar; the destination is a social
space where your messages compete for attention you can spend exactly once.
Everything in this subject follows from taking both facts seriously: the
delivery machinery must assume failure is normal, and the message content
must assume the reader is human, situated, and easily lost.

## Where this subject ends

The boundaries are load-bearing, because this layer sits at the junction of
four others and rots fastest when it absorbs their jobs:

- **The dispatch loop is not this subject.** Durable watermarks, forward-only
  seeding, per-tick caps, at-least-once semantics, and the
  advance-after-settlement rule are the
  [outbound fan-out](../realtime-events/techniques/outbound-fan-out.md)
  technique, owned by [realtime-events](../realtime-events/realtime-events.md).
  This subject *consumes* that machine and owns what the machine calls per
  delivery: which channel, what payload, rendered how, and what happens to
  the channel's standing when the attempt returns.
- **In-app delivery is not this subject.** Toasts, the durable ledger, and
  the escalation to OS banners belong to
  [toasts-notifications](../toasts-notifications/toasts-notifications.md);
  the decision grammar for when a message deserves the loud tier is its
  [os-escalation](../toasts-notifications/techniques/os-escalation.md)
  technique. The two subjects meet at one doctrine — compose the text where
  the locale lives — and this subject owns that technique because outbound
  is where the composition mistake is irreversible.
- **Attention policy is not this subject.** Whether the user should be
  interrupted at all — budgets, quiet windows, dedup of repeated nudges —
  is [proactive-nudges](../proactive-nudges/proactive-nudges.md). An
  outbound channel is a *delivery instrument* for decisions made there; a
  channel layer that starts making attention decisions inline grows a
  second, unaccountable policy engine.
- **Retry ladders and breaker theory are not this subject.**
  [retry-backoff](../retry-backoff/retry-backoff.md) owns backoff design and
  [circuit breakers](../retry-backoff/techniques/circuit-breakers.md) in
  general; this subject owns their *per-sink application* — the health
  standing of each configured channel and its visibility to the channel's
  owner.
- **Inbound HTTP ingestion is not this subject** — events arriving *from*
  external systems through a receiving endpoint belong to
  [webhook-ingestion](../webhook-ingestion/webhook-ingestion.md). But
  channels that carry *replies to messages this layer sent* are this
  subject's mirror lane; the [inbound-counterparts](techniques/inbound-counterparts.md)
  technique owns that distinction precisely.

## Channels are adapters behind one seam

A grown system will deliver to four or five channel *classes* — team chat
with one markup dialect, team chat with another, a card-based enterprise
messenger, raw JSON to an arbitrary endpoint, an inbox. The delivery
pipeline must be written exactly once, and each class must be a **pluggable
implementation behind one extension trait**: given a subscription, an event,
and a rendered payload, attempt delivery and report a structured outcome.
Adding a channel class implements the trait and registers it at one seam;
it never touches the dispatcher, the matcher, or any other adapter. The
moment a second copy of the pipeline appears — a parallel switch statement
over channel kinds in another module — every future channel must be added
twice, and one of the copies will be forgotten. The
[channel-adapter-traits](techniques/channel-adapter-traits.md) technique
owns the seam, the closed channel vocabulary behind it, and the
forward-compatibility posture for channel kinds the running binary has
never heard of.

## One event, N honest renderings

The internal event is a fact with a name and a structured payload. What each
channel receives is a *rendering* of that fact — and the renderings differ
legitimately: one target wants a single text line, another wants a content
field with its own length cap, a card-based target wants a typed envelope, a
generic endpoint wants the raw structure alongside the summary. The rule is
**templates are owned per channel class, escaping is owed to each target's
markup, and the user may override the template as data** — with the system
guaranteeing that a bad template degrades the message, never the delivery.
A templating engine that can *fail* at dispatch time converts a user's typo
into an outage of the channel. The
[per-channel-templating](techniques/per-channel-templating.md) technique
owns the placeholder grammar, the totality guarantee, and the default
rendering every subscription gets before anyone writes a template.

## Subscriptions are user data

Which events reach which channel is not configuration shipped with the
application — it is **user data with a lifecycle**: created through one
validation door, matched by pattern, disabled without deletion, deleted with
its bookkeeping reaped. Three disciplines carry the weight:

- **Matching is exact plus bounded families.** A subscription names exact
  event types and may name a family by prefix — anchored at a declared
  segment boundary, never a raw string prefix, so a family pattern cannot
  bleed into a sibling family that happens to share spelling.
- **Enablement is forward-only.** Turning a subscription on means "tell me
  what happens next", never "replay what I missed" — an enable that
  replays history into an external room is a spam incident and, for a
  newly authorized receiver, a disclosure incident.
- **A subscription that matches nothing must be loud about why.** Corrupt
  pattern data that silently degrades to match-nothing produces the most
  expensive support case in this layer: a channel that "just went quiet"
  with every indicator green.

The [subscription-patterns](techniques/subscription-patterns.md) technique
owns the pattern grammar, the validation door, and the forward-only rule;
the watermark mechanics that *implement* forward-only live with the shared
[fan-out](../realtime-events/techniques/outbound-fan-out.md) technique.

## A channel is a thing that breaks

Every configured sink will eventually be a dead sink: the endpoint deleted,
the credential revoked, the room archived. The channel layer owes two
responses, and they are different in kind. **Mechanically**, failures are
counted per channel and a channel that fails repeatedly is taken out of the
hot path — skipped except for periodic recovery probes — so one dead sink
cannot tax every tick or, worse, pin shared dispatch state and punish its
healthy neighbors. **Socially**, a broken channel is surfaced *to its
owner*: last attempt, last outcome, last error, in the same surface where
the subscription is managed. A breaker that only exists in memory protects
the pipeline but tells no one; the user discovers the dead channel weeks
later by the silence — indistinguishable, from their side, from "nothing
happened". The [channel-health-tracking](techniques/channel-health-tracking.md)
technique owns the ledger, the breaker's per-sink application, the recovery
probe cadence, and the test-delivery ritual that lets an owner prove a
channel end to end on demand.

## Compose where the locale lives

An outbound message is **immutable after send**. A mistranslated label in
the UI is fixed by the next render; a wrong string in a chat room or an OS
notification center is wrong forever, under the sender's name. So the text
must be composed at the one layer that knows the user's language, timezone,
and formatting conventions — and delivery must flow through **one door** so
that the composition rule is enforceable rather than aspirational. The
cautionary measurement: a system shipping in 14 languages, with translation
completeness enforced at commit time, was measured composing **52 of 57
outbound delivery sites as hardcoded English across five parallel delivery
doors** — 31 of them on the side of a process boundary that had no locale
to consult, unfixable in place. Every door added past the first is a door
the locale gate cannot see. The
[compose-at-the-locale-layer](techniques/compose-at-the-locale-layer.md)
technique owns the placement rule, the one-door consolidation, and the
downgrade path when composition must happen on a locale-less side.

## The mirror lane: channels that talk back

Some channels are conversations, not billboards. A chat room the system
posts into is a room where humans reply — and a channel layer that sends
without a plan for replies has built half a product. The mirror lane runs
on **pollers or receivers with their own identity discipline**: a durable
per-channel cursor, bounded fetches with bounded burst drains, correlation
between the inbound message and the work it triggered so the answer lands
as a threaded reply — and above all the **echo guard**: anything that
arrived from the channel is marked with its origin and is never mirrored
back out, whatever the outbound flags say, because a send↔receive pair
without that single invariant is an unbounded loop between two systems that
both believe they are relaying faithfully. The
[inbound-counterparts](techniques/inbound-counterparts.md) technique owns
the poller shape, the echo discipline, and the bridge pattern where one
binding declares both directions.

## What the surface owes the operator

- **Per-channel standing, on demand**: last delivery time, last outcome,
  last error, current breaker state — answerable from the management
  surface, not from log spelunking.
- **The quiet-channel question answered from records alone**: did this
  subscription deliver nothing because nothing matched, or because every
  attempt failed? The two must be distinguishable without a debugger.
- **A test ritual**: any channel can be exercised end to end with a
  synthetic event, rate-limited so the test button is not itself a spam
  cannon.
- **An honest duplicate posture**: the fan-out machine is at-least-once;
  the payload carries a stable event identity so receivers that care can
  deduplicate, and the documentation says "duplicates possible after a
  crash" rather than implying exactly-once.

## The techniques

- [channel-adapter-traits](techniques/channel-adapter-traits.md) — one
  extension trait per delivery, closed channel vocabulary,
  forward-compatible parsing, one transport door.
- [per-channel-templating](techniques/per-channel-templating.md) — owned
  templates per channel class, total rendering, escaping per target,
  user overrides as data.
- [subscription-patterns](techniques/subscription-patterns.md) — exact +
  bounded prefix families, one validation door, forward-only enablement.
- [channel-health-tracking](techniques/channel-health-tracking.md) —
  per-sink failure accounting, breaker application, owner-visible standing,
  test deliveries.
- [compose-at-the-locale-layer](techniques/compose-at-the-locale-layer.md)
  — immutable messages composed where the locale lives, one delivery door.
- [inbound-counterparts](techniques/inbound-counterparts.md) — pollers,
  cursors, reply correlation, the echo guard.
- [outbound-fan-out](../realtime-events/techniques/outbound-fan-out.md)
  *(shared, owned by realtime-events)* — the watermark dispatch loop this
  whole subject rides on.
