---
layer: golden-path
subject: retry-backoff
status: forged
techniques:
  - error-classification-for-retry
  - backoff-design
  - circuit-breakers
  - durable-retries
  - storm-control
  - retry-observability
evidence:
  - src-tauri/src/engine/failover.rs                          # per-provider + global breaker, documented precedence, persisted w/ 15-min TTL rehydration
  - src-tauri/db/src/repos/execution/scheduled_retries.rs     # durable retry-at schedule incl. provider-stated usage-limit reset windows
  - src-tauri/core/src/error_taxonomy.rs                      # single classification authority; Unknown lane counted, not misfiled
  - src-tauri/src/engine/polling.rs                           # per-key ladder in a TTL+LRU-bounded map with a stale-key sweep
counter_evidence:
  - src-tauri/src/engine/oauth_refresh.rs                     # the durable ladder with no attempt cap and no terminal state — durability without boundedness
deviations:
  - w2-retry-backoff   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Retry, backoff & circuit breaking

Every system that calls something it does not control — a remote service, a spawned
process, a database under contention, a device that sleeps — will watch those calls
fail. The subject of this path is **what happens after the failure**: whether the
system retries, when, how many times, and how it stops. Its sibling
[scheduling](../scheduling/scheduling.md) owns when work fires in the first place;
this path owns the failure lane, and the two meet exactly where a failed attempt
becomes a future scheduled one.

The stakes are asymmetric. A missing retry costs one operation. A wrong retry —
unclassified, unjittered, unbounded — recruits every caller into an attack on the
dependency at the precise moment it is least able to absorb one. **Resilience
machinery is the only part of a system whose failure mode is amplifying the outage
it exists to survive.** That asymmetry drives every stance below.

## The core stance: retry is a classified decision, not a reflex

The naive design wraps the call in a loop: catch, sleep, try again. It fails because
it treats all failures as the same failure. A rejected credential does not heal with
repetition; a rate limit heals only at the moment the limiter says it does; a network
blip heals almost immediately; a crashed dependency heals on no schedule the caller
can compute. Retrying all four the same way is wrong for all four.

> **Classify first. The failure's class — not the caller's impatience — decides
> whether to retry, when, and who gets to say so.**

The consequences of that stance form the spine of this subject:

1. **Classification happens once, at the boundary, against structure.** The layer
   that still holds the structured response — status codes, error kinds, protocol
   fields — assigns the class: *transient*, *permanent*, *rate-limited*, or
   *unknown*. Everything downstream consumes the class, never re-parses messages
   (see error-classification-for-retry). An error that reaches the retry loop as a
   bare string has already lost the information the decision needed.
2. **Delay is herd control, not politeness.** Exponential backoff exists to shed
   load from a struggling dependency; jitter exists because every caller computing
   the same deterministic ladder retries in synchronized waves. Backoff without
   jitter converts N independent failures into N-caller pulses (see backoff-design).
3. **A circuit breaker is an honesty device.** After enough consecutive evidence
   that a dependency is down, continuing to call it is a lie the system tells
   itself. The breaker converts that evidence into a stated position — *we believe
   this dependency is dead; we will probe deliberately, not pester continuously* —
   and makes the position visible and reversible (see circuit-breakers).
4. **Retry state has a durability class, chosen on purpose.** An in-memory ladder
   resets on restart, so every deploy silently forgets how bad things were and
   opens with a burst. Work that must survive the process persists its retry-at
   schedule and its attempt count; work that may die with the process keeps its
   state in memory and says so (see durable-retries).
5. **The whole layer carries a budget.** Retries multiply through layers: three
   attempts at each of three layers is up to twenty-seven calls for one user
   intent. Amplification is a property of the composition, not of any single loop,
   so the bound must be global — a retry budget — not per-site (see storm-control).

## The four classes and their contracts

| Class | Evidence | Contract |
|---|---|---|
| **Transient** | timeout, connection reset, overload signal, contended lock | retry with jittered exponential backoff, bounded attempts |
| **Permanent** | validation rejection, not-found, unauthorized after refresh, malformed request | never retry; surface immediately; retrying is pure amplification |
| **Rate-limited** | explicit limiter response, quota-exhausted signal | retry at the *stated* time if the response carries one, plus jitter; the dependency's own schedule outranks the local ladder |
| **Unknown** | anything unclassified | retry a small, separately-counted number of times with backoff — transient-with-suspicion — and treat recurring unknowns as a classification bug, not an operational fact |

Two rules cut across the table. First, **the unknown class is the design's honesty
about its own coverage**: a taxonomy with no unknown lane silently misfiles novel
failures into whichever class the default branch hits, and misfiling into
*permanent* drops recoverable work while misfiling into *transient* hammers a dead
endpoint. Second, **only failures that speak to dependency health feed the
breaker**: a permanent rejection of one malformed request says nothing about
whether the dependency is alive, and letting it trip the breaker punishes every
other caller for one bad payload.

## Stopping is a first-class outcome

Retry machinery is judged by how it stops. There are exactly four legitimate
terminal states, and each must be spelled differently (law:
failure-not-empty-success):

- **succeeded after N attempts** — recovery happened; the N still gets recorded,
  because a dependency that needs three attempts per call is degraded even when
  every call eventually lands;
- **exhausted** — the budget ran out; the work moves to whatever holds failed work
  (a dead-letter lane, an operator queue), never silently vanishing;
- **reclassified** — a retry attempt returned evidence of permanence; stop
  immediately, mid-ladder;
- **denied** — a breaker refused to even attempt; this is not a failure of the
  dependency but a policy decision, attributed to the breaker that made it.

An operator reading the record must be able to tell which of the four happened
without reading source. "It stopped" is not a state (see retry-observability).

## Where this path meets scheduling

A durable retry *is* a scheduled item — a persisted retry-at that some loop compares
against the clock — so the durable-retries technique deliberately rides the
scheduling subject's reconciliation-loop stance rather than inventing a second
timer discipline. The division of ownership: scheduling owns the loop, the tick,
and missed-run policy; this path owns **how the retry-at was computed** (ladder
position, stated reset windows, jitter) and **when the schedule ends** (budget,
reclassification, expiry). Likewise, suppression of repeated *alerts about*
failures belongs to scheduling's
[cooldown-and-debounce](../scheduling/techniques/cooldown-and-debounce.md);
suppression of repeated *attempts against* a failing dependency belongs here, to
the breaker. The shapes look similar — both are windows that quiet repetition —
but one governs what humans hear and the other governs what dependencies endure.

## What "done" looks like for this subject

A resilience layer meets the bar when: every failure entering it carries a class,
and the class — not call-site habit — selects the policy; delays are jittered and
capped, and ladders reset only after demonstrated stability, never on first
contact; each unhealthy dependency is eventually declared unhealthy by a breaker an
operator can see, and recovery is probed deliberately rather than discovered by
stampede; retry state that must survive restart does, and the restart itself does
not read as a recovery; total retry volume is bounded by budget so the layer cannot
amplify an outage more than a stated factor; and every stopped retry names which of
the four terminal states it reached.
