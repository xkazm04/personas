# KPI Simulation — a skill-driven Dev-runner operation that measures locally, simulates users, and predicts real use

> Status: DESIGN (no code). Companion to [`kpi-driven-orchestration.md`](./kpi-driven-orchestration.md)
> (P0–P6 shipped: schema, proposal scan, evaluation runner, derivation, autopilot)
> and the passport env split (local / test / production, shipped 2026-07-23,
> `89ae3faf5` + `0c7289409`). Method donor: [`.claude/skills/uat`](../../.claude/skills/uat/skill.md).

## The idea (user framing)

KPIs today are measured from **manual feedback** or **automatically from
monitoring tools** — which means a project with no production traffic and no
bound connectors has KPI cards that sit *unmeasured* forever. The proposal: an
LLM operation, launched as a **long Dev-runner session via a skill**, that

1. **simulates** KPI values from what CAN be exercised locally (tests, the
   test-automation harness, UAT-style Character journeys),
2. **predicts** real app use by researching comparable products, and
3. **adjusts** existing KPIs (targets, cadences, measurability) — proposal-gated.

Model routing: **Sonnet** for the fan-out research subagents (codebase +
training-data + web), **Opus** for orchestration and result synthesis.

## Feasibility verdict: YES — most machinery exists; the new work is one schema
axis, one ingestion command, one skill, and one dispatch button

| Needed | Already shipped | Gap |
|---|---|---|
| Run LLM-authored measurement on a repo | P3 evaluation runner: `run_kpi_evaluation`, `measure_config` recipes, evidence JSON, provenance UI (`kpiMeasurementProvenance.ts`) | none |
| Land LLM output as reviewable KPI rows | Proposal scan (`dev_tools_scan_kpis`): headless pass → `status='proposed'` → accept/adjust/reject queue, rejected = negative examples | none |
| Long Dev-runner session w/ live terminal | Passport Fleet dispatch (`dispatchRowToFleet`, dedup keys, state-tinted icon, `PassportTerminalModal`, 5s poll) — shipped R19/R20 | reuse with a `kpi-sim:<project>` key |
| Simulated-user method | `/uat` skill: Characters w/ scored criteria, L1 theoretical (mass-parallel), L2 empirical over `:17320`, adversarial verify, `runs/` artifacts | reuse; bind journeys → KPIs |
| Env vocabulary | Passport env split: local / test / production as first-class slots with honest empties | extend to `dev_kpi_measurements` |
| Sonnet subagents + Opus orchestrator | Claude Code: session `--model opus`; skill-defined agents with `model: sonnet` frontmatter; Task-tool fan-out | none |
| Results back into the app | — | **NEW**: result-file + `dev_tools_ingest_kpi_simulation` (a CLI session must never write `personas.db` directly) |

## The epistemic design (the crux — three output classes, never blended)

The single biggest risk is fabrication: an LLM "simulating" a traffic KPI is
inventing a number. The design splits outputs by what can honestly back them,
and maps them onto the **environment axis** the passport just made first-class:

