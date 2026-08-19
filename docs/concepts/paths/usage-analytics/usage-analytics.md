---
layer: golden-path
subject: usage-analytics
status: forged
techniques:
  - event-taxonomy
  - coverage-from-registries
  - privacy-scrubbing
  - batching-and-quota
  - sink-abstraction
  - activation-and-funnel-honesty
evidence:
  - src/lib/analytics/index.ts       # per-session counters, one session_summary flush, visited+ignored+activation reporting
  - src/lib/analytics/navCatalog.ts  # tracked-surface list derived from the nav registry — coverage cannot drift from the shell
  - src/lib/analytics/sink.ts        # pluggable sink boundary; scrubbed default; null sink for opt-out
  - src/lib/analytics/activation.ts  # activation as completed actions (closed const funnel, once-per-install dedupe), never visits
counter_evidence:
  - src/lib/execution/middleware/analyticsMiddleware.ts   # usage-shaped telemetry emitted outside the sink — the second door the standard forbids
deviations:
  - w5-usage-analytics   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Product usage analytics

Usage analytics answers one question a product team cannot answer any other
way: **which of the surfaces we pay to maintain do users actually live in, and
which do they walk past?** Every screen, tab, and feature has a carrying cost —
maintenance, testing, translation, design attention, cognitive load on every
user who scans past it. Usage measurement is how that cost gets an offsetting
revenue column. Without it, roadmaps are steered by the loudest anecdote and
sunset decisions are guesses.

Two properties define the discipline, and every standard below follows from
them:

- **The subject of measurement is the product, not the person.** The question
  is "does this surface earn its place", never "what did this user do". That
  is not a privacy policy bolted on afterward; it is the design constraint
  that shapes the vocabulary (surfaces and actions, not content), the payload
  (counts, not trails), the granularity (sessions, not clicks), and the
  destination (aggregates, not profiles). A pipeline built person-first cannot
  be scrubbed into a product-first one later — the shape of the data is the
  policy.
- **The instrument must be trusted twice.** Users must trust it not to watch
  them, and the people reading the numbers must trust it not to lie. Both
  trusts are architectural: the first is earned by scrubbing at the source and
  aggregating before anything leaves the machine; the second by deriving
  coverage from the product's own registries so the numbers measure the whole
  product, not the subset someone remembered to instrument.

The failure modes split the same way. Privacy failures — payloads that carry
user content, per-interaction transmission that reconstructs a behavioral
trail on someone else's server — break the first property. Epistemic failures
— an event swamp nobody can query, coverage that silently omits every surface
shipped after the instrumentation pass, dashboards that count visits and call
them value — break the second, and they are the quieter and more common kind:
the pipeline keeps humming while the numbers stop meaning anything.

## The vocabulary is designed, not accreted

An analytics system is a language before it is a pipeline. Free-form event
recording — any call site can emit any string with any payload — produces
within a year an unqueryable swamp: three spellings of the same action, plurals
and tenses at war, payload keys that mean different things on different
screens, and no way to ask "how often does X happen" because X has no single
name. The standard is a **closed, owned vocabulary**: every event name and
every payload field is declared in one registry before any call site may emit
it, and the emit door rejects what the registry does not know. What earns a
place in the vocabulary is a decision rule, not enthusiasm — an event exists
because a named question depends on it. The grammar, the versioning rules, and
the retirement path are the [event-taxonomy](techniques/event-taxonomy.md)
technique.

## Coverage comes from the product's own map

The most damaging analytics failure is invisible: a surface that ships without
instrumentation simply produces no data, and no data is indistinguishable from
no usage — or worse, the surface never appears in the report at all, so nobody
notices it is unmeasured. Discipline cannot fix this; every team eventually
forgets one. Structure can: the product already maintains an authoritative
registry of its surfaces — the [app shell](../app-shell/app-shell.md)'s
navigation registry is the canonical one — and the tracked-surface list must be
**derived from that registry**, never hand-maintained beside it. A new section
added to the shell then enters the measurement frame on the day it ships,
appearing in reports as *visited zero times* rather than vanishing from them.
Deriving coverage, and reporting against the full denominator, is the
[coverage-from-registries](techniques/coverage-from-registries.md) technique.

## The negative space is first-class data

