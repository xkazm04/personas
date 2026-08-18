---
layer: technique
subject: toasts-notifications
technique: announcement-accessibility
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Announcement accessibility

A toast is positioned *away* from the user's locus of work by definition —
that is what out-of-band means. For a sighted user, peripheral vision
carries it; for a screen-reader user, nothing does unless the message is
**announced**. An unannounced toast simply does not exist for them: the
operation failed, the system "told the user", and one class of users was
told nothing. This technique is the announcement layer that makes the
transient tier real for assistive technology.

## Live regions: mounted early, written into

Assistive technologies announce content that *changes inside* a live
announcement region they already know about. The two rules that follow
from how that detection works:

- **The region exists before the news.** A persistent, visually-hidden
  announcement region mounts with the application shell and lives for the
  session. Mounting a new region with its text already inside is the
  classic silent failure — many assistive technologies only voice
  *mutations within* an observed region, so text that arrives with the
  region announces nowhere, reliably enough to bet against.
- **One writer.** Announcements funnel through a single service that owns
  the region(s); components request an announcement, they do not scatter
  their own live regions through the tree. Multiple ad-hoc regions race,
  duplicate, and — worse — mask each other: assistive technology
  generally voices the latest change, so two regions updated in the same
  breath lose one message silently. One door, enumerable writers.

## Politeness maps from severity

Live announcement channels come in two grades: **polite** (queued after
the current utterance finishes) and **assertive** (interrupts speech in
progress). The mapping from message to grade is not a per-call-site
choice — it derives from the same severity vocabulary that drives every
other presentation channel
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):

- info, success, warning → **polite**. The user's current utterance is
  their current task; routine news waits its turn, exactly as the visual
  toast waits at the screen edge rather than covering the cursor.
- error → polite by default; **assertive only when it blocks what the
  user is doing right now** (their submission failed, their session
  ended).
- critical → **assertive**.

Assertive interrupts mid-word. Overusing it is the audio equivalent of a
modal that steals focus — and like severity inflation generally, it is
self-defeating: a stream of interruptions teaches the user to lower
speech rate attention, not to raise urgency response.

## Burst draining

Announcement is a serial channel — one voice — while toasts arrive in
bursts. Writing three messages into a region in one frame voices one of
them (the last mutation wins); the other two vanish without trace. So the
announcement layer keeps its **own queue**, independent of the visual one:

- Messages drain **serially**, with enough spacing for the previous
  utterance to land; each drain is one region mutation.
- The drain **coalesces** on the same semantic keys as the visual queue
  ("three jobs failed" as one utterance, not three) — the visual layer's
  dedup discipline applies verbatim, because a repeated announcement is
  more expensive than a repeated pixel.
- Assertive messages may jump the drain queue; they do not erase it —
  polite messages resume after.
- The queue is bounded and sheds oldest awareness-class messages first
  under storm conditions, mirroring the visual overflow policy: assistive
  users get the same triage, not a backlog replay.

## Focus is never stolen

- **Arrival never moves focus.** A toast appearing while the user types
  must not relocate the caret or the reading position — announcement is
  the notification mechanism; focus theft is an attack on the user's
  train of thought, and doubly so for a screen-reader user whose focus
  *is* their place in the world.
- **Reachable on demand.** While a toast lives, it is reachable by
  keyboard — a documented shortcut or landmark navigation to the toast
  area — with its action operable and dismissal available. Attention
  (focus within the toast) pauses dwell exactly as hover does, per
  [queue-discipline](queue-discipline.md); anything else gives keyboard
  users a strictly shorter action window than mouse users.
- **Dismissal returns focus** to where the user was, not to the toast
  container, not to the top of the page.
- Action-required messages are where these rules earn their keep: an
  obligation announced politely but unreachable by keyboard is an
  obligation delivered to some users and not others. The ledger backstop
  applies here too — the notification center, itself fully operable,
  holds everything a user could not catch in flight.

## Announce transitions, not renders

The announcement fires **once per event**, on the transition (message
created, count incremented, message resolved) — never on re-render or
re-mount of the visual layer, which repaint freely for layout reasons the
user should not hear about. A coalesced repeat announces the *update*
("still failing, 14 occurrences"), not the original text again. Visual
re-animation and auditory re-announcement have different costs; the
announcement layer keys strictly off event identity, so display churn is
inaudible.

## Motion and its absence

The visual layer honors reduced-motion preferences by settling instantly
instead of sliding; the announcement layer is unaffected — it was never
motion. What *is* affected by the pairing: dwell computed from animation
timelines breaks when animation is disabled, so dwell is a property of the
message (severity, reading length), never derived from the entrance
animation's duration.
