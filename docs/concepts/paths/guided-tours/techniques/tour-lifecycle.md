---
layer: technique
subject: guided-tours
technique: tour-lifecycle
status: forged
laws: [identity-survives-reuse, creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Tour lifecycle

A tour outlives the session that starts it, the release that ships it, and
often the interface it narrates. Treating it as a fire-once script produces
the familiar decay: tours that restart from step one after every interruption,
finished tours that replay on every profile wipe of a cache, and — worst —
tours still confidently narrating a screen that was redesigned two quarters
ago. This technique treats every tour as a **versioned content entity** with
identity, persistent state, and a declared end of life.

## Identity that survives editing

Progress, completion, and telemetry all key on tour and step identity, so
identity must survive the operations tour content actually undergoes:
reordering steps, inserting one in the middle, rewording titles, splitting
one tour into two. Per the identity law, that rules out the tempting keys —
step index (breaks on insert and reorder), title text (breaks on rewording),
position in a registry (breaks on everything). Tours and steps carry **minted,
stable identifiers**, assigned at authoring and never recycled; a retired
tour's identifier is not reissued to its successor, because the completion
ledger would silently conflate two different pieces of content.

Content changes big enough to invalidate old progress are a *version* event:
the tour's identity persists, its version increments, and the resume policy
below decides what stored progress against the old version is worth.

## Progress persists; resume is the default

An interrupted tour — closed app, crashed session, user who clicked away —
resumes where it stopped, not at step one and not into oblivion:

- **Progress is written as it happens**, step by step, to storage that
  survives restart. Progress held only in session memory is a tour that
  punishes interruption, and interruption is the normal case during
  onboarding, when users are context-switching constantly.
- **The active tour is part of the record.** Persisting a per-tour progress
  map without persisting *which tour was running* is the subtle half-measure:
  every checkmark survives the restart, and the user is still returned to
  the default tour at step one, their real position intact on disk and
  unreachable. Resume state is a pair — which tour, and where in it — and
  losing either half loses the user.
- **Resume re-validates before it restores.** The stored step may reference
  a screen that needs navigating back to, an anchor that needs re-resolving,
  or a version of the tour that no longer exists. Resume replays the
  *activation* path — navigation choreography, anchor resolution, bounded
  patience — never just re-paints the saved rectangle.
- **Stored progress against a stale version degrades honestly**: offer a
  restart of the updated tour rather than resuming into step identifiers the
  new version no longer contains.
- **Declined is a recorded outcome.** A user who exits at step two is not
  re-prompted on every launch; the decline persists with the same weight as
  completion. Nagging is the fastest way to teach users that all coaching
  is noise.

## Completion is an honest ledger

Per-user, per-tour outcome tracking is the subject's product feedback loop,
and it is only as good as its honesty:

- Outcomes are at least: **completed, exited-early (at which step),
  declined, expired-by-retirement** — and completion accounting carries the
  degradation record (a run that skipped half its steps is a different fact
  from a clean run; the degradation technique explains why).
- Completion gates *re-offering*, never access: finishing a tour must not
  unlock product capability, or the tour has become a wizard with worse
  guarantees.
- **A tour whose definition cannot be found is a failure, never a
  completion.** Completion checks phrased as "every step is done" are
  vacuously true over an empty step list, so a tour whose content failed to
  load — a registry that did not survive restart, a version that was retired
  — quantifies over nothing and marks itself finished. Per the law that
  failure is spelled differently from empty success: zero steps found is a
  distinct outcome with its own handling, not a perfect score.
- The ledger reads as a funnel — where users abandon is the single best
  editorial signal the content will ever get.

## Retirement: every tour names its reaper

The law that everything created names its reaper applies with unusual force
here, because an unreaped tour is not inert clutter — it is **active
misinformation** pointed at real users. The discipline:

- **The registry of tours is a coverage surface read in both directions**:
  which surfaces have coaching, and which tours narrate surfaces that have
  changed. A redesign that moves or removes anchored controls updates or
  retires the affected tours *in the same change* — the anchor-contract gate
  makes vanished anchors loud at build time, which turns "we forgot the
  tour" into a failing check instead of a production embarrassment.
- **Retirement is explicit state, not deletion.** A retired tour stops being
  offered, stops resuming, and its ledger history remains legible. Deleting
  the content while completions still reference it orphans the ledger.
- **Fresh-profile testing is the lifecycle's verification gate.** The entire
  first-run experience — eligibility, auto-offer, step one — is gated on
  state that no developer's daily profile has had for months. A tour is
  verified by running it from a genuinely clean profile, on every change to
  the tour or the surfaces it crosses; anything else tests resume paths
  while believing it tested onboarding.

## What this technique refuses

- Index-, title-, or position-based step identity.
- Progress that lives only in session memory.
- Resume that re-paints saved geometry instead of replaying activation.
- Re-offering a declined tour as if the decline were a crash.
- A tour with no retirement owner — content nobody is responsible for
  withdrawing when its subject changes.
- Verifying tours only on developer profiles that completed them long ago.
