# KPI-Driven Orchestration — the missing top layer

> Status: DESIGN (2026-06-10). Author: cert-campaign session w/ user direction.
> Parent systems: Goals ([`docs/features/goals/README.md`](../features/goals/README.md)),
> Context Map (`src/features/plugins/dev-tools/sub_context/`), Director
> ([`docs/features/director/`](../features/director/)), Athena companion,
> autonomy-eval certification ([`docs/tests/autonomy-eval/`](../tests/autonomy-eval/)).

## 1. The problem — the loop has no definition of success

Today's autonomous stack is a complete *execution* hierarchy with no *outcome* layer:

```
                       ┌──────────────────────────────────┐
   MISSING             │  KPIs — what success MEANS        │
                       │  per project / context group      │
                       └────────────┬─────────────────────┘
                                    │ derives goals when off-track
   HAVE  ┌──────────────────────────▼─────────────────────┐
         │  Goals (board/map/timeline, deps, checklists)   │
         │  ← BacklogToGoal promotes ideas                 │
         └──────────────────────────┬─────────────────────┘
   HAVE                             │ GoalAdvance → assignments
         ┌──────────────────────────▼─────────────────────┐
         │  Teams → assignments → steps → executions → PRs │
         └──────────────────────────┬─────────────────────┘
   MISSING                          │ ...did any of it move the needle?
         ┌──────────────────────────▼─────────────────────┐
         │  KPI evaluation — periodic measurement          │
         └────────────────────────────────────────────────┘
```

The self-sustaining cycle (scan → ideas → goals → PRs → repeat) optimizes for
*activity*, not *outcomes*. Ideas are promoted by strategist ranking — a proxy
for value, not a measurement of it. Nothing tells the loop "coverage in the
billing group fell below 60%" or "signup conversion didn't move after the last
three shipped goals." KPIs close that gap and give the human a steering wheel
that operates at the level they actually think at.

## 2. What already exists to build on (discovered, not assumed)

| Asset | Where | Reuse |
|---|---|---|
| **Context groups** with reserved `health_score` column + `last_scan_at` | `dev_context_groups` | KPI home: group-level KPIs attach here |
| **`context_health_snapshots`** time-series table (overall/security/quality/coverage/debt scores, issues_json, scanned_at) + `dev_tools_save_health_snapshot` command **with no UI caller** | `db/repos/dev_tools.rs:3159`, `commands/.../dev_tools.rs:1438` | Orphaned plumbing — absorb as the *technical-category* measurement feed |
| **LLM scan pipeline** w/ protocol messages, delta mode, cancel/status, event streaming | `commands/infrastructure/context_generation.rs` | Clone shape for the KPI proposal scan |
| **Periodic op machinery** (`system_op_automation`, cron `0 3 * * 1`, event-bus lifecycle events) | `engine/system_ops.rs` | KPI scan + evaluation cadence |
| **Goals CRUD + signals + deps + items** + autonomous loop (Advance / BacklogToGoal / Replenish) | `engine/subscription.rs:1337/1931/2091`, `goal_advance.rs` | Derivation mirrors BacklogToGoal; derived goals ride the existing advance loop unchanged |
| **Teams submodule pattern** (sub_goals: page + views + sidebar `GOAL_VIEWS` + systemStore slice) | `TeamsSidebarNav.tsx`, `src/features/teams/sub_goals/` | sub_kpis mirrors it 1:1 |
| **Director analytics primitives** (StatCard, ScoreSparkline, momentum/trend helpers, PeriodSelect) | `src/features/overview/sub_director/`, `shared/components/display/StatCard.tsx` | The KPI dashboard is these primitives over a new query |
| **Headless CLI decision pattern** (prompt → protocol JSON → apply) | `idea_scanner.rs`, `athena_reaction.rs` | KPI goal-derivation decision + connector measurements |
| **Cert harness** §0–§9 + loop-certify + gather bundles | `scripts/test/` | §10 KPI-management dimension |

