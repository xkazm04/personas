---
layer: technique
subject: client-fetch-cache
technique: prefetch-and-defer
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Prefetch and defer

A fetch has a natural time — when the surface that needs the data mounts —
and two engineered alternatives: earlier, because intent predicted the
need; or later, because the first paint did not include it. Both moves
trade against the same budget (network, server load, client work), and
both are priority statements: prefetch says "this will matter in a
moment," deferral says "this does not matter yet." A fetch layer that
makes neither move does everything at mount time, which is precisely when
the user is watching.

## Prefetch on intent

Intent signals arrive before commitment: a pointer settling on a
navigation target, focus reaching an option, a menu opening toward a
choice, the first keystrokes of a route change. The gap between signal and
commit is typically hundreds of milliseconds — enough to land a small
fetch, so the commit paints from a warm cache instead of a cold start.

Prefetch discipline, in order of importance:

- **A prefetch is a plain read through the normal path** — same key
  builder, same cache, same dedup registry. It is *only* an early caller.
  If the user commits while the prefetch is in flight, the real read joins
  it ([in-flight-dedup](in-flight-dedup.md)); if the prefetch landed, the
  read hits fresh cache ([swr-design](swr-design.md)). A bespoke prefetch
  side-channel that bypasses the cache warms nothing.
- **Never from a mutation, never with side effects.** Prefetch fires on
  gestures the user has not committed to; anything observable — writes,
  counters that mean "viewed," consumption of one-shot tokens — turns a
  hover into an action the user did not take. Read-only is a hard
  property of the prefetch path, not an intention.
- **Explicit calls, never side effects of reading.** The inverse hazard:
  making loads fire *implicitly* whenever something reads a not-yet-loaded
  value looks like free prefetching and is a feedback loop — a render that
  touches N cold values fans out N loads, whose arrival triggers
  re-renders, which touch more values. Warming is initiated at named
  sites (the intent handler, the mount effect); the read path stays pure.
- **Speculative means abandonable.** Some fraction of prefetches are
  wasted by design; the budget is the product of trigger frequency and
  request cost. Hover-triggered prefetch of a cheap summary is nearly
  free; hover-triggered prefetch of an expensive aggregation on a dense
  list is a self-inflicted load test. Debounce the signal (a pointer
  crossing ten targets is not ten intents), dedupe per key, and skip
  entirely when the entry is already fresh.
- **Failures are silent but recorded.** The user never asked; show them
  nothing ­— surfacing a prefetch error is announcing a failure of a
  request they did not make. Silence toward the user is not silence
  toward the log: still count it, or a broken endpoint hides behind
  "the real fetch will retry anyway."

Intent prefetch composes with code and asset warming: the same hover that
should warm the data cache is the signal the shell uses to warm lazily
loaded sections, and a locale switcher warms translation chunks the same
way — those grounds belong to [app-shell](../../app-shell/app-shell.md)
(its lazy-section-loading technique) and [i18n](../../i18n/i18n.md)
respectively. The design point they share with data prefetch: one intent
signal, every cache that the predicted action will read.

## Defer below the fold

The mirror move: data not needed for the critical paint should not compete
with it. Secondary tabs, collapsed sections, below-fold panels, heavy
aggregations on a page whose primary content is a cheap list — mounting
all of it eagerly makes the primary content pay for the passengers.

- **Defer to idle, not to a timer.** The trigger is "the critical work
  finished" — an idle callback after mount — not a hard-coded delay that
  is too long on fast machines and too short on slow ones. Idle scheduling
  needs a timeout fallback (idle may never arrive on a busy machine) so
  deferral degrades to "shortly after mount," never to "never."
- **Deferred is not lazy-on-view.** Defer-to-idle still fetches proactively
  — it just yields priority; the data is warm before the user scrolls or
  switches tabs. Fetch-when-visible is the stronger demotion (pay only on
  actual view) and the right choice when the probability of viewing is
  low. Choose by likelihood: likely-viewed defers, rarely-viewed waits for
  visibility or intent.
- **Guard for once.** A deferred first load fires from a scheduling
  callback, and callbacks double under remount and replay. The guard is
  the fresh-window check the normal read path already performs — "is this
  loaded and fresh" — not a bespoke ageless boolean (the latch trap from
  [warm-remount-caches](warm-remount-caches.md)).
- **Cancel what the view no longer wants.** If the view unmounts before
  its deferred work fires, the scheduled callback must be cancelled — the
  schedule entry names its reaper at creation
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)).
  Otherwise deferred fetches from dead views fire into nothing, and under
  rapid navigation they pile up into exactly the load spike deferral was
  meant to prevent.

## The priority order

When the three time classes contend, the order is fixed:

1. **Blocking need** — a surface the user is looking at with nothing to
   show. Always first; nothing speculative runs ahead of it.
2. **Intent prefetch** — predicted next need. Runs when triggered but
   yields to (1); never queues ahead of a visible surface's fetch.
3. **Idle warm-up** — deferred first loads and background revalidations.
   Only in the gaps.

Most clients cannot literally preempt an in-flight request, so priority is
enforced at *launch* time — what gets issued when — plus concurrency
limits that keep speculative traffic from saturating the transport while a
blocking fetch waits. The test for the whole scheme is observational: the
data the user is looking at never waits behind data they might look at.

## Decision rules

- Prefetch through the normal read path — same keys, same cache, same
  dedup; a prefetch is just an early caller.
- Prefetch only reads with no observable side effects; debounce the intent
  signal and skip fresh entries.
- Prefetch failures: invisible to the user, visible to telemetry.
- Defer likely-but-not-critical data to idle with a timeout fallback;
  leave rarely-viewed data to visibility or intent.
- Guard deferred loads with the freshness check, not an ageless latch;
  cancel scheduled work when its view dies.
- Enforce priority at launch: blocking, then intent, then idle — and
  verify it by watching what the user's current surface waits on.
