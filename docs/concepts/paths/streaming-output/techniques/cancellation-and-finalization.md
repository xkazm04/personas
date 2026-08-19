---
layer: technique
subject: streaming-output
technique: cancellation-and-finalization
status: forged
laws: [failure-not-empty-success, creation-names-reaper]
shared_with: []
---

# Cancellation and finalization

Every run ends. The design question is whether it ends through one door or
through whichever exit happened to fire first. This technique is that one
door — **finalization**: the single idempotent path that converts live state
into the settled record, names how the run ended, and releases everything
the run held. Cancellation is the door's most demanding client: a user
right, exercised mid-flight, racing the producer's own ending.

## Cancellation is a first-class path

A stop control is live from the first pending moment to the last streaming
one — not a courtesy on the happy path, but the user's half of the streaming
contract: *you may watch it happen, and you may stop it.* Pressing it does
three things, in order:

1. **Signal the producer** — the interrupt, the termination request, the
   channel close. Best effort: the producer may comply promptly, slowly, or
   never.
2. **Stop applying** — the surface stops accepting the run's events
   immediately, without waiting for the producer to comply. The user asked
   for silence *now*; a producer that keeps emitting for another two seconds
   must not keep painting for another two seconds.
3. **Finalize with outcome *cancelled*** — through the same door as every
   other ending.

The acknowledgment is immediate and honest: the control flips to a
"stopping" affordance on press (disabled, not vanished), and the run settles
visibly. A stop button that appears to do nothing for the producer's
compliance latency teaches the user to press it five times.

**Cancellation preserves partial output.** What the user watched arrive is
kept in the settled record, marked as cancelled. Discarding it punishes the
stop — and teaches the user to let bad runs finish just to keep the partial,
which inverts the point of the control. The one exception is product-level:
output the user must not act on (a half-computed answer that is wrong until
complete) may be withheld, but that is the no-streaming rule from the parent
path applied late, not a cancellation default.

## The outcome taxonomy: four endings, spelled four ways

The settled record carries an outcome from a closed set, and the distinctions
are load-bearing
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):

| Outcome | The fact | The user's next action |
| --- | --- | --- |
| **completed** | the producer declared success | consume the result |
| **failed** | the producer declared failure, or emitted a fatal error | read the error; fix; retry |
| **cancelled** | the user stopped it | nothing owed; maybe rerun |
| **interrupted** | transport or process loss with no terminal event | retry or resume; distrust completeness |

The two collapses to refuse:

- **Interrupted is not completed.** A stream that merely stopped arriving
  did not finish. Promoting silence to success renders a half-answer as the
  answer — the most expensive lie this surface can tell, because nothing
  looks wrong.
- **Cancelled is not failed.** The user's deliberate stop rendered in error
  clothing tells them something broke when they are the thing that
  "broke". It poisons every failure metric it touches, and it makes the
  stop control feel dangerous.

A completed run with empty output is its own honest fact — "finished, and
said nothing" — distinct from all four collapses into it.

And the outcome is derived from **the field that actually discriminates**.
Producers often carry several ending-shaped fields — a subtype, a reason
string, an error flag — and some of them are constant across every run ever
observed while one actually varies. Verify against real traffic that the
chosen discriminator takes both values in the wild; an outcome derived from
a field that is always "success" is a display that says "completed" over
every failure, indefinitely, with green tests.

## Finalization is idempotent, and every exit converges on it

The endings race. A done event and a user cancel within the same tick; an
error event followed by the transport closing; teardown while the producer
is mid-burst. Every exit path — producer done, producer error, user cancel,
transport loss, consumer teardown — calls the same finalization, and the
finalization is **first-caller-wins**: it atomically checks-and-sets a
finalized flag; the winner's outcome stands; later callers return without
effect. The bugs this kills are the visible kind: a turn that appears twice
(two exits each wrote a record), an outcome that flickers from cancelled to
failed (the loser overwrote the winner), a run that never settles (each exit
assumed another would handle it).

Finalization's ordered duties:

1. **Force the trailing flush** — the render throttle's accumulated
   difference paints before anything is torn down.
2. **Write the settled record once**, from the authoritative accumulation
   (not scraped from the rendered surface), under the run's identity, with
   outcome, timing, truncation accounting, and the malformed-frame counters.
3. **Release everything the run created** — subscription, timers, live
   buffer, registry entry, process handle. Each of these named finalization
   as its reaper at creation
   ([creation-names-reaper](../../_laws.md#creation-names-reaper)); this is
   where the name is honored. A run that settles but leaks its subscription
   becomes next run's zombie double-applier.
4. **Publish the settled state** so every observing surface transitions
   from live rendering to settled rendering together.

## Teardown is an ending too

The consumer can die before the run does: the view unmounts, the app quits.
Teardown must not strand the run in a phantom live state that a future
session renders as still-streaming. Either teardown cancels (short-lived,
view-scoped runs), or the run is genuinely detached — producer continues,
events land in the durable log, and reattachment renders from that log —
but *chosen*, per product, never left to whichever behavior the cleanup
order implies.

## Resume pointers

For producers that support continuation, the settled record stores a
**resume pointer**: the position or continuation reference from which a
successor can pick up. Resume rules:

- A resumed run is a **new run** — new identity, new live state, new
  eventual settled record — that references its predecessor. Reanimating
  the old run's identity re-arms every stale event the attribution guard
  had retired.
- The pointer comes from the producer's protocol or the durable log — an
  authoritative position, not a guess from rendered length (the render
  path is throttled and truncated; any offset derived from it resumes in
  the wrong place).
- Resume is offered where it is honest: after *interrupted*, routinely;
  after *cancelled*, as a choice; after *failed*, only when the failure is
  the resumable kind. A resume affordance on an unresumable ending is a
  button-shaped apology.
