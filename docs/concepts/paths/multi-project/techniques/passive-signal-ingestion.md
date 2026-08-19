---
layer: technique
subject: multi-project
technique: passive-signal-ingestion
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary, creation-names-reaper, derivation-names-recomputation]
shared_with: []
---

# Passive signal ingestion

The portfolio's picture of each project must be current without the
portfolio doing the projects' work over again. The wrong architecture
interrogates: re-scan each codebase, re-query each tool, re-walk each
history whenever a surface needs freshness — O(N × cost), paid at view time,
stale anyway because it measures when someone looks rather than when
something happens. The right architecture **listens**: every managed project
already produces exhaust as a side effect of being worked on, and the
manager's job is to watch that exhaust cheaply, continuously, and honestly.

## Watch the exhaust, not the work

The signal sources are the project's own native records, read where they
already live:

- **Version-control history** — commits, branches, merges: who did what,
  when, at what tempo. The single richest feed, and free.
- **Work ledgers** — session logs, run records, task journals left by the
  tools that operate on the project.
- **Notes and knowledge artifacts** — the human-side record of decisions
  and plans.
- **Run artifacts** — build results, score outputs, published reports.

Two properties define "passive." **Read-only:** watchers never write into
the project, never trigger its tooling, never cause the activity they
measure — a watcher that mutates its subject is an instrument corrupting its
own reading. **Exhaust-only:** if a signal requires *running* something in
the project, it belongs to a scanning or scoring pipeline with its own
schedule and budget — not to the watch loop, whose entire contract is
"cheap enough to run forever."

## Cadence: baseline plus acceleration

Uniform polling wastes exactly where portfolios are lumpy: most projects are
quiet most of the time, a few are hot right now. The standard is a **modest
baseline cadence** for every watched project — hourly is a sane default;
its job is bounding staleness for the quiet — plus **acceleration on
evidence of activity**: a cheap change probe (a head pointer moved, a file
stamp advanced, a ledger grew) promotes the project to a fast lane until it
cools. Cost then follows relevance by construction. The inverse matters too:
repeated no-change probes decay a project back toward the baseline floor,
so the fast lane never becomes a second permanent poll.

Acceleration may also be **announced**: the tools working inside a project
can push "something just happened here" to the manager, triggering an
out-of-cadence ingestion instead of waiting for the next tick. An announced
lane needs one guard the probe lane gets for free — a **per-project
debounce**: one hot session announcing every few seconds must not be able
to starve the shared ingestion-and-digestion budget, so out-of-cadence runs
are capped per project per window, and an announcement inside the window
coalesces rather than queues.

Watchers are supervised recurring work — registered, isolated per project
(one unreadable project must not stall the sweep), budgeted, and reaped with
their project's archival
([creation names its reaper](../../_laws.md#creation-names-reaper)); the
general obligations live in
[background-jobs](../../background-jobs/background-jobs.md).

## Normalize into one event vocabulary

Raw exhaust is heterogeneous per source and per stack. At the ingestion
boundary each observation is normalized into the portfolio's **one signal
vocabulary** — a closed set of event kinds (work-landed, run-completed,
note-taken, milestone-moved, …) with a common envelope: project key, kind,
timestamp, actor when known, a one-line human rendering, and a link back to
the raw source
([one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Every consumer — wall, tabs, pulse, alerting — reads the normalized stream.
The alternative, each surface parsing raw exhaust its own way, guarantees
two surfaces eventually disagree about what happened.

## The pulse: a narrative, not a log

Consolidation is the step that makes signals *legible*: per project, the
normalized events are digested into a **pulse** — a compact, chronological
narrative of the recent past ("landed the payments refactor across nine
changes; scores refreshed, two dimensions improved; notes added on the
rollout plan") rather than an unbounded event list. The pulse is a stored
derivation: bounded in length, rebuilt from the event stream on demand, its
recomputation named
([derivation names recomputation](../../_laws.md#derivation-names-recomputation)).
Summarization may be mechanical (grouping, counting, templating) or
model-assisted; either way the pulse links back to the events it digests,
because a narrative nobody can audit decays into a narrative nobody
believes.

Two further properties separate a pulse from a fancy log. **Continuity:**
successive digestions carry forward, revise, or explicitly retire the named
threads of the previous pulse rather than rewriting from scratch — a
narrative that reinvents itself every cycle is churn wearing prose, and the
"carry / replace / retire" decision is exactly the judgment the
consolidation step exists to make. **Cost accounting:** when digestion
spends a metered resource (model calls above all), the pulse records what
its own production cost, per run — a continuously running summarizer whose
spend is invisible is the one background expense nobody ever approves and
nobody ever cancels.

Consumers read the digest — the pulse and the normalized stream — and never
reach past it to re-walk raw exhaust. One digest per project is the single
authority for "what happened lately"; the moment a surface bypasses it, the
portfolio has two recent pasts.

## Unwatched is a state, never a silence

The failure mode that ruins listening architectures: a watcher loses access
— path gone, permissions revoked, machine asleep, parser broken by a format
change — and reports *nothing*, which downstream renders exactly like a
genuinely quiet project. The portfolio then shows calm for a project it can
no longer see; the operator trusts the calm; weeks vanish. The law is
[failure ≠ empty success](../../_laws.md#failure-not-empty-success), applied
without exception:

- Every watch attempt ends in an explicit verdict: **observed-changes,
  observed-quiet, or could-not-observe** — three outcomes, never two.
- Could-not-observe is durable state on the project (unwatched-since, with
  the reason), surfaced at every drill level — the wall card, the matrix,
  the tab glyph all show *blind*, distinctly from *quiet*.
- Watch freshness is itself a signal: "last successfully observed" is part
  of the project's summary row, so even the success path carries its age.
