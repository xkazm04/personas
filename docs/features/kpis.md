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
  sparkline, manual value entry, pause/resume, archive).
- **Proposals** — the review queue the KPI scan fills. Each proposal shows the
  scan's one-line rationale + the exact measurement procedure; the user
  **accepts** (optionally adjusting target value/date first), or **rejects**
  (archived — fed back to future scans as a negative example).

KPIs that need a connector that isn't in the vault yet arrive parked as
`manual` with `needed_connector` set; their cards carry a **"Connect
<service>"** CTA that deep-links into the credential catalog. The connector
catalog is extendable (see `/add-credential`) as KPI use cases demand new
analytics/traffic services.

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

## Data model

`dev_kpis` (definition + live state + review lifecycle
`proposed → active → paused/archived`) and `dev_kpi_measurements` (value,
source, evidence; recording rolls `current_value`/`last_measured_at` forward
atomically). Group-level KPIs attach to `dev_context_groups`; project-level
KPIs have `context_group_id = NULL`.
