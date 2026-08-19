---
layer: technique
subject: background-jobs
technique: adaptive-cadence
status: forged
laws: []
shared_with: []
---

# Adaptive cadence

Cadence is the price the runtime pays for awareness. Tick too fast and the
system burns cycles, battery, and quota discovering that nothing changed;
tick too slow and it becomes the bottleneck between an event happening and
the system noticing. A fixed interval is a single answer to a question whose
correct answer changes minute to minute — which is why mature runtimes make
cadence a *function of state*, not a constant.

## The dual-rate pattern

The simplest adaptive form, and the workhorse: two intervals, **active** and
**idle**, switched by whether the loop's domain currently has anything alive
in it. Work in flight → tick fast (responsiveness while someone cares);
nothing in flight → tick slow (a heartbeat's worth of vigilance). The switch
condition should be cheap to evaluate — typically "did the last tick find
anything, or is anything known to be pending" — because it runs every tick.

Two rules keep dual-rate honest:

- **Transitions are edge-triggered by discovery, not by schedule.** When an
  idle loop's slow tick discovers new work, it drops to the active rate
  *immediately*, not after another idle interval. The worst-case latency of
  the system is the idle interval; do not accidentally double it.
- **The idle rate is not zero.** A loop that stops ticking entirely when idle
  has no way to notice work that arrives outside its own discoveries, and it
  disappears from the health surface's liveness math. Idle means slow, never
  off.

## The wake-on-signal hybrid

Dual-rate polling still discovers work by asking. Where the source of work
can *announce* it — an in-process event, a queue notification, a wake channel
— the superior form is the hybrid: **sleep until (interval elapsed OR signal
received), whichever is first.** The signal path gives near-zero latency when
the announcing path works; the interval is the safety net for every event the
announcement misses (a signal dropped during a race, a producer that forgot
to announce, work created by a writer that does not know about the channel).

The design error to avoid is trusting the signal completely and stretching
the fallback interval to infinity. The interval tick is what makes the loop
*eventually consistent with reality regardless of announcement discipline* —
it is the difference between "usually instant" and "usually instant, never
lost". Keep it at a rate you would accept as the loop's worst-case latency.

The inverse error also occurs: a signal that fires per-item under load turns
the loop into a per-item handler and defeats batching. Coalesce — a signal
received while a tick is running or pending sets a dirty flag (a stored
permit) and wakes the loop once, not N times. And because coalescing plus a
fallback interval means the tick *will* sometimes run with nothing to do or
twice for one announcement, the tick body must be safe under spurious wakes:
pair the wake with an atomic claim on the work itself, so however many paths
wake the loop, each unit of work is taken exactly once. The wake channel
carries urgency, never correctness.

## Jitter and alignment

Loops registered with round-number intervals synchronize: everything ticks on
the minute, producing periodic load spikes against shared resources (the
store, the network, the disk) and — across many installations — a thundering
herd against shared remote services. Two mitigations, both cheap:

- **Jitter each loop's phase** — offset the first firing by a random fraction
  of the interval, so equal intervals do not imply aligned firings.
- **Fixed-delay, not fixed-rate.** Schedule the next tick relative to the
  *end* of the previous one, not to an absolute grid. Fixed-rate scheduling
  plus a slow tick produces the catch-up burst (several firings in quick
  succession after a stall), which is almost never what background work
  wants. Fixed-delay drifts, and for background work drift is fine — the
  loops that genuinely need calendar alignment are scheduling's business, not
  cadence's.

Jitter has a legitimate opposite: **deliberate alignment under one
coordinator**. When many pollers live in one process and the dominant cost is
the *wakeup itself* (a display process on a battery, where each timer firing
wakes the runtime), registering them all on one shared heartbeat — every
similar-interval poller firing together, then the process sleeping — beats
spreading them out. Jitter optimizes for a shared *dependency* that suffers
under simultaneous load; alignment optimizes for a shared *host* that suffers
under frequent wakes. Both are decisions about who absorbs the burst; the
defect is the accidental version of either.

After a suspend/resume or clock jump, treat all timers as expired-at-most-once
rather than replaying the missed grid; the [startup sweep](startup-sweeps.md)
doctrine covers the longer gap.

## Visibility-aware cadence on client surfaces

Polling that drives a *display* has an extra input no server loop has:
whether anyone is looking. The standard contract for a client-side poller:

- **Pause when the surface is hidden** (background tab, minimized window,
  navigated-away view). Polling an invisible surface is pure waste and, on
  battery-powered devices, a real cost.
- **Refresh immediately on becoming visible**, then resume the interval. The
  user returning is the strongest possible signal that freshness matters
  *right now*; making them wait most of an interval for the first update
  reads as staleness.
- **Stop when the surface unmounts** — the poller names its reaper like any
  loop. Leaked client pollers are the ad-hoc timer swarm reborn in the
  presentation tier.

The same dual-rate logic applies on top: a client surface watching an active
operation polls fast; one watching settled data polls slowly or not at all
(relying on push, with a visibility-refresh as the safety net).

## Choosing the numbers

Intervals are design constants and deserve the same scrutiny as any budget:
the active rate is bounded below by the cost of an empty tick (measure it)
and above by the responsiveness the watching human or dependent system needs;
the idle rate is bounded above by the acceptable worst-case discovery latency.
Write both bounds down next to the constant. A cadence chosen by copying the
neighboring loop's number propagates a decision nobody remembers making.