## 3. Data model

### `dev_kpis` — the definition (one row = one KPI)

```sql
CREATE TABLE dev_kpis (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
  context_group_id TEXT REFERENCES dev_context_groups(id) ON DELETE SET NULL, -- NULL = project-level
  name             TEXT NOT NULL,
  description      TEXT,
  category         TEXT NOT NULL CHECK(category IN ('technical','traffic','value','quality')),
  -- the "given procedure how to measure" --------------------------------
  measure_kind     TEXT NOT NULL CHECK(measure_kind IN ('codebase','connector','manual','derived')),
  measure_config   TEXT NOT NULL,            -- JSON, shape per kind (see §5)
  unit             TEXT NOT NULL DEFAULT '', -- '%', 'count', 'ms', '$', 'users', ...
  direction        TEXT NOT NULL DEFAULT 'up' CHECK(direction IN ('up','down')),
  -- targets ("volume" the user can adjust) ------------------------------
  baseline_value   REAL,
  target_value     REAL,
  target_date      TEXT,                     -- the milestone
  -- live state -----------------------------------------------------------
  current_value    REAL,
  last_measured_at TEXT,
  cadence          TEXT NOT NULL DEFAULT 'manual' CHECK(cadence IN ('manual','daily','weekly')),
  status           TEXT NOT NULL DEFAULT 'proposed'
                   CHECK(status IN ('proposed','active','paused','archived')),
  created_by       TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user','scan')),
  rationale        TEXT,                     -- scan's why-this-KPI (shown in review queue)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `dev_kpi_measurements` — the time series

```sql
CREATE TABLE dev_kpi_measurements (
  id          TEXT PRIMARY KEY,
  kpi_id      TEXT NOT NULL REFERENCES dev_kpis(id) ON DELETE CASCADE,
  value       REAL NOT NULL,
  measured_at TEXT NOT NULL DEFAULT (datetime('now')),
  source      TEXT NOT NULL CHECK(source IN ('evaluator','manual','scan','health_snapshot')),
  evidence    TEXT,   -- JSON: raw command output excerpt / connector payload / note
  note        TEXT
);
```

### Goal linkage

```sql
ALTER TABLE dev_goals ADD COLUMN kpi_id TEXT;  -- soft link, ALTER style like goal_id elsewhere
```

A **derived goal** carries `kpi_id` + a `dev_goal_signals` row (`signal_type='kpi_derivation'`).
When it completes, the *next measurement* — not the goal's own completion —
decides whether the KPI moved. Goal-done ≠ success; that honesty is the point.

### Status flow (the accept/reject/adjust loop)

```
scan proposes ──► proposed ──user accepts──► active ──► paused ⇄ active
                     │  └─user adjusts target/cadence then accepts┘
                     └─user rejects──► archived (kept for "don't re-propose" memory)
