# The Findings Loop — detect → triage → dispatch → ship → verify → learn

> **Status:** Shipped (2026-07-14), through Phase 3 C/D. The one deliberately open
> piece is E — Studio/Athena involvement — deferred to its own design session.
>
> This is the *implemented-state* reference. Design history and the phase plan live
> in [`docs/plans/dev-findings-loop.md`](../../../plans/dev-findings-loop.md); the
> event/op plumbing details also appear in the
> [Events README](../../events/README.md). This page is the one place that tells
> the whole story end-to-end.

## What it is

The app has three LLM-scan surfaces that each answer a different question about a
dev project — the **Factory passport** (*can agents develop this? can I ship it?*),
**Observability** (*what does it actually do, cost, and break at runtime?*), and the
**Context Ledger** (*what is this codebase made of, business-wise?*). It also owns a
full actuator chain: ideas → Tinder triage → auto-triage rules → tasks → Task
Runner → PR Bridge → Agent Scoreboard.

The findings loop **fuses the two**: every sensor emits normalized *findings* into
the existing idea pipeline, dispatch turns an accepted finding into running work
(autonomous or interactive — your choice, per route), and verification re-measures
the signal after the work ships to answer the question nothing used to ask:

> **Did the number actually move — or did we just merge something?**

```
        SENSORS                    SPINE                     ACTUATORS
  standards scan  ─┐                                      ┌─ Task Runner ("let
  passport gaps   ─┤        dev_ideas (+origin,           │   the app do it")
  LLM cost        ─┼──▶     evidence, dedup_key)  ──▶ ────┤
  Sentry spikes   ─┤        triage / auto-rules           └─ Fleet session ("I
  KPI off-track   ─┘              │                           want to steer it")
        ▲                         │                                │
        │                         ▼                                ▼
        └──────────── VERIFY (the sweep IS the probe) ◀─── task completes / PR
                cleared · moved · unchanged · regressed
                          │
                          ▼
              LEARN — Sensor Scoreboard (verify rate),
              noisy-sensor flag, reject-origin rule suggestions
```

## The spine — a finding IS an idea

`dev_ideas` gained additive, nullable columns; a `NULL origin` is a classic
Idea-Scanner idea, so nothing about the existing pipeline changed.

| Column | Meaning |
| --- | --- |
| `origin` | which sensor raised it: `standards_finding` · `passport_gap` · `llm_cost` · `sentry_spike` · `kpi_offtrack` (validated allowlist) |
| `use_case_id` | the signal's use case (orphan-tolerant, no FK) |
| `evidence` | JSON of the **raw numbers the threshold decision was made on** — what verification later re-measures against |
| `dedup_key` | stable, self-describing key per underlying signal (`sentry:<shortId>`, `llm:cost:<slug>`, `standards:<rule_key>`, `passport:<dimKey>`, `kpi:<kpiId>`) |
| `verify_state` | `pending` · `cleared` · `moved` · `unchanged` · `regressed` |
| `verify_checked_at`, `verify_evidence` | when the verdict was taken + the re-measured reading, so a verdict is **auditable before-vs-after**, never taken on trust |

Write paths: `create_finding` (idempotent on `dedup_key` across **every** status —
a rejected finding never re-emits; a human "no" is durable; only deletion frees the
key) and `set_finding_verify_state`. Both publish signals (below) **from the repo
layer**, so no caller can raise work or land a verdict without the bus hearing it.

## The sensors — five pure emitters

All emitters are pure TypeScript over data the app already fetches — no IPC, no
LLM, no clock — which is what makes them fixture-testable and re-runnable as
probes. Every threshold lives in **one file**:
`src/features/plugins/dev-tools/sub_triage/findings/findingConfig.ts`.

| origin | Raised when | Effort/impact seeds |
| --- | --- | --- |
| `standards_finding` | a golden-standard rule isn't `present` — the rule's recommendation becomes the fix prompt (`findingPrompt`) | severity-scaled |
| `passport_gap` | an improve-plan dimension is below target, **tier ≤ 2 only** (tier 3 = a full Claude deploy stays a human click on the passport) | golden-lift-scaled |
| `llm_cost` | a use case burns > $5/30d, **or** > 30 % of calls carry no use-case label (uninstrumented call sites blind every other join) | fixed |
| `sentry_spike` | an unresolved issue exceeds 25 events — top 3 per sweep, matched onto a context via its culprit path | fixed, impact 5 |
| `kpi_offtrack` | a KPI is in `crit` — shares `collectKpiAttention` with the Factory warning badge, so the badge and the finding can't disagree | fixed |