| Class | What | Env | Lands as | Honesty rule |
|---|---|---|---|---|
| **1. Measured locally** | Technical/quality KPIs whose procedure runs in the repo (coverage, test pass rate, lint count, bundle size, local bench p95) | `local` | Real measurement rows (`source='evaluator'`, `env='local'`) once the authored procedure is adopted | Not simulation at all — the sim run **authors the `measure_config`** for KPIs parked `manual`, test-runs it, and proposes adoption. After adoption the existing no-LLM evaluator measures on cadence for free. **This is the operation's most durable value: converting unmeasurable KPIs into measurable ones.** |
| **2. Simulated user behavior** | UAT-method Characters walking KPI-bound journeys — L1 theoretical (mass-parallel Sonnet), optional L2 live over `:17320` (serial) | `test` | Measurement rows `source='simulation'`, `env='test'`, evidence = `{sim_run_id, characters, journeys, confidence, journal_refs}` | Proxy metrics only: journey completion rate, simulated time-to-value, senior-bar pass rate, per-segment adoption verdicts. Framed as "12/15 simulated users completed onboarding", never as real users. |
| **3. Predicted real use** | Web-research benchmarks (comparable tools' conversion/retention/latency/cost norms) + training data → ranges for traffic/value KPIs | — | **Never a measurement.** Only proposals: adjust target/baseline/cadence, add missing KPIs, retire unmeasurable ones — rationale + citations in evidence, through the existing proposals queue | A forecast is a proposal about *what to aim for*, not a data point about *what happened*. The queue's accept-with-adjust flow is the human gate. |

### Hard guardrails

- **Simulated rows never advance `current_value` / `last_measured_at`** — the
  ingestion writes them as series points only. Off-track derivation
  (`kpiTrack` / `kpi_is_off_track`) and autopilot therefore never fire from a
  simulation. A sim that *finds* an off-track condition emits a **finding**
  (`dev_ideas`, origin `kpi_sim`) into the triage spine instead — advisory.
- **Every number needs evidence** — a command + output tail (class 1), a
  character-run journal ref (class 2), or a citation (class 3). The Opus
  synthesis includes an adversarial pass that deletes any value it cannot
  trace; the result schema makes evidence non-optional.
- **All KPI mutations are proposal-gated** — the sim never edits an active KPI.

## Architecture

### A. Schema (small migration)

- `dev_kpi_measurements.env TEXT NOT NULL DEFAULT 'production'`
  (`local|test|production`) + widen the `source` CHECK with `'simulation'`.
- ts-rs regen. Ingestion path writes sim rows without the current-value
  roll-forward (a second insert fn, not a flag on the existing one).

UI: the trend chart gains **dashed series per non-production env** (solid =
production/real); the detail drawer's measurement list shows an env chip and
the existing provenance line covers the rest. The dashboard's pace/stat math is
untouched (it reads `current_value`, which sims never move).

### B. The skill — `.claude/skills/kpi-sim/` + repo overlay `kpi-sim/`

Engine/overlay split exactly like `/uat` (and it **reuses `uat/characters/` and
`uat/journeys/` when present** rather than inventing a second cast):

```
kpi-sim/
  bindings/<kpi-id>.md   # per-KPI: class (1/2/3), simulation procedure or journey binding, benchmark queries
  runs/<date-slug>/      # result.json, report.md, per-character journals (gitignored captures)
  accepted-limits.md     # KPIs judged honestly unsimulatable (won't re-attempt)
```

Modes:
- `init` — read the project's KPI snapshot (embedded in the dispatch prompt),
  classify each KPI into class 1/2/3 (or *unsimulatable*), draft bindings.
- `run` — the full operation (below). `--l1-only` skips live L2; `--kpi <id>` scopes.
- `predict` — class-3 refresh only (web research → adjustment proposals).

### C. The run (Opus orchestrates, Sonnet fans out)

```
Phase 0  Opus: parse KPI snapshot + bindings; plan the run
Phase 1  Sonnet fan-out (parallel):
         · per class-1 KPI: codebase research → author/verify measure_config
           (command + parse recipe), test-run it, capture value + evidence
         · per class-2 KPI: map to Character × journey; run L1 theoretical
           walks (mass-parallel); if :17320 healthy and --l2, queue serial
           live walks (drive → wait-for-settle → capture, per /uat)
         · per class-3 KPI: web research → benchmark ranges w/ citations
Phase 2  Opus: synthesize result.json + report.md; adversarial evidence pass;
         confidence per value; findings for anything structural
         (unmeasurable KPI, missing journey, target wildly off benchmarks)
Phase 3  session ends → app ingests (D below)
```

Cost/time: ~15–30 Sonnet calls + Opus session ≈ minutes-to-tens-of-minutes,
single-digit dollars per project. A **deliberate periodic operation** like
`/uat` — never a per-commit gate. Cadence can later ride autopilot's *Measure*
tier for class-1 procedures only (those are free after adoption).

### D. Dispatch + ingestion (the app side)

- **Dispatch**: a "Simulate" action on the KPI surface (dashboard header next
  to Autopilot, and/or the Factory KPI console) → `dispatchRowToFleet`
  (`kpi-sim:<project>` key, cwd = repo root, prompt = skill invocation + KPI
  snapshot JSON). Live terminal via the existing `PassportTerminalModal`
  pattern; dedup refuses a double-spawn.
- **Ingestion**: `dev_tools_ingest_kpi_simulation(project_id, run_path)` —
  validates `kpi-sim/runs/<id>/result.json` against a strict schema, then
  writes: class-2 sim measurement rows (no roll-forward), class-1/-3 proposals
  into the existing queue, findings into `dev_ideas`. Trigger: the fleet
  session's terminal event (the `factory-process-complete` bridge already
  exists) with a manual "Import results" fallback. Caps mirror the scan's
  (≤8 proposals; refuse ingest while ≥10 pending).

