---
layer: technique
subject: eval-harness
technique: eval-economics
status: forged
laws: [creation-names-reaper, derivation-names-recomputation, failure-not-empty-success]
shared_with: []
---

# Eval economics

Every eval cell costs tokens, seconds, and rate-limit headroom, and the
suite's size grows multiplicatively — candidates × variants × scenarios ×
trials × judge calls. Nothing else in a codebase has this cost curve: a
unit suite that doubles gets slower; an eval matrix that adds one axis gets
an order of magnitude more expensive. Unmanaged, the curve crosses the
team's patience, the suite stops being run, and — the failure this
technique exists to prevent — **the organization keeps citing numbers no
instrument is producing anymore**. An eval that stopped running is worse
than none: none is a known gap; stopped is a confidence forgery.

The controls are structural. Discipline ("run it before big releases")
decays; architecture does not.

## Mock execution modes

The harness itself is software — planning, fan-out, aggregation, artifact
writing, verdict extraction — and all of it must be testable without paying
for a single model call. A mock mode substitutes model invocations with
canned or synthesized outputs (including, deliberately, malformed ones and
errors) while every other component runs for real.

What mock mode buys: the harness's own test suite runs in the deterministic
lane at zero cost; a new scenario set or aggregation rule is shaken down
before real spend touches it; a matrix run's plumbing — did every cell get
planned, did retries work, did the artifact land — is verified in seconds.
What it must never be allowed to do: leak into real reports. A mocked run's
artifact carries an unmistakable marker, and downstream consumers refuse
unmarked provenance — a mocked score in a real trend line is worse than the
suite silently not running, because it actively fabricates the signal
([_laws: failure-not-empty-success_](../../_laws.md#failure-not-empty-success):
"did not really measure" must be spelled differently from "measured").

## Caches with declared lifetimes

The expensive intermediates — generated scenario sets above all, but also
judge verdicts over immutable outputs, and derived surface models used by
theoretical certification — are cached. Two rules keep caching from
corrupting the measurements it accelerates:

- **The key scope is a correctness decision, not a performance one.** What
  the key includes decides what the harness treats as "the same question."
  The canonical case — scenario caches keyed to exclude candidate material
  so version deltas stay comparable — is owned by
  [scenario-design](scenario-design.md); the general rule is that every
  cache's key scope and invalidation story are written down where the cache
  lives ([_laws: derivation-names-recomputation_](../../_laws.md#derivation-names-recomputation)).
- **Every entry names its reaper**
  ([_laws: creation-names-reaper_](../../_laws.md#creation-names-reaper)) —
  a lifetime, an explicit flush, an invalidating upgrade. An eval cache
  with no expiry quietly becomes the *real* fixture set, diverging from the
  declared one; a lifetime too short silently converts "cached" back into
  "regenerated per run" and the spend returns wearing a green cache label.

Judge verdicts deserve a special note: an output already scored under an
identical judge packet need never be re-scored — verdict caching keyed on
(output, packet version) makes reruns and re-aggregations nearly free, and
is entirely safe *because* the packet version is in the key.

## Fan-out caps

A matrix run is a burst engine: hundreds of cells, each wanting a model
call now. Uncapped, it stampedes rate limits (turning into retry storms
that cost more than the run), starves interactive users of the same
capacity, and converts a budget into a surprise. The harness runs all
fan-out through a bounded concurrency primitive — a semaphore, a worker
pool — with the bound declared per lane, and burst-level failures handled
at the platform seam per the retry-backoff standard rather than
rediscovered per suite.

Caps compose with budgets: a run declares its expected cell count and cost
ceiling up front, and the harness refuses to start a run whose plan exceeds
the ceiling — the moment to discover a matrix is unaffordable is before
cell one, not at the invoice.

A related default trap: every model call the harness makes *for its own
purposes* — scenario generation, summaries, judging — pins its model
explicitly. An unpinned harness-internal call rides whatever the account or
platform default happens to be, which is typically the most expensive
option and changes without notice; the harness's own overhead becomes both
unpredictable in cost and unstable as an instrument.

## Tiered cadence: run the right slice at the right time

The suite is not one thing that runs or does not; it is slices priced for
their trigger:

| Slice | Cost | Trigger |
| --- | --- | --- |
| harness self-tests (mock mode) | free | every change, in the deterministic lane |
| golden set — small, frozen, high-signal scenarios over the pieces that shape model behavior | cents | every change to those pieces, blocking |
| full absolute suite | real money | scheduled, and on demand before releases |
| matrix / arena surveys | most expensive | when a selection decision is actually pending |
| live certification | expensive + serial | promotion events (see [certification-levels](certification-levels.md)) |

The golden-set tier deserves emphasis because it is the cheapest insurance
in the whole scheme: the components that assemble instructions, sanitize
inputs, and shape model behavior are ordinary deterministic code, and a
tiny frozen eval over their *outputs* catches regressions in the expensive
system's inputs without invoking the expensive system at all. It runs with
the deterministic gates and blocks like one.

And cadence is monitored, not assumed: the suite records when each slice
last actually ran, and staleness is surfaced wherever results are read. A
dashboard serving three-month-old scores as if current is this technique's
titular failure — spend controls exist precisely so that never becomes the
rational choice.