**The sweep** (`runFindingSweep`): gather tolerantly → emit → dedup → cap (10/sweep,
impact-per-effort keeps the best; the drop count is *reported*, never hidden) →
persist. Every sensor is optional — a project with no tracer/Sentry/scan still
sweeps what it has and **names what it skipped**, so a thin sweep can't read as a
clean bill of health. Triggers: the 🛰 button on Idea Triage, or the scheduled op
(below).

## Triage — provenance, evidence, rules

- A finding leads with a **sensor badge** (Standards / Readiness / LLM cost /
  Errors / KPI) instead of the scan-agent emoji; clicking it opens the **evidence**
  it was raised on, so the claim can be judged rather than trusted.
- The sidebar gains a **Source** filter — shown only once a sensor has raised
  something (a scanner-only project sees zero new chrome).
- **Auto-triage rules** can target `origin` ("auto-accept `passport_gap`",
  "auto-reject `llm_cost`"). A scanner idea has no origin, so an origin rule can
  never sweep up the whole backlog (covered by a Rust test).

## Verification — the sweep IS the probe

There is **no probe engine**. An emitter only fires when a signal is *over*
threshold, and the sweep re-runs every emitter — so a fresh emit is itself the
measurement:

- the finding's `dedup_key` is **absent** from the fresh drafts → the signal is
  gone → **`cleared`**
- still present → compare the **primary metric** against stored `evidence` →
  **`moved`** (≥ 10 % better) · **`regressed`** (worse) · **`unchanged`**

Primary metric per origin: `llm_cost` → cost / unnamed-share · `sentry_spike` →
event count · `kpi_offtrack` → reading vs target (direction-aware) ·
`standards_finding` / `passport_gap` → presence-shaped (absence *is* the verdict).

**Honesty rules — enforced in code and tests:**

1. A finding is judged **only after the work shipped** (status `accepted` + its
   linked task `completed`). A verdict on work never done would be the most
   damaging lie the loop could tell.
2. **Never invent a `cleared`** — missing, unparseable, or incomparable evidence
   yields `unchanged`, the conservative answer.
3. A sub-10 % change is `unchanged`: claiming a win on noise is how a loop starts
   lying.
4. `unchanged` / `regressed` are surfaced **as loudly as** `cleared`; a regression
   never wears a success colour.

## Learning — credit for the number moving

- **Sensor Scoreboard** (Idea Triage page): the Agent Scoreboard can only score
  *accepted + merged*, which rewards plausibility. A sensor measures a **number**,
  so it's scored on **effect** — the **verify rate** = (cleared + moved) ÷
  verdicted. Unjudged sensors show "—", never 0 % (unknown ≠ bad); thin rates are
  labelled "(low n)".
- A credible sensor with a poor rate is flagged **noisy** — a finding about the
  finder. **Advisory only**: the app never silently retunes a sensor's threshold.
- **Rejection learning**: a sensor whose findings you keep rejecting produces an
  *"Auto-reject ⟨sensor⟩ findings"* rule suggestion (maps onto the `origin` rule
  condition). Again: we suggest, you commit.

## Scheduling — the `health_ingest` system op

Registered in the same catalog as `context_scan` / `memory_reflection`, so it
appears in **Chain Studio → System events** and binds to a **weekly cron** (or any
trigger — that flexibility is why it lives in Studio). One run = full sweep +
verification pass for a project.

**Design decision, stated plainly:** the op does *not* reimplement the sweep in
Rust — the emitters, telemetry adapters, verdict engine and passport derive are all
TypeScript, and a second implementation of the same thresholds could silently
diverge (precisely the bug class the loop exists to catch). The op emits
`health-ingest-requested` and the app runs the sweep it already owns, headlessly
(`findings/healthIngest.ts` — no hooks, no UI needed). The cost: it only runs while
the app is open — which is already true of the entire scheduler (an in-app tick,
not a daemon); a schedule due while closed fires on next launch.

## Signals — findings are a routable event source

| Event | Fires when |
| --- | --- |
| `signal.raised` | a sensor raised a finding |
| `signal.verified` | a shipped finding was re-measured and got its verdict |