### result.json (sketch)

```json
{
  "sim_run_id": "2026-07-23-personas",
  "measurements": [{ "kpi_id": "…", "value": 0.8, "env": "test",
    "confidence": 0.6, "evidence": { "characters": 15, "completed": 12,
    "journals": ["runs/…/maria--onboarding.md"] } }],
  "proposals": [{ "kind": "adopt_measure_config" | "adjust_target" | "new_kpi" | "retire",
    "kpi_id": "…", "payload": { }, "rationale": "…", "citations": ["…"] }],
  "findings": [{ "origin": "kpi_sim", "title": "…", "evidence": { } }]
}
```

## Phasing

| Phase | Scope | Exit test |
|---|---|---|
| **P0** | Schema axis (`env` + `'simulation'` source, no roll-forward write path) + dashed sim series on the trend chart + env chip in the drawer | A hand-inserted sim row renders dashed, never moves `current_value`, never triggers derivation |
| **P1** | Skill engine + overlay + result schema; manual Fleet dispatch from the KPI dashboard; manual import | One real project: class-1 procedures authored + adopted; class-2 L1 sim lands as dashed series; class-3 target adjustment appears in the proposals queue with citations |
| **P2** | Auto-ingest on terminal event; findings emitter (`origin: kpi_sim`); accepted-limits loop | Dispatch → walk away → measurements + proposals appear; rejected proposals never re-proposed |
| **P3** | Cadence: adopted class-1 recipes ride autopilot Measure (no LLM); `predict` refresh on demand; per-env trend comparison (sim `test` line vs real `production` line converging = the prediction was good) | The sim-vs-real gap is visible per KPI and shrinks release over release |

## Decisions (2026-07-23, execution round)

