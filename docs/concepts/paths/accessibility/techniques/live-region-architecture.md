---
layer: technique
subject: accessibility
technique: live-region-architecture
status: forged
laws: [one-validation-door, creation-names-reaper]
shared_with: []
---

# Live region architecture

A live region is the only channel through which a screen reader hears
about changes happening away from the user's focus. It is also one of
the most misunderstood platform mechanisms in the field, because its
failure mode is silence — the code runs, the text renders, nothing is
voiced, and no error appears anywhere. Architecture, not usage, is what
makes it reliable: the platform semantics are sharp enough that every
ad-hoc use rediscovers the same four silent failures.

## The platform semantics that drive the design

Everything below follows from how assistive technologies actually detect
announcements:

1. **Only mutations inside an already-observed region are voiced.** A
   region mounted with its text already present announces nothing on
   most platform/reader combinations. The region must exist *before*
   the news.
2. **Last write wins.** Multiple updates in one breath — to one region
   or across racing regions — voice the latest and drop the rest,
   without any signal that a message was lost.
3. **An unchanged string is not a mutation.** Writing the same text
   twice voices it once; the second event is silently deduplicated by
   the platform, even though it was a distinct occurrence the user
   needed to hear.
4. **Politeness is a property of the region, not the write.** Polite
   regions queue behind the current utterance; assertive regions
   interrupt it. Changing a region's politeness on the fly is
   unreliable; the two grades need two homes.

## One provider, mounted with the shell

The architecture that survives these semantics: a **single announcement
provider**, mounted once with the application shell and alive for the
session, owning exactly two visually-hidden regions — one polite, one
assertive — and exposing one imperative call ("announce this, at this
politeness") to the rest of the product.

This is [one-validation-door](../../_laws.md#one-validation-door) for
the auditory channel. Scattered per-feature regions fail structurally,
not stylistically: they mount at feature level (too late — semantics
#1), they race each other (semantics #2 across regions), and they make
the set of announcement writers unenumerable, so no one can answer "what
does this product ever say?" With one provider, that question has a
grep-shaped answer, the burst policy lives in one place, and every
consumer — toast layer, form errors, background completions, routing —
inherits correct behavior by calling instead of mounting.

Components request announcements; they never own regions. The one
exception worth naming: widgets whose ARIA pattern *includes* an
intrinsic live behavior (a status role inside a combobox's results
count) keep it — pattern-internal semantics are part of the widget
contract, not out-of-band announcements.

## The drain queue: bursts are serialized, not raced

Announcement is a serial channel — one synthetic voice — while events
arrive in bursts. Writing a burst straight into the region loses all but
the last message (semantics #2), so the provider owns a **queue that
drains serially**: one message per drain tick, spaced far enough apart
that the previous utterance registers, first-in-first-out within a
politeness grade.

Queue policy:

- **Assertive preempts but does not erase.** An assertive message jumps
  ahead of queued polite ones; the polite backlog resumes after. Only an
  assertive message may displace speech in progress.
- **Bounded, with deliberate shedding.** Under a storm, the queue drops
  or coalesces oldest awareness-grade messages rather than replaying a
  minutes-long backlog at a user who has moved on. Coalescing keys on
  the message's semantic identity ("three tasks finished" as one
  utterance), mirroring whatever triage the visual layer applied —
  the policy mapping from message class to politeness and triage is the
  consumer's contract, e.g.
  [announcement-accessibility](../../toasts-notifications/techniques/announcement-accessibility.md)
  for the notification tier.
- **Every scheduled drain names its cancellation**
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)). The
  provider outlives every screen, so timers pinned to it must be owned
  by it: cleared on teardown in tests, never orphaned to fire into a
  disposed environment.

## Deliberate re-announcement: the keyed remount

Semantics #3 — an unchanged string is not a mutation — collides with a
real product need: the same message text can be *news twice*. The user
retries a save; it fails with the same error; hearing nothing the second
time reads as success. The platform's deduplication must be defeated **on
purpose, per event**, and the provider owns the trick: force the write
to be a genuine mutation even when the text is identical — remount the
region's content node keyed by announcement instance, or clear-then-set
across separate frames. The mechanism matters less than its location:
call sites say "announce" and the provider guarantees "will be voiced",
including for repeats. A call site that must know about remount tricks
to be heard is an architecture leak.

The mirror-image discipline: **announce transitions, not renders.** The
provider is written into on *events* (something happened), never from
render paths (something painted). Visual layers re-render freely for
layout reasons; a provider fed from renders speaks noise. Event-sourced
announcements plus deliberate repeat mechanics give exactly one
utterance per occurrence — no more, no fewer.

## What gets a politeness grade, and who decides

The provider offers the two grades; it does not decide between them per
message. That mapping is **policy owned by the calling domain** — the
notification tier maps its severity vocabulary to politeness, forms
announce validation summaries politely and submission failures
assertively when they block the user's current act, background
completions are always polite. Centralizing the *mapping tables* in
their owning domains and the *mechanism* in the provider keeps both
honest: no call site picks assertive because it felt important that day,
and no provider grows a taxonomy of its consumers' business.

Default posture when in doubt: polite. Assertive is the auditory
equivalent of a focus-stealing dialog — justified by "the user's current
action is now impossible", not by enthusiasm.

## Testability

A provider with a queue is testable pure logic, and this is a large part
of why the architecture wins: the announcement sequence for any event
burst — order, coalescing, politeness, repeat handling — can be asserted
in unit tests without a screen reader, by driving the provider and
reading what it wrote and when. The silent-failure channel becomes the
best-instrumented one in the product. What unit tests cannot prove —
that a real reader voices the writes — remains the manual smoke pass in
[a11y-verification](a11y-verification.md).