```

The KPI scan receives archived KPI names as negative examples (same trick as
the idea scan's rejected-titles feedback loop).

## 4. W1 — KPI proposal scan

A **separate scan op**, not a context-scan extension: the context scan already
has a 30-min budget and a different cognitive job. The KPI scan *consumes* the
finished context map as input.

- Command `dev_tools_scan_kpis(project_id)` cloning the `context_generation.rs`
  pipeline shape (background task + status/cancel + event streaming + protocol
  parse). New op_kind `kpi_scan` in `system_op_automation` for the periodic
  variant ("Plan weekly KPI review" button, mirroring `planWeeklyContextScan`).
- **Prompt inputs**: context groups (+descriptions, tech stack, file counts),
  existing active/archived KPIs (don't duplicate / don't re-propose rejected),
  project's team + its connector roster (only propose what is *measurable* —
  a traffic KPI is only proposed if an analytics-ish connector exists or the
  repo embeds one), repo manifest (test runner present → coverage KPI, etc.),
  team shared-ledger digest.
- **Protocol** (one line per proposal):
  ```json
  {"kpi_proposal": {"project_id": "...", "group_name": "Billing", "name": "Statement test coverage",
    "category": "technical", "measure_kind": "codebase", "measure_config": {"cmd": "npx vitest run --coverage", "parse": "coverage_pct", "scope": "src/features/billing"},
    "unit": "%", "direction": "up", "baseline_hint": 42, "suggested_target": 70,
    "cadence": "weekly", "rationale": "Billing has 0 integration tests but handles money paths"}}
  ```
  Parser validates group_name against the live map (hallucinated groups →
  project-level), inserts `status='proposed', created_by='scan'`.
- Categories steer per group_type: technical (coverage, lint debt, build time,
  bundle size, error rate), traffic (signups, DAU, API calls — connector-gated),
  value (conversion, revenue events, support-ticket rate), quality (bounce rate
  of QA loop, incident rate — measurable from our own DB, `measure_kind='derived'`).

## 5. W4 — KPI evaluation layer (measurement runner)

`run_kpi_evaluation(project_id, kpi_id?)` — measure all *due* active KPIs
(cadence-elapsed or explicit). **Manual trigger first** (per-KPI "Measure now"
button + "Evaluate all due"), subscription later. Per `measure_kind`:

| Kind | v1 mechanics | Source of truth |
|---|---|---|
| `codebase` | Run `measure_config.cmd` in the project root (same harness style as the cert's `runRepoChecks`: bounded timeout, exit-code honest), parse via `parse` strategy (`coverage_pct`, `count_lines`, `regex:<pattern>`, `json_path:<ptr>`) | repo |
| `derived` | SQL over our own DB from a whitelisted catalog (qa bounce rate, incident rate, parked-review age, exec failure rate — several §9 metrics become per-project KPIs for free) | personas.db |
| `connector` | A **mini headless execution** with the team's resolved credential + the measurement instruction; output protocol `{"kpi_measurement": {"kpi_id":"...","value":123,"evidence":"..."}}` parsed by dispatch (one new ProtocolMessage variant). Reuses credential resolution + CLI + parser wholesale — no new API-client surface | external API |
| `manual` | UI prompts the user for the value (drawer input), `source='manual'` | human |

Every run: insert measurement → update `current_value`/`last_measured_at` →
`dev_goal_signals` (`kpi_measured`) on linked open goals → **`context_health_snapshots`
absorbed**: technical-category group KPIs also write the matching snapshot
columns, finally giving the orphaned table + reserved `health_score` a writer.

**Off-track math** (shared helper, used by W3 + dashboard + cert):
expected pace `= baseline + (target − baseline) × elapsed/total_window`;
off-track when `current` lags expected by > tolerance (default 10% of the
span, user-adjustable per KPI) in the KPI's `direction`. No target_date →
off-track = simply `current` on the wrong side of `target`.

## 6. W3 — KPI → Goal derivation (the wiring extension)

`KpiGoalDerivationSubscription` (default-OFF setting
`autonomous_kpi_goal_derivation`), mirroring `BacklogToGoalSubscription`:

- **Candidates**: active KPIs that are off-track AND have a fresh-enough
  measurement (never derive from stale data: `last_measured_at` within 2×
  cadence) AND no open goal already carrying this `kpi_id` AND not in
  post-completion cooldown (after a derived goal finishes, wait for the **next
  measurement** before deriving again — prevents goal-spam while the needle is
  still settling).
- **Derivation = headless CLI decision** (idea-scanner pattern): prompt carries
  the KPI definition + measurement history + its context group's map slice +
  the team's recent shipped goals + ledger. Output:
  `{"kpi_goal": {"title","description","context_id","target_date","rationale"}}`.
  May also answer `{"kpi_goal": {"skip": true, "rationale"}}` — a measured
  "nothing actionable" is a legitimate outcome (restraint, same doctrine as
  Athena's react:false).
- Creates `dev_goals` row with `kpi_id` + provenance footer in the description
  ("Derived from KPI 'X': current 42%, target 70% by Jul 15 — off-track by
  18pts") + `kpi_derivation` signal. **The existing GoalAdvance loop takes it
  from there unchanged** — teams don't know KPIs exist; they see goals.
- Caps: 1 derived goal per KPI open at a time; ≤2 derivations/tick fleet-wide;
  quota-cooldown gated; backlog backpressure unaffected (derived goals bypass
  the idea funnel by design — they're the *steering* channel).
- **Athena hook**: a `kpi_off_track` signal joins her reaction-worthy moments
  (display-post: "Billing coverage slipped to 38%, derived goal X is queued") —
  detection-only addition to `athena_reaction.rs`, her restraint rules apply.

## 7. W2 — UI: `sub_kpis` Teams submodule

Mirrors `sub_goals` exactly (directory, sidebar, store):

- `src/features/teams/sub_kpis/`:
  - **`KPIDashboard.tsx`** — default view. Per-group sections; each KPI a
    `StatCard` (current vs target, unit, direction arrow, off-track tint) +
    `ScoreSparkline`-style trend from measurements + milestone countdown +
    linked-goal chips (open derived goals). Header: project picker (reuse
    `LifecycleProjectPicker`), "Evaluate all due", "Scan for KPI proposals".
  - **`KPIProposalsQueue.tsx`** — review queue for `status='proposed'`:
    rationale + proposed measurement procedure visible; **Accept / Adjust
    (target value, date, cadence — the "volume") / Reject** per row; batch
    accept. Badge count on the sidebar item.
  - **`KPIDetailDrawer.tsx`** — measurement history chart, evidence per point,
    measure procedure (editable `measure_config`), Measure-now button, manual
    value entry (for `manual` kind), linked goals list, pause/archive.
- Sidebar: `TeamsTab` gains `'kpis'`; `KPI_VIEWS = [dashboard, proposals]`
  under an L1 "KPIs" header (Gauge icon), proposals badge = proposed count.
- Store: `kpiSlice` (or systemStore extension, matching goals): `kpis`,
  `kpiMeasurements` (lazy per-drawer), `fetchKpis(projectId)`, CRUD actions.
- API: `src/api/devTools/kpis.ts` wrapping the new commands; ts-rs bindings
  regenerated (`cargo test export_bindings`).

## 8. W5 — Certification extension (§10 KPI management)

Same discipline as §8/§9: **informational first, never a verdict cap** until
the dimension has live history.

- **Gather**: bundle gains `kpis.json` + `kpi_measurements.json` (window-scoped).
- **`loop-certify.mjs`** gains a `kpi` block:
  - *coverage*: goal-managed projects with ≥1 active KPI / all
  - *freshness*: measurements within cadence ÷ active KPIs (staleness %)
  - *derivation health*: off-track KPIs with an open derived goal ÷ off-track
    (the steering loop is actually steering)
  - *outcome trace* (report, no causality claim v1): for derived goals completed
    in-window, the KPI's delta from pre-goal to latest measurement
- **Rubric §10** documents the four signals + the honesty rule: a completed
  derived goal whose KPI did NOT move is *surfaced*, not punished — that
  surfacing is precisely the information the old loop couldn't produce.

## 9. Phased plan (commit-sized, each shippable)

| Phase | Scope | Touches | Acceptance |
|---|---|---|---|
| **P0 — Schema + plumbing** | `dev_kpis`, `dev_kpi_measurements`, `dev_goals.kpi_id`; models + ts-rs; repo CRUD; Tauri commands (list/create/update/archive/list_measurements/record_measurement); command-names regen | `db/migrations/incremental.rs`, `db/models/`, `db/repos/dev_tools.rs`, `commands/infrastructure/dev_tools.rs`, bindings | `cargo check` + bindings drift clean; CRUD via bridge |
| **P1 — Proposal scan** | `dev_tools_scan_kpis` (clone context-scan pipeline), `kpi_proposal` protocol, archived-KPI negative feedback, op_kind `kpi_scan` (manual button first; weekly automation behind the same plan-button pattern) | new `commands/infrastructure/kpi_scan.rs`, `system_ops.rs` | Live scan on one xprice project produces sane proposals across ≥2 categories |
| **P2 — UI submodule** | `sub_kpis` (Dashboard + Proposals + Drawer), sidebar registration, store slice, i18n keys | `features/teams/sub_kpis/`, `TeamsSidebarNav.tsx`, store, `en.json` | Accept/adjust/reject flow works; dashboard renders active KPIs; design-token + catalog rules respected |
| **P3 — Evaluation runner** | `run_kpi_evaluation` (codebase + derived + manual kinds), `kpi_measurement` protocol + dispatch variant for the connector kind (mini-execution), health-snapshot absorption, Measure-now UI | `engine/` or `commands/` kpi_eval module, `dispatch.rs`, drawer | Measure-now produces a time-series point with evidence; coverage KPI measured end-to-end on a real repo |
| **P4 — Derivation loop** | off-track helper, `KpiGoalDerivationSubscription` (default-OFF setting + array + validation), derivation CLI decision + caps/cooldowns, Athena `kpi_off_track` signal | `subscription.rs`, `settings_keys.rs`, `background.rs`, `athena_reaction.rs` | Seeded off-track KPI derives exactly one goal with provenance; GoalAdvance picks it up; no derivation while measurement stale |
| **P5 — Cert §10** | gather snapshot, loop-certify kpi block, rubric §10, feature docs + map entry | `scripts/test/`, `docs/tests/autonomy-eval/`, `docs/features/` | loop-certify renders the kpi block on live data; golden-safe for pre-KPI bundles |

Order rationale: the user sees value at P2 (visible KPI management); autonomy
(P4) deliberately comes *after* measurement (P3) exists — deriving goals from
unmeasured KPIs would reintroduce exactly the proxy-driven busywork this layer
is meant to replace. Every phase lands behind existing patterns (default-OFF
settings, informational cert dimensions) so no phase destabilizes the running
certification campaign.

## 10. Design decisions (made) + open questions (for the user)

**Decided (recommendation, change if you disagree):**
1. **Group-level + project-level KPIs in v1** (`context_group_id` nullable);
   per-context KPIs deferred — groups are the abstraction the user named, and
   context-level would explode the review queue.
2. **Separate KPI scan**, context map as input — not a context-scan extension.
3. **Single target + target_date per KPI** in v1; a `dev_kpi_milestones` table
   (multi-milestone roadmaps) is a clean later addition.
4. **Connector measurements ride a mini headless execution** with the team's
   credentials — zero new API-client surface, credentials stay local (hard
   rule), evidence captured from the execution output.
5. **Derived goals bypass the idea/backlog funnel** — KPIs are the steering
   channel, backlog is the discovery channel; mixing them would subject
   steering to backpressure caps designed for discovery noise.
6. **`context_health_snapshots` is absorbed, not duplicated** — technical
   group-KPIs write it; the reserved `health_score` finally gets a writer.

**Open for discussion:**
- **Q1 — Where does traffic/value data come from for the xprice repos?** Most
  have no analytics connector today. v1 likely ships technical+derived KPIs
  measuring immediately, with traffic/value KPIs proposed but parked `manual`
  until a connector lands. Acceptable?
- **Q2 — Should Director fold in?** Director scores personas; KPIs score the
  *product*. A later bridge could feed Director's per-team verdict trends in as
  `derived` KPIs ("team quality score") — v2 candidate, not in this plan.
- **Q3 — Evaluation cadence default**: weekly feels right for code KPIs
  (matches the weekly context-scan rhythm); daily only for cheap `derived` ones?
