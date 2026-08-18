---
layer: technique
subject: usage-analytics
technique: activation-and-funnel-honesty
status: forged
laws: [count-carries-predicate, gate-sees-target, deletion-is-not-repair]
shared_with: []
---

# Activation and funnel honesty

Collection is the easy half of usage analytics; the hard half is refusing to
let the numbers claim more than they know. This technique is the reading
discipline: what a visit proves, what activation must mean, which
denominators make a rate honest, and how the ignored-surface report becomes
roadmap input without becoming a bludgeon.

## A visit proves presence, nothing more

A surface-visited event records that the surface was on screen. It does not
record comprehension, intent, satisfaction, or value. Visits are inflated by
mis-clicks, by users hunting for something else, by a navigation design that
routes traffic *through* a surface, and by the product's own defaults — the
section the product opens into will always "win" visits it never earned.
Treating visit counts as a value ranking measures the map's topology, not
the users' preferences
([law: a gate must see its target](../../_laws.md#gate-sees-target) — visits
are a proxy, and a metric that watches a proxy validates the proxy, not the
thing). Visits answer reach questions — was it seen, was it found — and
nothing else.

## Activation is a completed action, defined per surface, in advance

Activation must be defined as **the surface's meaningful action, carried to
completion**: a record created and kept, an export finished, a configuration
changed and saved, a run launched. For every measured surface the definition
is written down *before* the data is read — per surface, because surfaces
have different meaningful actions, and in advance, because a definition
chosen while staring at the numbers will be the definition that flatters
them. Weak definitions — dwell time, scroll depth, "clicked anything" — are
visits wearing activation's name.

First-time milestones — the "reached value" events a funnel is built from —
fire once per installation, which makes their dedupe latch part of the data's
integrity: **the latch must record delivery, not intent.** Write it after the
emission is accepted, never before. A latch written first turns every failed
or deliberately discarded emission (an opted-out period, a dead destination)
into a milestone that is permanently consumed and never reported — and since
the funnel's whole population is one row per installation per step, each such
loss is a missing denominator entry, not noise in an aggregate.

The visit/activation pair is the unit of interpretation: reach without
activation says *found but not useful* (or not understood); activation
without reach says *useful but buried*. Those two findings have opposite
remedies — the first is a value problem, the second a navigation problem —
and collapsing them into one "engagement" number destroys exactly the
distinction a roadmap needs.

## Denominator discipline

Every rate published carries its denominator, and the denominator is the
population actually eligible
([law: a count carries its predicate](../../_laws.md#count-carries-predicate)):

- **"Activation rate" of a surface** is activations over *sessions that
  visited it* — or over *sessions where it was offered* — and the two are
  different claims; say which.
- **Entitlement-gated surfaces** exclude users not offered them (the
  distinction [coverage-from-registries](coverage-from-registries.md)
  carries). A surface half the fleet cannot see is not "ignored by half the
  fleet".
- **Funnels are cohorted, not cross-sectional.** Dividing this period's
  completions by this period's starts mixes cohorts and can exceed 100% or
  understate collapse; a funnel follows the sessions that entered step one.
- **Comparisons respect the vocabulary version.** A trend spanning an event
  rename, a widened definition, or an instrumentation fix is two series
  wearing one line; the taxonomy's version boundaries
  ([event-taxonomy](event-taxonomy.md)) are annotation points every chart
  inherits.

## Reading the ignored-surface report

The ignored list — offered N sessions, opened zero — is the report's highest
signal and its easiest misread. Before a zero becomes a verdict, three checks:

- **Reachability.** Is the surface findable — present in navigation,
  labeled comprehensibly, not buried four levels deep? A zero on an
  unfindable surface indicts the shell, not the feature.
- **Audience and window.** Rare-but-critical surfaces (recovery, audit,
  compliance) are *supposed* to read near zero in any given period; their
  question is "did it work when needed", not "is it visited weekly".
- **Instrumentation.** Rule out the measurement itself — a surface whose
  visit event broke reads identically to an abandoned one. The coverage
  frame makes the surface *appear*; it does not prove the emit path fired.
  Cross-check against the loss and delivery accounting
  ([sink-abstraction](sink-abstraction.md)) before concluding anything.

A zero that survives all three is a real finding, and the honest responses
are: invest (the value hypothesis still stands but discovery failed),
reposition (move it to where its audience is), or remove — *as a product
decision that also removes the carrying cost*. What is not a response is
quietly dropping the surface from the report so the dashboard looks
healthier; hiding the measurement of a failure is not repairing the failure
([law: deletion is not repair](../../_laws.md#deletion-is-not-repair)).

## Honesty about the instrument itself

Standing caveats that belong on the dashboard, not in a footnote nobody
finds: opted-out users are invisible, and their absence is not random —
consent skews with user type, so the measured population is a biased sample
of the real one. Summaries lost with crashed sessions skew against exactly
the sessions that crashed (see [batching-and-quota](batching-and-quota.md)).
Small denominators produce loud percentages — a surface offered to nine
users does not have a "22% activation rate", it has two activations. None of
these invalidate the instrument; all of them bound what it may claim, and a
team that states the bounds keeps the trust that makes the numbers worth
collecting at all.
