# KPIs — the outcome layer above Goals

> Design + roadmap: [`docs/plans/kpi-driven-orchestration.md`](../../plans/kpi-driven-orchestration.md).
> Status: P0–P2 shipped (schema, proposal scan, Teams UI). P3 evaluation runner,
> P4 autonomous goal derivation, P5 certification §10 — upcoming.

KPIs define **what success means** for a project (or one of its context-map
groups) so the autonomous goal loop can be steered by *outcomes* instead of
activity. Each KPI carries a stored **measurement procedure**, a baseline →
target ("volume") with an optional milestone date, a cadence, and a
measurement time series. Goals derived from off-track KPIs (P4) link back via
`dev_goals.kpi_id` — and a derived goal completing does **not** mean success;
the *next measurement* decides.

## Where it lives

**Teams › KPIs** (`src/features/teams/sub_kpis/`, sidebar item with a
proposals badge). Two views behind a segmented switch:

- **Dashboard** — active KPIs as cards: current vs target, direction, pace
  (on-track / off-track / met / unmeasured, computed by `kpiMath.ts` — the
  same pace rule the P4 derivation and §10 cert use), measurement freshness,
  and a progress bar. Click opens the **detail drawer** (measurement history +
  sparkline, manual value entry, pause/resume, archive). The drawer also carries
  a **"What the system is doing"** panel (`KpiSteeringPanel`): the in-flight
  derived goal (status, progress, advancing team, ETA) plus the **outcome
  trace** of shipped goals — the KPI's measured delta around each goal's
  completion, drawn as the honesty rule it embodies: a shipped goal with no
  measurement after it reads *"awaiting the next measurement"*, and one that
  re-measured shows whether the line actually moved (improved / slipped / no
  change). Reusable, so the Factory console adopts the same panel.
- **Proposals** — the review queue the KPI scan fills. Each proposal shows the
  scan's one-line rationale + the exact measurement procedure; the user
  **accepts** (optionally adjusting target value/date first), or **rejects**
  (archived — fed back to future scans as a negative example).

KPIs that need a connector that isn't in the vault yet arrive parked as
`manual` with `needed_connector` set; their cards carry a **"Connect
<service>"** CTA that deep-links into the credential catalog. The connector
catalog is extendable (see `/add-credential`) as KPI use cases demand new
analytics/traffic services.

### The Factory (next-gen cockpit)

A sibling surface (`src/features/teams/sub_factory/`) explores the KPI cockpit
as a drill-down — projects → context×KPI matrix → KPI **console** — over the
same live `dev_kpis` data. Two cockpit moves land here first:

- **Attention-first band** (`AttentionBand`) at the entry: off-track (red) KPIs
  across *all* projects as chips that deep-link straight into a KPI's console,
  plus an at-risk count — so the entry answers "what needs me?" before the
  structural drill-down.
- **Calibration consequence preview** (`KpiConsole`): as the user drags the
  warn/red threshold sliders, a live line reads the calibrated status and says
  what the system does to *this* KPI at those lines right now ("past your red
  line — the system derives a goal to fix this now" / "clear of both lines —
  nothing triggers"), so the lever is legible instead of abstract.
- **Proposal on-ramp** (`KpiProposalsPanel`, in the project view): "Scan for
  KPIs" runs the proposal scan and the review queue accepts (with an inline
  *Adjust* for target/cadence) / rejects each proposed KPI, wired to the live
  commands — so the cockpit can bootstrap its own KPIs without leaving for the
  Teams › KPIs queue. Accepting reloads the matrix; the matrix itself now shows
  only **managed** (active/paused) KPIs, so proposals don't masquerade as live.

