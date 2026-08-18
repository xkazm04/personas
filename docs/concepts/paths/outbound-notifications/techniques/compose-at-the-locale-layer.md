---
layer: technique
subject: outbound-notifications
technique: compose-at-the-locale-layer
status: forged
laws: [gate-sees-target, one-validation-door]
shared_with: []
---

# Compose at the locale layer

A rendered UI string is provisional: wrong today, re-rendered right
tomorrow. An outbound message is **immutable after send** — it sits in a
chat room, an inbox, an OS notification center, under the sender's name,
forever. That asymmetry decides where message text may be composed: **at
the layer that knows the user's language, timezone, and formatting
conventions**, and nowhere else. Every architecture in this subject
eventually violates the rule the same way, so the technique is mostly
about making the violation structurally hard.

## The measured failure shape

One real system: shipped in 14 languages, translation completeness
enforced at commit time — zero missing keys, a pre-commit gate, the whole
apparatus. Measured at the outbound layer: **52 of 57 delivery sites
composed hardcoded English**, spread across **five parallel delivery
doors**, and 31 of those sites lived on the far side of a process
boundary that had no locale to consult at all — string literals and
English-skeleton format templates in a layer that had never heard of the
user's language, feeding an OS surface nothing can re-render.

The mechanism generalizes and is worth internalizing as a law instance,
not an anecdote: the translation gate watched the UI string catalog — the
place strings were *supposed* to live — while composition happened at the
send sites the gate never read
([gate-sees-target](../../_laws.md#gate-sees-target)). A gate on the
catalog enforces nothing about strings that never enter the catalog. And
five doors is not five times one door: each door added past the first is
a composition site the gate cannot see *by construction*, because nobody
routes a new door through a gate they would have to build the routing
for.

## The placement rule

Compose the human-readable title and body **at the moment of delivery
decision, at the layer holding the live locale** — resolving from the
active translation catalog, never from a startup-time snapshot (the user
changes language mid-session; a module-scope English capture is a bug
with a delay fuse). Numbers, dates, and relative times are locale work
too, not just words.

When the *event originates* on a locale-less side — a backend engine, a
scheduled job, a daemon — the discipline is a split, not an exception:
the originating side emits the **fact** (event type, source coordinates,
structured payload, severity), and the locale layer composes the
**message**. The fact crosses the boundary as data; prose never crosses
the boundary outbound. Where a backend genuinely must deliver without
any locale-bearing layer running (the app is closed; the daemon notifies
the OS directly), that is the one honest case for locale data crossing
*down*: persist the user's locale choice where the backend can read it,
and treat backend-composed text as a product surface with its own
translation obligation — small, enumerated, gated. What is never honest
is the default that systems drift into: English literals at every
backend send site, invisible to every gate, "temporarily".

## One door is the enforcement mechanism

The placement rule is unenforceable as a convention — it survives only as
a chokepoint: **one delivery door per tier** (one function outbound
messages pass through; one for OS-tier escalation; one for chat-channel
dispatch), so that "text must arrive already composed, with its locale
obligations met" is checkable at a single seam
([one-validation-door](../../_laws.md#one-validation-door) — this is the
same law wearing content clothes: the door validates composition, and
the writers are enumerable). The door is also where the other
send-time obligations concentrate — the durable in-app record written
*unconditionally, outside* the fallible OS/external attempt, so a failed
or denied delivery still leaves a findable trace; the dedup posture; the
sender prefix.

The counterfeit version is a helper that exists but does not own the
door: the measured system's best door — lazy permission handling,
correct record-outside-the-try, translation-keyed labels — had **one**
caller, while five siblings bypassed it. A door with optional attendance
is a lobby. Make the raw sends unreachable (lint wall, module privacy,
review rule with teeth) or accept that every future site will choose the
door that requires the least reading.

## Fixed-language spaces are a subscription property, not an excuse

A team channel may legitimately run in one language regardless of any
individual's locale — a shared operations room, a public status channel.
That is still composition at the locale layer: the *subscription* carries
the target-language decision as data, and the composer honors it. The
distinction that matters is *someone decided* versus *the implementation
language leaked*. The first is a product choice, recorded and visible;
the second is the 52-of-57 shape.

## Retrofit order

Brownfield reality: dozens of literal send sites, no locale on the far
side. The order that works — first collapse doors (pure plumbing, no
translation yet: route every send through the chokepoint while the text
is still wrong); only then translate, once, at the chokepoint. Translating
first hardcodes the catalog into N doors and must be redone after the
collapse anyway. Door count is the leading metric; string count is the
lagging one.
