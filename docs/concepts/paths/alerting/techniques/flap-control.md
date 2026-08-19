---
layer: technique
subject: alerting
technique: flap-control
status: forged
laws: []
shared_with: []
---

# Flap control

A signal that oscillates around a threshold turns a naive rule into a
strobe light: breach, recover, breach, recover — each transition
technically real, the sum of them pure noise. Flap control is the set of
disciplines that make a rule fire on *conditions* rather than on
*crossings*: a condition is a state the system has genuinely entered and
genuinely left, and both entering and leaving deserve deliberate
definitions.

The primitive shapes — hysteresis's dual thresholds, debounce, edge- vs
level-triggering — are owned by the scheduling subject at
[cooldown-and-debounce](../../scheduling/techniques/cooldown-and-debounce.md).
This technique is their composition into alerting's specific pipeline, plus
the one element that exists only here: the recovery notification.

## The pipeline order is fixed

Stabilization happens **before** suppression, in a fixed order, because
each stage answers a different question:

1. **Edge-trigger first.** A rule fires on the transition into breach
   (false→true), never on remaining in breach (true→true). Level-triggered
   evaluation with a cooldown bolted on looks similar from a distance and
   is wrong up close — it is a siren with a snooze button, re-alarming on a
   timer rather than on events. The rule's state (currently-breaching or
   not) is part of evaluation state, persisted with it.
2. **Sustained-for before the edge counts.** The transition into breach is
   recognized only after the condition has held for a configured duration
   or number of consecutive evaluations. This is the single highest-value
   flap defense: a ten-minute sustain requirement erases every transient
   spike for free, at the cost of ten minutes of detection latency — a cost
   the rule's author accepts *per rule*, because a latency that is
   negligible for "disk filling" may be unacceptable for "service down".
   Sustained-for is not debounce-by-another-name: debounce waits for quiet
   after stimulus; sustained-for demands *continuous* stimulus. An
   intermittent breach — nine breaching samples out of ten — resets a
   strict consecutive-sample sustain, so rules over twitchy signals specify
   their sustain as a quorum ("8 of 10 samples breaching") rather than a
   streak.
3. **Hysteresis governs the way out.** The condition ends not when the
   signal dips below the firing threshold but when it crosses a stricter
   recovery band and stays there (a recovery sustain mirrors the firing
   sustain). Symmetric thresholds guarantee flapping for any signal that
   hovers; the band width is chosen from the signal's observed noise, and
   it too is rule data.
4. **Cooldown last.** Whatever transitions survive stabilization are then
   rate-bounded by [dedup-and-cooldown](dedup-and-cooldown.md). Cooldown is
   the backstop, not the mechanism: if cooldown is doing most of the
   suppression work, the stabilization stages upstream are mistuned and the
   fire history will show it.

## Recovery is an event, and it is the flap amplifier

When a condition ends, the system says so — a **recovery notification**
closes the loop that the fire opened. An alert channel that announces
problems but never their endings forces humans to poll for good news,
which re-teaches dashboard-watching, which is what alerting exists to end.
Recovery notifications carry the duration ("breaching for 42 minutes") and
resolve the corresponding lifecycle record
([alert-lifecycle](alert-lifecycle.md)).

But recovery doubles the flap surface: a flapping signal without hysteresis
now produces *pairs* of messages, fire-recover-fire-recover, twice the
noise of fires alone. Hence two rules. First, recovery honesty depends
entirely on stage 3 — a recovery may only be announced when the hysteresis
band and recovery sustain say the condition truly ended, never on the first
non-breaching sample. Second, recovery delivery is *quieter* than fire
delivery by default (it resolves state and informs; it does not interrupt),
so even a residual flap costs attention asymmetrically little.

## Decision rules

- Every rule gets a sustain duration; zero is a value the author must
  choose explicitly, not a default they fall into.
- Hysteresis bands and sustains are per-rule data, tuned from the fire
  history — a rule that fired and recovered more than a few times in one
  day is the retuning signal.
- The currently-breaching state, the sustain progress, and the hysteresis
  side survive restart with the rest of evaluation state — a restart that
  forgets "we were mid-breach" either drops a real fire or re-fires a
  handled one.
- Detection latency introduced by sustain is disclosed on the rule's
  authoring surface ("fires after N minutes of breach"), because the author
  is trading latency for quiet and should see both sides of the trade.
