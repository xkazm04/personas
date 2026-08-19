---
layer: technique
subject: guided-tours
technique: narration-and-pacing
status: forged
laws: []
shared_with: []
---

# Narration and pacing

Narration — spoken audio, animated typing, choreographed motion — can lift a
tour from a stack of labels into something closer to a colleague walking you
through the product. It also imports a new failure class: everything about
sound and motion is slower, flakier, and more environment-dependent than the
text and geometry it decorates. This technique's whole posture is one rule
applied relentlessly: **narration is an accessory to an accessory, and it may
never block the thing it decorates.**

The machinery of speech itself — synthesis engines, caching, playback
plumbing — belongs to the voice subject
([voice-ux-integration](../../voice-io/techniques/voice-ux-integration.md),
under [voice-io](../../voice-io/voice-io.md)); this technique owns only the
coupling between that machinery and the tour's step engine.

## Never blocking, in every direction

The coupling is one-way: the tour drives, narration follows, and no signal
travels backward as a requirement.

- **Steps render complete without audio.** Every step's full content exists
  as text; narration re-performs it. A step that is unintelligible without
  its soundtrack has moved substance into the least reliable channel.
- **Step activation never waits for audio readiness.** Synthesis may be slow,
  the engine may be absent, the user may be muted or in an open office. The
  spotlight, text, and controls appear on the tour's schedule; sound joins
  when it arrives, or never.
- **Audio failure is invisible to the tour.** A synthesis error degrades to
  a silent step — not an error surface, not a stalled step, not a retry
  spinner. The user who never enabled sound must be unable to tell that
  anything failed.
- **Advancement interrupts playback, not the reverse.** When the user
  advances, skips, or exits mid-sentence, the sentence dies immediately.
  Holding a step open to let the narrator finish is the soundtrack pacing
  the reader — the exact inversion this technique exists to forbid.
- **Playback resources are released on every exit path** — advance, skip,
  exit, pause-for-modal, degradation. A narrator that keeps talking over the
  step after it, or over the product after the tour, is the accessory
  outliving its host.

## Pacing belongs to the reader

The tour's rhythm is set by the person reading it, never by the content's
performance duration:

- **No step auto-advances because its narration ended.** Narration-end is a
  performance event, not a comprehension event; the reader may need thirty
  more seconds with the screen the narrator described in eight.
- **No step auto-advances because a reveal animation completed.** Motion is
  presentation; the advancement technique owns what completes a step, and
  "the theater finished" is never on that list.
- **One thought per step.** Pacing starts at authoring: a step that needs a
  paragraph of narration is two or three steps wearing one spotlight, and no
  delivery mechanics rescue overloaded content.
- **Reduced-motion and sound-off are first-class renderings**, not degraded
  ones. The tour's information survives with motion settled instantly and
  sound absent, because the text-and-geometry layer was the complete medium
  all along.

## Skippability of sound and motion

The subject's skippability rule extends inside the step: the user can silence
narration as a persistent preference (not per-step whack-a-mole), skip the
current utterance without skipping the step, and exit the tour mid-utterance
with the same single gesture as always — teardown includes the audio
channel unconditionally.

## What this technique refuses

- A step whose meaning lives only in audio or motion.
- Activation, advancement, or teardown gated on any audio event.
- Auto-advance on narration-end or animation-end.
- Audio errors surfaced as tour errors.
- A narrator not silenced by every exit path the step and tour possess.