- **Cover roadmap → Ship (L1 shortcut)** (`CoverRoadmap`, on every passport
  cover in the wall's Overview grid): a minimized roadmap strip — one pip per
  `dev_milestones` row (filled = shipped, ringed = the active cut, hollow =
  planned), a `shipped/total` tally, and a line naming the **next milestone**
  with its target date. Clicking the strip opens that project's L2 directly on
  the **Ship** tab instead of the default Overview, so the roadmap is one click
  from the wall. Projects with no milestones show a blue setup invitation
  ("plan the first cut") and still open Ship. The strip only reads milestone
  rows; every derivation (progress, exit criteria, footprint) stays in the Ship
  tab's `useShipData`.
  The tile's old footer digest is gone: the **blockers badge** (warning glyph +
  count, full list in the tooltip; a green check when there are none) was
  promoted onto the cover's identity line next to the project name, so it rides
  along wherever a cover renders — grid tile, Compare column, Mastermind
  sidebar. The wall's View / Sort control groups and the L2 Module tab row are
  labelled by a glyph rather than a word (the word survives as the tablist's
  accessible name and the glyph's tooltip).
- **Action consent gate** (`ActionConfirmModal` + `actionConfirmCatalog`): the
  five per-project actions on the Compare table's actions row (Onboard ·
  Standards scan · Copy report · Rescan · Improve plan) each open a full modal
  before running, not a one-paragraph popover. It states the action's **impact
  class** (read-only / writes when you confirm / runs an agent session), a fact
  strip (scope, engine, duration, what it writes, where it runs), the **ordered
  steps** the click sets off, and the **boundaries** that hold regardless
  (credential values never leave the vault, queued Claude tasks wait for
  review, read-only passes never touch the repo). The copy lives in
  `actionConfirmCatalog.ts` next to the flows it describes — change a flow,
  change its steps in the same edit.

The Factory renders every enum (category, measurement kind, cadence, tier,
status, domain) through human labels — **no raw tokens** (`codebase`, `weekly`,
`supporting`) reach the user, and no raw measurement JSON is shown (it's parsed
into prose / configured via `MeasureSetupModal`). Full **i18n** of the surface
(it is still English-only) remains a follow-up.

- **Add-KPI modal** (`AddKpiModal`): a structured authoring surface (no free-text
  "describe → AI fills the form" — that conversational path is pointed at Athena's
  chat). A wide 3-column layout with theme-toned labels and themed dropdowns
  (`ThemedSelect`). A **Measured** control branches the flow: **Manually** (all
  fields required → creates the KPI active immediately, no LLM) vs
  **Automatically** (pick the mechanism — codebase / a vault **Connector** /
  a derived **Metric**; "Set up with AI" calls `dev_tools_propose_kpi_auto`,
  which creates a *proposed* KPI and, for the codebase mechanism, runs a
  **truly-background** compose that applies the tested measurement + baseline on
  its own — so the modal closes immediately and the proposal lands in Teams ›
  KPIs to review/adjust). Connector KPIs carry `needed_connector` and are
  verified at bind time (the Connect flow); derived KPIs carry the chosen metric.
  State + actions live in `useAddKpi`; the modal is a thin shell.
- **Honest "over to you" state** (the KPI console): when the derivation looked
  at an off-track KPI and judged that **no team work would move it** (it answers
  `skip` — needs humans / marketing / an external dependency), the console says
  so plainly with the reason, instead of leaving the off-track KPI silently
  unaddressed. The verdict is also **remembered** (`dev_kpis.last_skip_at` /
  `last_skip_rationale`): the derivation loop won't re-spend an LLM call on the
  same un-actionable KPI every tick — the skip stands until the KPI is
  re-measured, at which point the loop may try again.

## The proposal scan