Published **from the repo layer** (`create_finding` / `set_finding_verify_state`),
best-effort (a bus failure never fails the write). Payload carries everything a
route needs: `idea_id`, `origin`, `dedup_key`, `project_id`, `use_case_id`,
`impact`/`effort`/`risk`, `evidence`, `verify_state`. **No `target_persona_id`** —
a signal is an *observation, not an instruction*; a trigger or dispatch op decides
whether anyone acts. Both surface in the Live Stream (Radar / BadgeCheck icons) and
are selectable as Event-listener sources in Chain Studio.

## Dispatch — the Runner vs Fleet A/B

Two system ops that get work started on a finding, differing **only in who does
the work**:

| Op | Executor | Posture |
| --- | --- | --- |
| `signal_dispatch_runner` | Dev Task Runner — builds and PRs | autonomous: *"let the app do it"* |
| `signal_dispatch_fleet` | a Claude Code session in the project's cwd, seeded with the finding as its first prompt | interactive: *"I want to steer it"* |

Bind either to a `signal.raised` listener in Chain Studio. **Switching is a
rewire, not a code change** — the A/B is the feature, not a fork; the engine has no
opinion.

Mechanics worth knowing:

- Event-fired ops receive their triggering event under a reserved **`_event`**
  param (a general `run_op` improvement — before this, an event-bound op had no way
  to know *which* finding fired it).
- **Both** targets create a `dev_tasks` row linked via `source_idea_id` — including
  Fleet. Verification keys off that link, so both arms of the A/B are judged
  identically; without it a Fleet-dispatched finding could never be verified and
  the experiment wouldn't be comparable.
- The dispatch prompt carries the finding's evidence with the bar stated: *"the
  fix has to move them, not merely look plausible."*
- Dispatching a `pending` finding moves it to `accepted` — dispatch *is* a triage
  decision.
- **Safety is inherited, not invented**: dispatch acts on production signal, so the
  trigger's `unattended_mode` (`auto` / `dry_run` / `approval`) +
  `pending_trigger_fires` is the gate. An approval-mode automation holds its fire
  for a human.

## Verified end-to-end (live, seeded LightTrack)

- **`moved`**: a $120/30d use case raised → accepted → task completed → cost
  dropped to $30 (still emitting — the *hard* comparison path) → sweep →
  `verify_state=moved`, re-measured reading stored.
- **`cleared`**: signal removed entirely → sweep → `cleared` with
  `{"signal":"absent"}` evidence.
- **Autonomous dispatch**: `signal.raised` → runner bound in a real Studio
  automation; raising a finding — with no further input — created a linked task,
  executed it (`running`), auto-accepted the finding, and toasted the dispatch.

## Deliberately NOT built

- **E — Studio/Athena** (Athena consuming scans, speaking in design proposals,
  writing scan state back): a *separate design session*; recorded as a much larger
  product than "verify findings".
- **Auto-throttling thresholds** (B2 is advisory): a sensor that silently retunes
  itself is hard to trust before real verify rates exist.
- **Cadences beyond weekly**: deliberate — living in Chain Studio makes other
  triggers an experiment, not a code change.
- **A Rust sweep**: see the delegation rationale above; revisit only if
  unattended-while-closed becomes a real requirement.

## Commit trail

| Commit | What |
| --- | --- |
| `a3c6c218b` | Phase 1 — telemetry proposes use cases; passport shows live LLM wiring/spend |
| `a835abe0d` + `028329d07` | Context-ledger runtime chips (+ the credentials-array-identity freeze fix) |
| `098f58041` | Findings spine schema (origin / use_case_id / evidence / dedup_key) |
| `9c1e99182` | Five emitters + findingConfig + sweep |
| `c52a139c1` | Triage provenance (badge, evidence popover, Source filter, sweep button, `origin` rule) |
| `996058feb` | Verification schema (verify_state / checked_at / evidence) |
| `aaea462ed` | Verdict engine + sweep integration + Sensor Scoreboard |
| `580f82456` | Rejection learning + docs |
| `579e5e7ff` | `health_ingest` system op |
| `d799ced44` | `signal.raised` / `signal.verified` bus events |
| `402ada2ac` | Dispatch A/B (`signal_dispatch_runner` / `signal_dispatch_fleet`) + `_event` threading |