1. **UI — environment switcher in the KPI module.** The dashboard gains an
   `Environment: Production | Test | Local` chip row driving the Trend chart's
   observation channel. Simulated series render **dashed** with a
   "· simulated" legend suffix; a standing caption states the honesty rule
   ("Simulated by the LLM engine — advisory only; pace, status and autopilot
   always read production"). The detail drawer chips every non-production
   measurement with its env + a "Simulated · LLM engine" source label; the
   story chart stays production-only. Stat cards / signal board / pace math
   are untouched (they read `current_value`, which sims never move).
2. **Skill distribution — run FROM Personas into managed repos.** Most repos
   have never seen `/uat`; requiring adoption would kill the operation's reach.
   The engine therefore lives in the DISPATCH PROMPT
   (`sub_kpis/kpiSimPrompt.ts`, self-contained doctrine + result contract);
   the session is skill-AWARE (uses a repo's `.claude/skills/kpi-sim` or
   `uat/` overlay when present) but never skill-dependent. The Personas-side
   `.claude/skills/kpi-sim` is the canonical reference + hand-run variant;
   per-repo adoption stays an optional later optimization via the passport
   Skills module.
3. **Per-env observations only** (measurement axis). Per-env *targets* —
   the door to A/B-style target experiments — deferred until the observation
   layer proves out.
4. **L1 + L2 both designed in from the start.** The dispatch offers
   `Static (L1)` and `Static + live (L1+L2)`; the first live comparison runs
   (Claude Code CLI as the engine) will judge whether L2 meaningfully improves
   result quality over L1 alone — the open question the P3 convergence view
   later answers continuously.

## First L1-vs-L2 comparison (2026-07-23, ai-paralegal, Claude Code CLI engine)

Two live runs over the same 5 managed KPIs (`kpi-sim/runs/2026-07-23-1119` L1;
`…-1401` L1+L2), both dispatched from the dashboard/Fleet path:

| | L1 (static) | L1+L2 (live) |
|---|---|---|
| Wall-clock | ~17 min | ~30 min (12 live gens ≈ 14 min) |
| Measurements | 2 (class-1 commands) | 3 (+ the class-2 bounce-rate 0/9, env `test`, conf 0.5) |
| Refusals | 3 KPIs honestly unmeasured | same 3-way honesty held |
| Unique findings | dead-enum KPI, parse zero-blind-spot, unmeasurable trio, zero-citation trust gap, benchmark-calibrated target | everything L1 found (coverage byte-identical — deterministic) **plus** the class L1 is structurally blind to |

**What L2 uniquely bought:** (1) the measurement L1 *refused* to fake — it drove
the app's real demand-draft LLM call 12× through the repo's own eval-gate
harness (it correctly chose the documented harness over standing up
Playwright) and judged real output against the reused uat Characters' bars;
(2) a genuinely new defect no static pass could see — 6/9 raw drafts carry
reviewer-visible preamble/"Notes for attorney review" trailers that every hard
gate misses and the critique pass doesn't strip (clean in PDF, rendered on
screen/copy/docx); (3) an evidence-backed *positive* verdict (senior-grade
substance, real citations, prompt-injection resisted) that L1 could only
hypothesize; (4) live-web benchmark validation (Princeton CITP 6.57 % floor →
the 5 % target is aggressive-but-credible).

**Verdict:** L1 is the right default cadence — cheap, catches structural and
measurability gaps, never fabricates. L2 is not "better L1" but a different
instrument: it measures *actual output quality of the AI surfaces*, the one
thing this product category lives on. Run L1 routinely, L2 deliberately (per
release, or whenever class-2 KPIs carry the decision). Caveat: L2 was cheap
here *because the repo ships an eval harness* — repos without one degrade to
L1 + a "no live-simulation path" finding, per doctrine.

**Fixed from live testing:** idle-parked sessions (auto-ingest on idle, honest
"finished" label, Re-run reclaims the dispatch key) and duplicate proposals on
re-runs (snapshot now carries `proposed` KPIs as never-re-propose context;
ingest dedupes new-KPI names against all statuses).

## Open questions

1. **Where does class-2 L2 (live harness) run?** The app instance is a
   singleton — a sim run driving `:17320` collides with a user (or another
   session) using the app. Default `--l1-only`; L2 behind an explicit flag +
   ledger coordination, exactly like `/uat`.
2. **Env on the KPI definition or the measurement?** This design: measurement
   only (a KPI is one outcome; envs are observation channels). Revisit if a
   per-env *target* ever makes sense (e.g. latency budget local vs prod).
3. **Prediction accountability.** P3's sim-vs-real convergence view is the
   honest scorecard for class 3 — do we also want a stored "prediction ledger"
   (predicted range vs what production later measured) to grade the operation
   itself? Cheap to add on top of the measurement series; deferred.
4. **Snapshot transport.** Prompt-embedded KPI snapshot vs a written
   `kpi-sim/snapshot.json` before spawn — start with the file (no prompt-size
   risk, diffable), it's one extra write in the dispatch handler.