"Scan for KPIs" (`dev_tools_scan_kpis`) runs a headless Claude pass that
consumes the project's **context map**, its existing KPIs (active = duplicate
guard; archived = user-rejected, never re-proposed), and the vault connector
roster — then explores the repo itself to ground baselines (it runs the
project's coverage/lint where cheap). Proposals land as `status='proposed'`
rows. Guards: ≤8 proposals per scan; a scan is refused while ≥10 proposals
already await review. Categories: `technical`, `quality`, `traffic`, `value`;
measurement kinds: `codebase` (run a repo command + parse), `derived`
(orchestrator-DB metrics), `connector`, `manual`.

## Calibration & the off-track lever

A KPI is **off-track** — the condition that derives a goal — by any of three
direction-aware tests, in priority order (the single source of truth is
`kpiMath.ts::kpiTrack`, ported exactly in `engine/kpi_derivation.rs::kpi_is_off_track`;
keep the two in sync):

1. **Floor breach** — a business metric (traffic/value, higher-is-better) at or
   below zero. "0 users beats 100% coverage": its derivation reframes from
   *improve* to *establish the first unit of value*.
2. **Critical line crossed** — the user's calibrated `crit_at`. This is the
   Factory console's **red lever made real**: the threshold the user drags is
   the same fact this steering loop obeys. Until calibrated, `crit_at` is NULL
   and the verdict falls through to pace. `warn_at` ("yellow") is deliberately
   **not** a derivation trigger — it is the softer watch / nudge band.
3. **Pace lag** — with a `target_date` + baseline, `current` lags the linearly
   paced expectation by more than the tolerance (default 10% of the span).

A met target wins over every threshold/pace verdict. `kpiOffTrackReason()`
exposes *which* of the three fired, so the UI can show the cause (and a goal's
KPI cross-reference can explain why it exists).

## Autopilot (per-project)

The KPI cockpit owns **one switch per project** instead of a dozen global
`autonomous_*` setting keys (`AutopilotControl` in `sub_kpis/`, backed by
`engine/autopilot.rs`). Four levels, each strictly additive:

| Mode | What runs automatically |
|---|---|
| **Off** | Nothing. |
| **Measure** | KPI evaluation on cadence (`KpiEvaluationSubscription`). |
| **Suggest** | Measure **+** derive a goal when a KPI goes off-track (`KpiGoalDerivationSubscription`) — goals are created but left for you to hand off. |
| **Full** | Suggest **+** auto-advance those goals through the team (`GoalAdvanceSubscription`). |

Stored as an `app_settings` row (`autopilot_mode:<project_id>`). The mode is
**authoritative for that project and overrides the global flag in both
directions** — a project can run on Full while the global flag is off, or sit
Off while it's on. A project with **no** explicit mode falls back to the legacy
global flags, so existing setups are unchanged. The discovery loop (idea scan /
backlog triage / Athena reactions) still rides its global flags today and folds
into Suggest/Full in a follow-up.

## AI-composed measurements were never landing (fixed 2026-08)

`apply_composed_measure` recorded its reading with `source = 'ai-compose'` — a
value the `dev_kpi_measurements.source` CHECK **never allowed**
(`evaluator | manual | scan | health_snapshot | simulation`). SQLite rejected
every insert and a `let _ =` swallowed the error, so **no AI-composed reading
had ever reached the series**, and neither had the Factory `MeasureSetupModal`'s,
which posts the same source through `dev_tools_record_kpi_measurement`.
Confirmed against a real database before the fix: `select source, count(*)`
returned `simulation` rows only.

`ai-compose` is now a sixth allowed source, and writes go through a governed
door — `record_kpi_compose_measurement`, mirroring
`record_kpi_simulation_measurement` — which **requires evidence** and writes
`env` explicitly as `production` rather than inheriting the column default. The
evidence JSON is byte-shape-identical to the evaluator's
`{cmd, parse, output_tail}`, so `summarizeEvidence` needs no special case and an
AI-composed reading now carries the same provenance line every other measured
value does. Unlike the simulation door, it rolls `current_value` /
`last_measured_at` forward, because the command really did run.

Recording failures now `tracing::warn!` instead of vanishing.

Also corrected in the same pass: the `kpi_compose` module header claimed
"neither compose command writes to the DB". True of the manual flow, false of
`launch_compose_apply` / `propose_kpi_auto_inner` — the path
`dev_tools_propose_kpi_auto` and **Athena's `propose_kpi` op** reach, which
writes `measure_config` plus a first value with no human confirmation gate,
before the KPI has left `status='proposed'`. The header now says so. The
autonomy contract itself is unchanged.

## When a KPI goes dark (2026-08)

Goal derivation is gated on freshness: `find_derivation_candidates` only derives
from a KPI measured within **2× its cadence** (daily → 2 days, everything else →
14 days). Past that window derivation for that KPI simply stops — and until
2026-08 nothing said so. A measurement path that broke (a `codebase` command
that started failing, a connector binding that rotted) read to the user as
"this KPI just isn't generating work any more".

The existing `attention_queue` now carries two kinds — no new panel, no new
command:

| kind | rank | means |
| --- | --- | --- |
| `kpi_gone_dark` | 7 | was being measured, has aged past its own window |
| `kpi_never_measured` | 8 | active and older than its window, never measured once |

`entity_kind` is `kpi`. The row's detail states the *consequence* — that goal
derivation has stopped for it — rather than just the age. The window mirrors the
derivation gate's own `CASE k.cadence`, with cross-pointers in both files,
because a daily KPI and a quarterly KPI must not share one threshold.

Deliberately excluded so the signal stays worth reading: anything not
`status='active'` (paused and archived KPIs are silent on purpose, and proposed
ones haven't started), a KPI younger than its own window, and **projects with no
team** — the same join derivation makes, since a team-less project never derived
anything and the claim would be false. Unparseable timestamps are logged and
skipped, never rendered as age 0.

## Environments & simulation (the LLM-engine channel)

Measurements carry an **environment** (`local` / `test` / `production` — the
same vocabulary as the Factory passport's env split). Production is the
authoritative channel: pace, off-track status, goal derivation and autopilot
read **only** real telemetry (`current_value` rolls forward from
evaluator/manual/connector measurements alone). The other two channels hold
the **KPI simulation** — a long Dev-runner operation
(`docs/plans/kpi-simulation-skill.md`) dispatched from the dashboard's
**Simulate KPIs** button: a Fleet Claude Code session in the managed repo that

- **measures locally** what a repo command can honestly measure (class 1 —
  authored `measure_config` procedures arrive as adopt-proposals),
- **simulates user behavior** with UAT-style Characters walking KPI-bound
  journeys — `Static (L1)` over the code, or `Static + live (L1+L2)` driving
  the running app where a driver exists (class 2 — lands as `simulation`
  measurements, env-tagged, dashed on the chart),
- **predicts real-world targets** from web benchmarks (class 3 — never a
  measurement; lands as adjust/new/retire proposals with citations in the
  existing review queue, or as `kpi_sim` findings in the triage spine).

The dashboard's **Environment switcher** flips the Trend chart between
channels; simulated series render dashed with a "· simulated" legend suffix
and a standing caption naming the honesty rule. The detail drawer chips every
non-production measurement (env + "Simulated · LLM engine"). Results are
auto-ingested when the session settles (`dev_tools_kpi_sim_ingest` — validates
evidence, refuses production-claiming sims, caps + name-dedupes proposals)
with a manual **Import results** fallback.

Beyond the full simulate run, two lighter operations share the dashboard:
**Refresh predictions** (`predict` mode) is a research-only pass — it re-aims
targets from current web benchmarks and emits proposals with citations,
producing **no measurement** (it never touches the trend). And the
**Simulation suggestions** panel surfaces the sim's actionable proposals
(`adopt_measure_config` / `adjust_target` / `retire`) next to the KPIs they
change: one-click **Apply** moves a target, archives a KPI, or adopts a
local measurement recipe — the last flips a `manual` KPI to a `codebase`
measure on a weekly cadence, so it then rides the autopilot **Measure** tier
for free (no LLM) on every cycle. Applying resolves the underlying finding;
Dismiss rejects it durably.

The detail modal's story chart carries the **convergence view** (P3): the
production channel stays the solid truth line, the sim channel overlays dashed
(hollow dots), and a readout names the latest gap in KPI units and as a share
of the target span, with a verdict across successive sim runs
(converging / diverging / stable / needs-more-runs, `kpiConvergence.ts`). A
production reading older than the sim is flagged stale with a "use Measure now
to confirm" nudge rather than treated as current truth — the sim may simply be
fresher.

## Athena can manage KPIs

The companion sees each project's active KPIs in her prompt and can steer this
layer on the user's behalf — all **approval-gated**: `calibrate_kpi` (adjust
target / date / tier / cadence / status, or draw the warn/critical lines),
`evaluate_kpi` (measure now), and `scan_kpis` (propose new KPIs). Recalibrating
`crit_at` is how she changes *when* a KPI derives a goal. Full reference:
[companion → Project KPIs](../companion/README.md).

## Data model

`dev_kpis` (definition + live state + review lifecycle
`proposed → active → paused/archived`) and `dev_kpi_measurements` (value,
source, evidence; recording rolls `current_value`/`last_measured_at` forward
atomically).

**Scope**, narrowest first: `use_case_id` (a behavioral slice through several
contexts) → `context_id` (one context) → `context_group_id` (one group) →
all NULL (project-level). The use-case tier is the honest owner of an outcome
that spans contexts, and it is what goal derivation reads to constrain the
candidate contexts it offers. See
[`plugins/dev tools/context-design.md`](../plugins/dev%20tools/context-design.md) §8.

> A full context re-scan recreates `dev_contexts` rows under new ids. The scan
> snapshots and reconciles `dev_kpis.context_id` by context name, so a
> context-scoped KPI keeps its scope across a rebuild (before this, it was
> silently `SET NULL`ed).
