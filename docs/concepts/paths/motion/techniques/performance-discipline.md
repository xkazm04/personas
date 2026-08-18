---
layer: technique
subject: motion
technique: performance-discipline
status: forged
laws: []
shared_with: []
---

# Performance discipline

Motion is the only part of an interface with a hard real-time deadline:
a new frame every sixteen milliseconds or so, or the user sees the miss.
Discipline here is architectural — three structural choices that make
jank difficult to write, plus one audit that catches the leaks.

## Animate compositor-friendly properties

Rendering pipelines share a shape: layout (where everything is), paint
(what it looks like), composite (layers assembled, typically on a separate
thread). **Transform and opacity are composite-only** — animating them
moves and fades an already-painted layer without recomputing anyone's
geometry. Nearly everything else — sizes, spacing, offsets, borders —
re-runs layout for the element and potentially everything around it, per
frame, on the main thread.

So the discipline: **the vocabulary's presets are built from transform and
opacity, full stop.** A rise is a translation, an emphasis is a scale, a
draw-in is opacity plus transform — never an animated height or margin.
The place to enforce this is the preset library itself: when every shared
gesture is compositor-friendly by construction, per-surface authors never
face the choice. The genuinely hard cases — expanding panels, collapsing
rows, anything whose *size* truly changes — get the standard escape:
measure the end state, animate a transform between the states, swap the
real layout in at the end. More code, which is why it belongs in a shared
preset rather than reinvented per surface.

## Frames bypass reactive state

UI frameworks rebuild views when state changes. That machinery is priced
for user-scale events — a click, a keystroke — not for sixty writes a
second. An animated value routed through reactive state schedules a full
render pass per frame: diffing, reconciliation, effect scheduling, garbage
— to change one style property.

The discipline: **frame values are written directly to the element through
a mutable reference, outside the reactive graph.** The reactive layer hears
about an animation at human-scale moments — started, settled, canceled —
never per frame. A corollary for shared state: an animated value that other
components need to *observe* is published through a subscription that
notifies at most once per frame, not through the state system; letting a
scroll position or drag offset tick a global store is how one animation
re-renders forty bystanders.

## One shared frame engine

Scripted animation needs a clock tick. The undisciplined shape is each
animated component subscribing to the clock itself — N private loops,
N wake-ups per frame, N interleaved style writes (each one a chance to
force a mid-frame layout flush), and N places to forget a cancellation.

The discipline: **one engine owns the clock.** Components register
animations; the engine ticks once per frame, advances every live spring,
and applies all writes together. What this buys:

- **Batching.** Reads and writes are phase-separated engine-wide, killing
  the interleaved read-write-read pattern that forces synchronous layout.
- **One lifecycle.** The engine unsubscribes from the clock when its last
  animation settles — idle cost is structurally zero — and every animation
  registered names its cancellation, so a surface that unmounts mid-flight
  cannot leak its loop.
- **One throat to instrument.** Frame budget overruns, animation counts,
  and a global pause for debugging all live in one place. Fifty private
  loops offer no equivalent.
- **One place to clamp the timestep.** Physics-based animation integrates
  over elapsed time, and the clock lies after a suspension: a backgrounded
  view resumes with a delta of seconds, which a spring integrates as an
  explosion. The engine caps the per-tick delta once, centrally — a fix
  that N private loops would each need to rediscover, usually after the
  bug report.

## The layout-thrash audit

The leaks recur in the same handful of shapes, so the audit is a checklist:

1. **Any animated property outside transform/opacity** — the profiler shows
   it as layout or paint work per frame; the grep shows it in the preset or
   inline style being animated.
2. **Geometry reads inside the frame path.** Measuring an element between
   writes forces layout synchronously, per frame. Measure once at animation
   start; cache; re-measure only on actual invalidation (resize, content
   change) — never per tick.
3. **Per-frame state writes** — the framework's own devtools show render
   counts ticking with the animation. Anything re-rendering at frame rate
   is routed through the wrong layer.
4. **Orphan loops.** Clock subscriptions alive with nothing on screen —
   the cost of skipping the shared engine, visible as wake-ups in an idle
   profile.
5. **Unbounded concurrency.** A stagger across two hundred rows is two
   hundred simultaneous springs; cap the choreography (the budgets in
   [taste-budgets](taste-budgets.md) already require this) so the worst
   case is a screenful.

The audit's trigger condition is honest profiling under load — a long list,
a cold machine, a busy main thread — because motion is exactly the workload
that looks perfect on a fast developer machine and misses every deadline in
the field.
