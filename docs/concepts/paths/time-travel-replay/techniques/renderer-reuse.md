---
layer: technique
subject: time-travel-replay
technique: renderer-reuse
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Renderer reuse

The credibility of a replay is exactly the fidelity of its rendering to the
live surface — and the only rendering guaranteed to match the live surface is
the live surface itself. So the technique's whole content is one structural
rule and the seams that make it possible: **replay feeds the live renderers
from the log; it never builds parallel renderers.**

## The divergence theorem

Suppose replay gets its own renderer — "just a simplified version" is how it
always starts. The two renderers are now two hand-maintained presentations of
one event vocabulary, and they drift the way all duplicated vocabularies do
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
the next event kind is added to the live path and falls through silently in
replay; a restyle lands on one and not the other; a truncation notice is
reworded live and replay keeps quoting the old one. None of these is caught
by any gate, because each renderer is individually correct against its own
expectations. The failure is only visible as a *comparison* nobody is
running: "replay looks wrong" becomes a standing bug class with no single
defect behind it. Reuse does not reduce this risk — it deletes the category.

## The seam: a feed, not a fork

Reuse requires that the rendering layer consume a **feed** — a typed sequence
of presentation events — rather than the transport it happens to arrive on.
Then there are exactly two feed implementations:

- the **live feed**, adapting the wire (the streaming pipeline's parsed
  events) into the feed shape;
- the **replay feed**, adapting the persisted record into *the same shape*,
  released according to the replay clock.

Everything downstream of the seam is shared and cannot disagree. The test for
whether the seam is in the right place: a frame of replay at position *t* and
a screenshot of the live surface as it looked at the same moment should be
indistinguishable except for the transport bar. When they differ, the
difference is a bug in a feed adapter — a small, local thing — never a
divergence between two rendering trees.

The feed shape belongs to the live pipeline, not to replay: replay adapts
*to* the live vocabulary, because the live surface is the authority being
imitated. A replay-first event shape that the live path must then adapt to
inverts the imitation and puts the authority in the copy.

## What must be injected for the components to be reusable

Live components acquire habits that break under a synthetic clock. Each must
be turned from an ambient assumption into an injected dependency:

- **Time.** Any component that reads the wall clock — relative timestamps
  ("3s ago"), elapsed-time tickers, staleness fades — must take "now" from
  the feed's clock, not the environment. Under replay, *now* is replay time;
  a component that consults the real clock renders every replayed moment as
  months old.
- **Arrival-triggered motion.** Entrance animations keyed to "this element
  just mounted" replay correctly for forward playback but fire absurdly on
  seek (a jump to *t* mounts hundreds of elements "arriving" at once).
  Motion must key off feed semantics — *this event is at the playhead* —
  with bulk materialization on seek explicitly non-animating.
- **Autoscroll and focus.** The live surface's follow-the-tail behavior is a
  live affordance; under scrubbing it must yield to the transport's
  positioning, or the two fight for the viewport.

## Side effects are gated, affordances are flagged

The live surface does more than render: it may emit notifications, play
sounds, log telemetry, update unread badges. Replaying a failed run must not
page anyone. The rule: **effects belong to the feed, not the components** —
the live feed carries effect authority; the replay feed runs the same
components with effects inert. If an effect lives inside a shared component,
it will fire under replay eventually; hoist it.

Interactive affordances — cancel, retry, approve — are real controls live and
nonsense against history. They are **capability-flagged through the feed**
(the replay feed grants no mutation capabilities), not forked out of the
component tree. Hiding-by-fork recreates the second renderer this technique
exists to prevent; flagging keeps one tree whose affordances degrade
honestly. A control that *must* remain visible in replay (for layout
fidelity) renders disabled with its reason, never live-but-ignored.

## The reuse boundary

Reuse covers the **presentation of the run** — the transcript, phase
indicators, progress surfaces, accrual counters. It does not cover the
transport chrome (scrubber, speed control, gap markers), which has no live
counterpart and is owned outright by the replay surface. Keeping the boundary
sharp matters in both directions: transport chrome leaking into the live
surface implies a scrubbable live run (a lie — the future does not exist
yet), and live chrome leaking into the transport (a "cancel" button next to
the scrubber) implies replay can affect the run (a worse lie).
