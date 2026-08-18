---
layer: technique
subject: streaming-output
technique: render-throttling
status: forged
laws: []
shared_with: []
---

# Render throttling

Events arrive in bursts at machine cadence; the renderer runs at perceptual
cadence. The technique is the deliberate decoupling of the two clocks:
arrivals accumulate silently, and the renderer applies the accumulated
difference as **one mutation per flush**, on a schedule the renderer owns.
Rendering per event is the defect this technique exists to prevent — it
produces layout thrash, starved input handling, a vibrating scrollbar, and a
surface whose responsiveness degrades with the producer's enthusiasm, which
is backwards: the busier the run, the worse the experience.

## Coalescing: flush the difference, not the events

The unit of rendering is not "an event" but "everything that arrived since
the last flush", collapsed into the smallest mutation that represents it:
appended entries appended once, a phase that changed four times painted once
(final value), counters set to their current values. Coalescing is what makes
the cost of a flush proportional to *screen change*, not to *event volume* —
the property that keeps a hundred-events-per-second run rendering at the same
cost as a lazy one.

Two structural rules keep the flush cheap:

- **Append, don't rebuild.** The settled prefix of the transcript — output
  already rendered — is never re-derived or re-rendered by a flush. Only the
  live tail mutates. A flush whose cost grows with total transcript length is
  quadratic over the run's life; long runs discover it.
- **Read from the buffer, own no second copy.** The flush renders the live
  buffer's current state; it does not maintain a shadow accumulation whose
  divergence from the buffer becomes its own bug class.

## Cadence: a perceptual band, not a magic number

The flush interval lives in a band: fast enough that streaming feels live
(somewhere under ~150 milliseconds between flushes; beyond that, visible
stutter), slow enough that flushes stay off the hot path (per-frame flushing
buys nothing perceptually over ~30–60ms and pays layout cost every frame).
Within the band, pick by content type — prose reads fine at the slow end;
terminal-style line output tolerates the fast end — and then *leave it
alone*: an adaptive cadence that speeds up under load inverts the point.

The schedule itself should be **paced, not merely delayed**: a trailing-edge
schedule that flushes at most once per interval while arrivals continue. A
naive leading-edge-only debounce starves — continuous arrival keeps resetting
the timer and nothing paints until the stream pauses, which for a busy stream
is never.

## The trailing flush is guaranteed

The classic throttling bug: the terminal event arrives between flushes, the
run finalizes, the pending flush is cancelled as part of teardown — and the
last increment of output never paints. The final words of the run are exactly
the words most likely to sit in the unpainted gap, because termination
follows the last burst by definition.

The rule: **finalization forces a synchronous flush before it does anything
else.** Whatever teardown cancels the schedule, the accumulated difference is
applied first. The same guarantee applies to any transition that suspends the
schedule — visibility loss, unmount with state preservation: suspend means
"flush, then stop", never just "stop".

## Visibility-aware cadence

A surface the user cannot see earns no paint. When the surface is hidden —
background tab, collapsed panel, navigated-away view that stays mounted —
the schedule downgrades: slow cadence or full suspension, while the buffer
continues accumulating at wire speed (buffering is the cheap half; painting
is the expensive half). On re-show, **one catch-up flush** brings the surface
current immediately — not a replay of the missed interval at normal speed,
which turns a minute of background progress into a minute of theater.

## The scroll contract: pin-to-tail with user override

A streaming transcript grows downward while the user may be reading upward.
The contract that resolves the conflict:

- **Pinned by default**: while the user is at (or within a small threshold
  of) the tail, each flush keeps the tail in view.
- **User scroll disengages the pin.** Scrolling up is an explicit statement —
  "I am reading" — and the surface must not fight it. Flushes continue
  mutating content *below* the viewport without moving it. Yanking the
  viewport to the tail while the user reads is the single most hostile
  behavior a streaming surface can exhibit.
- **A visible way back**: while disengaged, an affordance ("jump to latest",
  ideally with a new-output count) re-pins on demand. Reaching the tail by
  scrolling re-pins implicitly.
- **Flushes preserve reading position** while disengaged — appends below the
  viewport must not shift what is on screen. If eviction removes content
  *above* the viewport, compensate so the visible text does not jump.

## What throttling must never do

- **Reorder.** Coalescing merges consecutive states; it never applies later
  output before earlier output.
- **Drop.** Throttling defers paint; it discards nothing. Data loss is the
  buffer's decision, made under its budgets with its accounting — never a
  side effect of a cancelled timer.
- **Gate the record.** Finalization and persistence consume the buffer, not
  the rendered surface; a slow or hidden renderer must have zero effect on
  what the settled record contains.
