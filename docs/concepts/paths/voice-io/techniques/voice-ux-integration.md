---
layer: technique
subject: voice-io
technique: voice-ux-integration
status: forged
laws: [failure-not-empty-success, creation-names-reaper]
shared_with: []
---

# Voice UX integration

The pipelines make voice *possible*; this technique makes it *placeable* —
how speaking and listening attach to a visual product without distorting it.
The governing principle: **voice is an overlay channel.** It annotates,
narrates, and accepts input alongside a surface that remains complete
without it. Every rule here is a consequence: narration never blocks what it
narrates, affordances degrade to honest absence, one arbiter decides who may
speak, and consent is a designed surface rather than a settings checkbox.

## Read-aloud affordances attach to content, not to the pipeline

The atomic voice-output affordance is *read this aloud* — attached to a unit
of content: a message, a paragraph, a step. Its contract:

- it is a **toggle with visible state**: idle → speaking (with a live
  indication on the affordance itself) → back to idle on completion or
  interruption. The control that started the speech is the control that
  stops it, in the same place, unmoved — a user who must hunt for the stop
  is a user who mutes the whole machine;
- pressing a second unit's affordance while the first speaks follows the
  queue policy of the [tts-pipeline](tts-pipeline.md) — for read-aloud the
  correct default is **replace**: the user's newest request expresses their
  current interest, and stacking minutes of backlogged reading behind it
  serves nobody;
- the affordance renders only when it can work *or* when it can explain
  itself. An affordance for an unconfigured voice feature either offers the
  one-line path to configuring it or is absent — a button that appears
  functional and does nothing when pressed is the cheapest possible way to
  teach a user that the whole voice system is fake.

## Narration never blocks the surface it narrates

Wherever voice narrates a flow the user is *doing* — a guided tour, a
walkthrough, a status sequence — the flow's progression logic and the
narration are **two processes with one-way coupling**: the flow advances by
its own rules (user action, its own timing), narration *follows* the flow,
and nothing in the flow ever waits on the voice. Concretely:

- advancing the flow interrupts the previous step's narration (replace
  policy — the narration chases the flow, never the reverse);
- synthesis failure, absent engine, or muted output produce a flow that is
  simply silent, with every visual element intact. A tour that cannot start
  because narration cannot start has inverted the dependency — the failure
  of an *enhancement* has been promoted into the failure of the *feature*;
- narration state (speaking, muted, unavailable) is visible on the flow's
  chrome, so silence is legible as either choice or degradation
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success) in
  its UX form: designed silence and broken audio must not look identical —
  a muted icon and an unavailable icon are different glyphs).

The same inversion rule covers *input*: a surface that accepts spoken
commands keeps every command reachable by pointer and keyboard. Voice
control is an accelerator on the interaction, never the interaction.

## One arbiter: at most one voice, and someone owns the decision

A product with several narration sources — read-aloud, tour narration,
status announcements, an assistant's replies — will eventually have two of
them fire together, and overlapping synthetic speech is unintelligible
noise. The fix is structural: **all speech is requested through one
arbiter**, which enforces at-most-one-audible and resolves contention by
declared priority (direct user requests outrank ambient announcements;
whatever the user just explicitly asked to hear outranks everything). The
arbiter is also where the global mute lives, which is what makes the mute
trustworthy: a mute enforced at N call sites is a mute minus the call site
added next quarter.

Speech requested by a surface is a resource the surface owns
([creation-names-reaper](../../_laws.md#creation-names-reaper)): when the
surface unmounts or the context that requested speech ends, its pending and
playing utterances are cancelled by that surface's teardown. Orphaned
narration — a voice describing a screen the user already left — is this
technique's signature leak, and it is worse than a memory leak because the
user *hears* it.

## Mute and consent are architecture

- **Global voice mute**: one control, discoverable from anywhere audio can
  start, persistent across sessions, and absolute — it outranks every local
  toggle and every priority in the arbiter. Local per-feature toggles
  compose *under* it (mute the tour but keep read-aloud), never over it.
- **Playback consent**: audio starts from a user gesture or a standing
  preference the user explicitly set. Platforms refuse un-gestured audio as
  policy; a refused start surfaces as a visible play affordance —
  "narration is ready" — never as silent success, which the user reads as
  broken and the logs read as fine.
- **Capture consent** is stricter and owned by the
  [stt-pipeline](stt-pipeline.md) (gesture-initiated, continuously
  indicated); this technique's obligation is *placement*: the capture
  indicator lives where the user is looking, not in a distant corner, and
  the single action that ends capture is adjacent to it.
- **First-run posture**: voice features ship discoverable but quiet. A
  product that speaks uninvited on first launch has spent its one chance at
  voice-feature trust before earning it.

## Degraded affordances tell one honest sentence

The golden path's degradation ladder lands here as copy and rendering rules.
An affordance whose pipeline is unavailable shows *which* rung failed in one
sentence — "no voice configured", "voice model still downloading",
"microphone permission needed" — with the single next action when one
exists. Three anti-patterns, all observed wherever voice features age:

- the **vanishing affordance** — the button disappears when unavailable, so
  users who saw it yesterday conclude the product is unstable;
- the **lying affordance** — enabled-looking, does nothing on press;
- the **eternal spinner** — an affordance stuck in a working state because
  a probe failure was swallowed; unavailability is a settled, displayable
  fact, not a pending one.
