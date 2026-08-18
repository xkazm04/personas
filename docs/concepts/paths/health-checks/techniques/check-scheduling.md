---
layer: technique
subject: health-checks
technique: check-scheduling
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Check scheduling

When a check runs determines what the system actually knows, what the
checking costs, and whom it interrupts. Left undesigned, scheduling defaults
to the worst policy available: **probe on render** — checks run when a
screen opens, so the watched dependency is hammered by curiosity while the
unwatched one, serving tonight's unattended work, is never checked at all.
That inversion — attention flowing to what is looked at instead of what is
depended on — is the failure this technique exists to prevent.

## Three legitimate triggers

- **On demand.** A human asks — a refresh affordance, a pre-flight gate, a
  setup step. On-demand probes may bypass the cache (that is what "demand"
  means when the stakes are stated), and they are the recomputation path
  that cached results are obligated to expose (see
  [probe-caching](probe-caching.md)).
- **On watch.** A dependency someone *declared* they care about gets probed
  on cadence whether or not anyone is looking. Watching is an explicit,
  per-target subscription — opt-in, visible, revocable — not an ambient
  behavior of having once opened a screen. The watch list is the system's
  honest statement of what it monitors; a dependency not on it is not
  monitored, and the surface says so rather than implying coverage.
- **On event.** Moments that falsify the current verdict trigger an
  immediate re-check: an install finished, a configuration saved, a fix
  applied, resume from sleep, network transition. Event-driven probes are
  the cheapest of the three per unit of information — they run exactly when
  the answer is most likely to have changed.

Render is not on the list. Opening a screen may *read the cache* and may
*prefetch* (below); it does not launch probes.

## Cadence, and the digest that protects attention

Watched checks run on a cadence sized like a TTL — to the fact's rate of
change and the cost of probing, per target, not one global tick. But cadence
creates a second problem: a watcher that *notifies* on every state change
turns a flapping dependency into a notification storm, and storms teach
muting, and muting ends monitoring. So watching separates **observation
rhythm** from **reporting rhythm**:

- state changes are recorded as they are observed;
- the human is told on a **digest cadence** — a bounded summary ("since
  yesterday: 2 went red, 1 recovered") at a chosen rhythm — plus immediate
  interruption reserved for the small set of members explicitly marked
  interrupt-worthy;
- recovery is always part of the story: a digest that reports reds but not
  the returns to green manufactures permanent background dread.

## Backoff on repeated failure

A check that has failed N times in a row is telling you something is *down*,
not asking to be re-confirmed at full frequency. Repeated identical outcomes
earn a stretched interval — the standard backoff shapes apply (the
retry-backoff subject owns the mathematics) — with two health-specific
clauses: backoff never rounds to *stopping* (the check that stopped running
renders as unverifiable-going-stale, not as its last verdict frozen), and
any falsifying event — above all a fix being applied — resets the schedule
to immediate. The same discipline applies to the unverifiable state: probe
obstacles get retried on *their* events (network back, tool installed)
eagerly, on timers with backoff otherwise (see
[three-state-outcomes](three-state-outcomes.md)).

## Cadence bookkeeping fails too — stamp before you run

A cadence is enforced through a stored "last ran at" stamp, and that stamp's
failure modes are scheduling bugs of their own. Two hard-won rules:

- **Record the attempt before the run, not after.** Stamp-after-success
  means a sweep that crashes mid-run never records anything — so the next
  tick is immediately "due", crashes again, and the cadence collapses into
  a hot retry storm against whatever is making the sweep crash. Stamping
  first inverts the failure: a crashed run costs one skipped cycle instead
  of a stampede. That trade — delayed retry over hot retry — is the right
  default for background health work, and it is a *decision*, made visibly,
  not an accident of statement order. (If even the stamp write fails, skip
  the run: a scheduler that cannot record attempts must not attempt.)
- **A corrupted stamp means "due once, then heal".** An unparseable or
  missing timestamp is treated as due, and the fresh write repairs it. The
  opposite bug — comparison logic where a corrupt stamp is never due, or
  always due — turns one bad write into a permanently silent (or
  permanently storming) scheduler, and nothing renders the difference.

The same discipline applies at smaller scale: a per-session digest latches
"attempted this session" even on failure, retrying on the next natural
boundary rather than on every re-render of whatever hosts it.

## Prefetch: warmth without load

The legitimate remnant of probe-on-render is **prefetch on intent**: when
signals say a health surface is about to be viewed (navigation toward it,
hover on its entry point), warming the cache makes the surface paint with
answers instead of question marks. Prefetch differs from probe-on-render in
every way that matters: it respects the TTL (a warm cache prefetches
nothing), it is bounded (one warming pass, not a subscription), and it is a
courtesy, not a contract — dropping it changes latency, never correctness.

## Schedulers are created things

A watch loop, a digest timer, a per-target backoff clock — each is created
infrastructure and names its reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)): the watch
subscription that outlives the surface (or the process) that created it is
a background prober nobody remembers, spending quota to compute verdicts
nobody reads. Watches are owned — by a surface's lifecycle, a user's
declared subscription, or an explicit system service — and the owner's
teardown tears them down. An orphaned scheduler is the load-shaped version
of the leak, and it is invisible until the day the probed dependency asks
why it is being polled every thirty seconds by a machine whose user left
the team.
