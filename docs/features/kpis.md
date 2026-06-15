# KPIs — the outcome layer above Goals

> Design + roadmap: [`docs/plans/kpi-driven-orchestration.md`](../plans/kpi-driven-orchestration.md).
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

## Athena can manage KPIs

The companion sees each project's active KPIs in her prompt and can steer this
layer on the user's behalf — all **approval-gated**: `calibrate_kpi` (adjust
target / date / tier / cadence / status, or draw the warn/critical lines),
`evaluate_kpi` (measure now), and `scan_kpis` (propose new KPIs). Recalibrating
`crit_at` is how she changes *when* a KPI derives a goal. Full reference:
[companion → Project KPIs](companion/README.md).

## Data model

`dev_kpis` (definition + live state + review lifecycle
`proposed → active → paused/archived`) and `dev_kpi_measurements` (value,
source, evidence; recording rolls `current_value`/`last_measured_at` forward
atomically). Group-level KPIs attach to `dev_context_groups`; project-level
KPIs have `context_group_id = NULL`.
