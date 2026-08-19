---
layer: technique
subject: data-viz
technique: metric-identity
status: forged
laws: [one-authority-per-vocabulary, derivation-names-recomputation]
shared_with: []
---

# Metric identity

A metric is not a number — it is a **name with a contract behind it**. "Error
rate" is meaningless until the contract answers: errors of what kind, divided
by what denominator, over what window, filtered how, in what unit. Every
surface that displays a named metric is making the claim that its number
satisfies that contract, and the user's trust in the whole product rides on
those claims agreeing. The most corrosive data defect a product can ship is
two surfaces showing different values under the same metric name — worse than
either being wrong alone, because disagreement proves at least one surface
lies and gives the user no way to know which.

## The contract, made explicit

Each named metric carries, in one authoritative definition:

- **Name and unit** — the display name, the unit, and the display precision.
  Precision is part of identity: one surface rounding to integers while
  another shows two decimals *reads* as disagreement even when the underlying
  value is identical.
- **Derivation** — the computation, precisely: numerator, denominator, the
  aggregation function, and what happens at the edges (empty input, division
  by zero, a single point).
- **Window and grain** — over what time span, bucketed how, and whether the
  trailing partial bucket is included. Two correct derivations over
  "yesterday" and "trailing 24 hours" diverge every hour of the day.
- **Population and source** — which records are in scope, read from where.
  "Excluding test traffic" left implicit is the classic silent divergence —
  and so is one surface reading raw records while its neighbor reads a
  retention-surviving rollup of the same events. The two can legitimately
  disagree by double-digit percentages; if the definition does not name the
  source, the disagreement surfaces as a bug report against whichever number
  the user saw second.
- **Polarity** — which direction is *good*. A metric where rising is bad
  (cost, latency, errors) must carry that fact in its definition, because
  every consumer that colors a delta or points an arrow needs it; polarity
  decided per call site is polarity wrong somewhere.

This is [one authority per
vocabulary](../../_laws.md#one-authority-per-vocabulary) applied to numbers:
the set of named metrics is a closed vocabulary, and every consumer derives
from the single definition rather than re-stating it.

When a product genuinely needs the same display name over different windows
or sources on different surfaces — "success rate" over recent activity on one
page and over a selected range on another — the divergence is **registered,
not accidental**: each variant gets its own id naming its surface, window,
and source in one shared registry, all variants share the one resolving
computation, and each surface states its window where the number renders. A
registry of declared variants is the honest middle between a false single
number and silent forks — the reader can be told why two pages differ; with
forks, nobody can.

Provenance is part of the value, not metadata to drop: when a pipeline
*merges* sources (a live table and a frozen rollup, a cache and a recompute),
which source answered — and of what vintage — must survive into the wire
format the surfaces consume. The observed failure shape is a merge function
that computes exactly which source won per point, then discards the answer
because the transport type has no field for it, leaving every downstream
pixel structurally unable to disclose what it is showing.

## One derivation, many surfaces

The structural rule: **the derivation is implemented once and imported
everywhere the metric appears** — chart, tile, table column, tooltip, export,
alert threshold. Surfaces differ in *presentation* (a sparkline vs a number vs
a color), never in *computation*. The moment a display site contains its own
arithmetic beyond formatting, it has forked the metric; the fork will drift
the first time the definition changes and someone updates only the sites they
remember.

Formatting is deliberately split from derivation: the derivation produces a
value in canonical units; a shared formatter renders it for humans. This keeps
the "1.2k vs 1,204" class of pseudo-disagreement out of the derivation layer
and lets precision policy change without touching computation.

## Forced duplication gets a parity gate

Sometimes one implementation is impossible: a backend aggregates at the store
while a frontend recomputes a preview, or two services in different languages
both need the number. Then the duplication is **declared and gated**, never
tolerated informally:

- Both implementations run against **shared fixtures** — the same inputs,
  including the nasty edges (empty series, one point, all zeros, a gap, an
  extreme outlier) — and a test fails when outputs diverge beyond declared
  tolerance.
- The fixtures live where both implementations can reach them, and the gate
  runs on every change to either side. A parity check run once at migration
  time is a photograph of agreement, not a guarantee of it.
- The tolerance is explicit. Floating-point aggregation across languages will
  differ in the last bits; a gate with no stated tolerance either flakes or
  gets loosened silently until it gates nothing.
- A mirror maintained by a comment — "exact port of X, keep the two in sync" —
  is a parity *intention*, not a parity gate. Each side's own unit tests can
  stay green forever while the pair drifts, because neither suite reads the
  other's outputs. The comment names the coupling; only shared fixtures
  enforce it.

This is [derivation names its
recomputation](../../_laws.md#derivation-names-recomputation) at system scale:
each copy of the derivation names the other, and the gate is the arbiter that
the law demands.

## Identity through change

Metric definitions change — a denominator gets corrected, test traffic gets
excluded, a window shifts. The change is an **event, not an edit**:

- A semantic change under the same name silently invalidates every historical
  comparison the user makes across the change date. Either version the metric
  (a new name, or an annotated definition change visible where the metric is
  read), or backfill history under the new definition — never let the line
  quietly change meaning mid-series.
- Renames keep the identity: dashboards, alerts, and saved views reference the
  metric by stable id, not by display name, so a rename is cosmetic rather
  than a breakage or — worse — an accidental fork.

## Smells that mean identity has already forked

- The same metric name appears with different values on two surfaces, and the
  team's explanation involves the word "roughly".
- A display component contains a `sum`, a `divide`, or a windowing loop of its
  own instead of receiving the derived value.
- Two implementations of one metric exist and no test would fail if one of
  them changed.
- The definition of a metric can only be recovered by reading the code that
  computes it — nothing states the contract at the level the user reads.