What users ignore tells the team more than what they visit. Visited surfaces
mostly confirm what everyone believed; the ignored list is where the surprises
live — the expensive feature nobody opens, the section whose only visits are
mis-clicks that bounce in seconds, the tab that a whole cohort has never seen.
A report that lists only observed events structurally cannot show this: absence
of a row reads as nothing, and nothing draws no attention. The standard is that
every report enumerates the **full surface list with zeros filled in** — the
ignored-surface report is a product artifact with a consumer and a cadence, not
a query someone might run. Turning it into roadmap decisions without
over-reading it is half of
[activation-and-funnel-honesty](techniques/activation-and-funnel-honesty.md).

## Privacy is a posture, not a filter

Privacy in analytics is decided by *where* operations happen, not by what a
policy document promises:

- **Scrub at the source.** The payload is clean the moment it is created —
  fields are admitted by allowlist, never removed by denylist downstream.
  Data that was never recorded cannot leak, be subpoenaed, or be mishandled
  by the next engineer.
- **Aggregate before anything leaves.** Counts, durations, and flags computed
  locally; the machine transmits summaries, not streams. A server that only
  ever receives "this session visited these sections N times" cannot
  reconstruct a behavioral trail, because the trail never existed off the
  device.
- **Local-first where possible.** Insight that can be computed and shown on
  the user's own machine should be; egress is for the questions that
  genuinely require population-level aggregation.
- **Opt-out is silence, not flagged data.** A user who declines produces no
  transmission at all — not events tagged "do not process".

The allowlist mechanics, identity handling, and consent interplay are the
[privacy-scrubbing](techniques/privacy-scrubbing.md) technique.

## One summary beats a thousand pings

Per-interaction transmission is wrong three ways at once: it is a **cost**
(every click a network call, a quota unit, a server write), a **privacy leak**
(timestamps of individual actions are a behavioral trail even when payloads
are clean), and a **fragility** (the pipeline's failure surface scales with
interaction count). The standard is per-session accumulation: counters
increment locally all session, and one summary flushes at session end. This
buys quota economics that per-click systems cannot approach, and it makes the
privacy aggregation property structural rather than aspirational. The price is
honest loss tolerance — a crashed session may lose its summary, and the
discipline is to know the loss rate rather than pretend it is zero. Flush
timing, shutdown handling, and quota budgets are the
[batching-and-quota](techniques/batching-and-quota.md) technique.

## The sink is a boundary, and failure there is nobody's problem but ours

Where summaries go — a local store, a self-hosted collector, a vendor, nowhere
— is a deployment decision that must not be visible to any call site. One sink
interface, chosen at startup: the measurement layer records against the
contract, and destinations are swapped without touching product code. Two
rules make the boundary safe. The opted-out user gets a **null sink** — the
same contract, deliberately discarding, so call sites never branch on consent.
And a sink failure is a background fact: it must never surface to the user or
destabilize the product, but it must remain visible to operators through the
product's [error doors](../error-handling/techniques/error-doors.md) — a sink
that fails silently for a month is a coverage hole wearing a green light. The
contract is the [sink-abstraction](techniques/sink-abstraction.md) technique.

## The numbers mean less than they appear to

The last discipline is interpretive. A visit proves presence, not value — the
user may have been lost, mis-clicked, or bounced. Activation must be defined
from **meaningful actions completed**, never from arrival. Every rate must
carry its denominator, every comparison must respect vocabulary versions, and
a surface's zero must be read against its reachability before it is read as
rejection. Teams that skip this discipline end up with dashboards that are
precise, trended, beautifully rendered — and answering questions nobody asked.
The rules are the
[activation-and-funnel-honesty](techniques/activation-and-funnel-honesty.md)
technique.

## The techniques

- [event-taxonomy](techniques/event-taxonomy.md) — the event vocabulary as a
  designed language: naming grammar, the closed registry, what earns an
  event, versioning and retirement.
- [coverage-from-registries](techniques/coverage-from-registries.md) —
  deriving the tracked-surface list from the product's own registries so
  coverage drift is structurally impossible; reporting visited and ignored
  against the full denominator.
- [privacy-scrubbing](techniques/privacy-scrubbing.md) — allowlist payloads
  at the source, identity handling, aggregation before egress, consent
  interplay.
- [batching-and-quota](techniques/batching-and-quota.md) — session counters
  flushed as one summary; shutdown handling; quantified loss tolerance;
  quota budgets.
- [sink-abstraction](techniques/sink-abstraction.md) — the pluggable
  destination contract, the null sink for opt-out, and sink failure as a
  visible background fact.
- [activation-and-funnel-honesty](techniques/activation-and-funnel-honesty.md)
  — activation from actions not visits, denominator discipline, and the
  ignored-surface report as roadmap input.
