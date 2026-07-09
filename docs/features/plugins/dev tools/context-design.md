# Context Design — the Context Map as the codebase's semantic layer

> Standalone reference for the Dev Tools **context** mechanism: what a context is,
> how the scan produces and maintains the map, who consumes it, how it pairs with
> KPIs today, and where the architecture should go next. The tab-level user flow
> lives in [`dev-tools.md`](./dev-tools.md); the KPI outcome layer in
> [`../../teams/kpis.md`](../../teams/kpis.md).

---

## 1. What a context is, and why it exists

A **context** is a semantic unit of a managed codebase — a business feature
(5–15 files) with a name, description, entry points, keywords, DB tables, API
surface, and cross-references to sibling contexts. Contexts are clustered into
**groups** (4–10 per project), each tagged with a business domain. The full set
is the project's **context map**.

The map exists to serve three jobs:

1. **Targeted LLM analysis** — instead of pointing an agent at "the repo", every
   downstream scan (idea scanner, KPI proposal scan, goal derivation) can scope
   itself to one context's file set and metadata. This is what makes per-area
   scans cheap and findings attributable.
2. **Metadocumentation** — the exported `context-map.json` + the managed
   `CLAUDE.md` section give any CLI session (Claude Code, `/research`,
   `/refresh-context`) an always-fresh index of what the codebase *means*, not
   just what it contains.
3. **Backlog anchoring** — ideas, goals, and KPIs all carry a `context_id`, so
   the map is the coordinate system the whole autonomous loop plots onto
   (coverage badges, the Factory matrix, derivation scoping).

The scan derives contexts by **business feature, not architectural layer** — the
prompt explicitly forbids "frontend / backend / utils" style grouping. The
taxonomy is two-axis: each context has a `category` (ui · api · lib · data ·
test · config); each group has a `domain` (feature · infrastructure · shared ·
integration · data).

---

## 2. Data model

```
dev_projects
  └── dev_context_groups        name, color, icon, domain, position,
      │                         health_score (reserved), last_scan_at
      └── dev_contexts          name, description, category, business_feature,
          │                     file_paths[], entry_points[], keywords[],
          │                     db_tables[], api_surface, cross_refs[],
          │                     tech_stack[], pinned
          ├── dev_ideas.context_id      (idea coverage)
          ├── dev_goals.context_id      (goal coverage)
          └── dev_kpis.context_id       (KPI scope — see §7)

dev_context_file_hashes         (project_id, file_path) → sha256, size
                                the delta-scan cache
dev_context_group_relationships source/target group edges
context_health_snapshots        per-group health history (orphaned plumbing —
                                see direction 2 in §9)
```

Key columns:

- Array-ish fields (`file_paths`, `keywords`, `entry_points`, `db_tables`,
  `cross_refs`, `tech_stack`) are JSON-array strings in SQLite; the frontend
  model (`sub_context/contextMapTypes.ts`) parses them.
- `pinned` — a hand-curated context that survives full re-scans (§4).
- `business_feature` — a free-text Title-Case label on the context ("often
  equals the context name"); today the only feature-level notion below a
  context. It is a display string, **not** an entity (relevant to §8).
- `dev_context_groups.health_score` — reserved since the KPI plan; never
  written by the scanner.

Rust models: `src-tauri/src/db/models/dev_tools.rs` (`DevContextGroup`,
`DevContext`). Schema: `src-tauri/src/db/migrations/schema.rs` +
`incremental.rs` (category / business_feature / domain / pinned / hashes were
incremental additions).

---

## 3. The scan — how the map is produced

**The scan is an LLM analysis, not a deterministic file walk.** The walk only
feeds delta detection; the semantic clustering is done by spawning the Claude
CLI (`--model claude-sonnet-4-6`, cwd = project root) with a "Context Map
Generator" prompt and parsing newline-delimited **protocol JSON** from stdout:

| Protocol message | Effect |
| --- | --- |
| `context_map_group` | creates a group (name, color, domain) |
| `context_map_context` | creates a context (full metadata; description is required) |
| `context_map_update` | updates an existing context by id (re-scan / delta only) |
| `context_map_summary` | final counts (groups / contexts / files mapped) |

Bogus enum values are normalized away post-parse (`normalize_category` /
`normalize_domain`); hallucinated group names fall back rather than break FKs.

**Launcher**: `context_generation::launch_context_scan(app, pool, project,
root_path, delta)` — shared by the `dev_tools_scan_codebase` command, Athena's
`register_project` auto-scan, Athena's `enqueue_dev_job{kind:"scan_codebase"}`,
and the weekly system-op. A per-project single-flight guard refuses concurrent
scans. Progress streams to the UI (`CONTEXT_GEN_OUTPUT/STATUS/COMPLETE`); the
30-minute timeout downgrades a partially-committed scan to
`completed_with_warning` instead of failing it.

**Three scan modes:**

1. **First scan** — full exploration, empty map.
2. **Full re-scan** — the prompt carries a summary of the existing map (with
   ids); the old map is **lazily cleared** only when the first new
   group/context arrives, so a failed or empty re-scan never destroys a curated
   map. Pinned contexts are flagged `[📌 PINNED — do NOT recreate]` in the
   prompt and excluded from the clear.
3. **Delta re-scan** (`delta_mode`) — `incremental_scan::walk_project_files`
   (skips vendor dirs, source extensions only, 2 MB cap) hashes the tree and
   `compute_delta` diffs it against `dev_context_file_hashes`. An empty delta
   **short-circuits with zero LLM spend**; otherwise the prompt gets
   ADDED/MODIFIED/DELETED lists (capped 80 per category) and emits targeted
   `context_map_update` messages. `dev_tools_compute_scan_delta` previews the
   delta without spending tokens.

**Post-scan, every run:**

- `persist_scan_hashes` — refresh the hash cache in one transaction.
- `prune_dangling_file_paths` — drop mapped paths that no longer exist on disk
  (self-heal; the pruned count is surfaced on the stream).
- `write_harness_docs` — regenerate the export artifacts (§5) **from the DB**.

---

## 4. Integrity invariants

The map is a self-validating artifact, not a fire-and-forget snapshot:

- **Pins survive rebuilds** — `clear_project_context_map` deletes only
  `pinned = 0` contexts; hand-curation outlives a full re-scan.
- **A scan never destroys on failure** — the lazy-clear gate means an aborted
  re-scan leaves the previous map intact.
- **No dead paths in the published map** — post-scan pruning guarantees every
  `file_paths` entry resolves on disk at publish time.
- **On-demand audit** — `dev_tools_audit_contexts` reports (never mutates):
  `dangling_file_path`, `unresolved_cross_ref` (a `cross_refs` entry naming no
  real context), `stale_context` (a mapped file whose content hash changed
  since the last scan).
- **Provenance** — the export stamps `git_commit` / `git_commit_count` and each
  context carries `last_written_at`, so any reader can judge staleness against
  the current HEAD instead of a bare timestamp.

---

## 5. Export artifacts — the metadocumentation surface

`context_map_export::write_context_map_artifacts` runs at every scan
completion and regenerates two files in the managed project's root:

1. **`context-map.json`** (`version: 2`, `generator: personas-context-scan`) —
   the pure DB projection: provenance block, project identity, taxonomy,
   stats, groups (with `domain`), and full context records (including
   `pinned` and `last_written_at`). Because it is regenerated from the DB it
   cannot drift from what the app believes.
2. **A managed `CLAUDE.md` section** — spliced idempotently between
   `<!-- personas:context-map:start -->` / `:end -->` markers: a group index
   plus the instruction to read `context-map.json` at task start. Everything
   outside the markers is preserved verbatim.

Downstream, the `/refresh-context` skill renders `context-map.json` into
`.claude/codebase-context.md` (+ overrides + catalogs) — a deterministic
projection that reads only the JSON, never the DB, so the markdown snapshot
cannot drift either. `/research` consumes that snapshot for relevance scoring.

---

## 6. Consumers — who reads the map

| Consumer | How it uses contexts |
| --- | --- |
| **Idea scanner** (`idea_scanner.rs::run_scan_core`) | `context_id(s)` scope the scan; the prompt summarizes only the selected contexts. The Context Map tab's per-card ⚡ button runs exactly this (agents auto-matched by keyword rules), and new ideas persist with `context_id` → the idea-coverage badge. |
| **KPI proposal scan** (`kpi_scan.rs`) | Renders the whole group→context hierarchy into the prompt; proposals may name a group or a single context (§7). |
| **Goal derivation** (`engine/kpi_derivation.rs`) | The candidate contexts offered to the LLM are filtered by the source KPI's scope; the chosen `context_id` is validated against the live map before the goal is created. |
| **Coverage badges** (`sub_context/ContextCard.tsx`) | Each card shows goal / idea / KPI counts keyed by `context_id`, with jump-to-surface handoffs. |
| **MCP context tools** (`mcp_server/tools.rs`) | Four read-only tools for executing personas: `context_list_groups`, `context_search_by_keyword`, `context_get_by_file_path` ("what feature owns this file"), `context_neighbors` (the `cross_refs` graph). Tool descriptions tell agents to prefer these over grep for architecture questions. |
| **Per-persona project pin** | `design_context.dev_project_id` is injected as `PERSONAS_DEV_PROJECT_ID` into the personas-mcp sidecar per run, so a persona bound to repo X reads X's contexts authoritatively. |
| **CLI sessions** | The managed `CLAUDE.md` section + `context-map.json` + `/refresh-context` snapshot (§5). |
| **Factory matrix** (`sub_factory/ContextMatrix.tsx`) | Rows = contexts, columns = KPI categories (§7). |

---

## 7. Contexts × KPIs — the current pairing design

KPIs (see [`kpis.md`](../../teams/kpis.md)) attach to the map through **two
nullable FKs on `dev_kpis`**, giving three scopes:

| Scope | Columns | Meaning |
| --- | --- | --- |
| Project | both NULL | outcome of the whole project |
| Group | `context_group_id` set | outcome of one context group |
| Context | `context_id` + parent `context_group_id` set | outcome of one context |

History matters here: the KPI plan (**§10 decision #1** of
`docs/plans/kpi-driven-orchestration.md`) deliberately **deferred per-context
KPIs** — "groups are the abstraction the user named, and context-level would
explode the review queue." The `context_id` column was a later reversal. The
group attachment itself was chosen partly because `dev_context_groups` already
had a reserved `health_score` column — plumbing reuse, not a first-principles
taxonomy.

How the pairing flows through the system today:

- **Proposal scan** — group scope is the default; the prompt allows context
  scope "only when one specific context clearly owns the outcome." Hallucinated
  names fall back to project level rather than breaking FKs.
- **Factory matrix** — a context × KPI-**category** grid (technical / quality /
  traffic / value). Group-level KPIs render as a synthetic `(group-level)` row;
  project-level KPIs as a synthetic `(project-level)` group.
- **Derivation** — an off-track KPI derives a goal whose candidate contexts are
  constrained to the KPI's scope; the goal gets its own `context_id` plus a
  soft `kpi_id` back-link.
- **Measurement** — `measure_config` procedures (codebase command / whitelisted
  derived SQL / frozen connector binding / manual) execute per **KPI**; nothing
  in the measurement path is context-aware.

### Why the pairing struggles

The observed friction — *contexts are too large/abstract for KPI assignment* —
is structural, not incidental:

1. **A context is a code-ownership unit; a KPI is an outcome.** Contexts are
   clustered by file structure (5–15 files, one file in exactly one context).
   Outcomes rarely respect that partition: "checkout conversion" spans a UI
   context, an API context, and a data context. Forcing the KPI to pick one
   produces either an arbitrary anchor or a retreat to group/project level —
   both of which blunt the derivation loop's targeting.
2. **Measurement has no anchor below the KPI.** A codebase-kind KPI runs a
   whole-repo command; a connector-kind KPI reads a service-wide metric.
   Neither knows which *slice of behavior* it certifies, so attribution
   ("did shipping goal G move KPI K?") is coarse.
3. **Cardinality pressure.** The plan's original worry was right: finer scope
   multiplies proposals, matrix rows, and review load. Any refinement must add
   precision without adding volume.

---

## 8. Reviewed proposal: a use-case / feature layer

**The idea under review:** introduce *key use cases / features* as children of
contexts and match KPIs against them, with wired tooling to measure.

**Verdict: the layer is the right move; the parent should not be a single
context.** Two findings from the codebase shape the recommendation:

- **No dev-domain use-case primitive exists** — all `use_case` machinery
  (`persona_triggers.use_case_id`, `sub_use_cases/`) is persona-scoped. This
  would be a new entity, with the persona schema as a precedent only.
- **A use-case key already exists in telemetry.** The LLM Overview's
  `LlmPinpoint` contract folds observed LLM usage **by use-case name**
  (`foldByUseCase`; LightTrack's `/v1/usecases`, Langfuse/LangSmith/Helicone
  adapters). The app already believes "use case" is the unit users think in —
  it just has no first-class row for it on the project side.

Recommended shape (differs from the raw idea in one important way):

```
dev_use_cases              project-scoped entity, NOT a strict child of one context
  id, project_id, name (stable slug — the telemetry join key),
  description, kind (user_flow | capability | integration | ops),
  primary_context_id       (nullable convenience anchor)
  pinned, status (proposed | active | archived), created_by (user | scan)

dev_use_case_contexts      N:M junction — a use case is a *slice through*
  (use_case_id, context_id)  contexts, not a subdivision of one

dev_kpis.use_case_id       fourth nullable scope FK (narrowest tier), following
                           the exact pattern the context_id ALTER established
```

Why N:M instead of strict children: a strict child-of-context model re-encodes
the same mismatch that makes the current pairing struggle — the moment a use
case touches a second context (they almost all do), the hierarchy lies. The
junction preserves the map as the coordinate system while letting outcomes cut
across it. The `primary_context_id` keeps the Factory matrix render simple
(place the use-case row under its primary context).

Cardinality control (the §10-decision-#1 lesson): use cases are **few and
curated** — target 5–15 *key* use cases per project, scan-proposed but
triage-gated (same accept/reject queue pattern as KPI proposals) and pinnable
(same survival rule as contexts). The scan prompt should be told to propose
use cases only where an outcome is measurable, not to enumerate every screen.

What "wired tooling to measure" becomes concrete as:

- **Telemetry join** — `dev_use_cases.name` matches the LLM Overview pinpoint
  use-case name, so observed calls/tokens/cost per use case is available with
  zero new instrumentation for LLM-powered features.
- **Scoped codebase measurement** — a use case's context set gives codebase-kind
  KPIs a file scope (coverage/lint/churn *of these files*) instead of
  whole-repo commands.
- **Derivation precision** — an off-track use-case KPI hands the goal
  derivation the use case's context set as the candidate pool: tighter than a
  group, honest about cross-context work, and the goal inherits a real
  behavioral target instead of a structural one.

Touch points if built (all have an existing branch to extend): the KPI scan
prompt scope rules (`kpi_scan.rs`), the Factory placement adapter
(`factoryData.tsx` precedence chain), matrix rows (`ContextMatrix.tsx`), the
derivation context filter (`kpi_derivation.rs`), and the export (§5 — use
cases belong in `context-map.json` so CLI agents see them too).

---

## 9. Five development directions

### 1. The use-case slice layer (the §8 proposal, made canonical)

Ship `dev_use_cases` + junction + `dev_kpis.use_case_id` as described above,
with the LLM Overview name-join as the first wired measurement. This is the
highest-leverage direction because it fixes the KPI anchor problem *and* gives
every other loop (ideas, goals, tasks) a behavioral unit to attribute to. The
existing `dev_contexts.business_feature` string is the migration seed: a
backfill scan can promote distinct business_feature values into proposed use
cases.

### 2. Context health as a measured signal (absorb the orphaned plumbing)

`dev_context_groups.health_score` and `context_health_snapshots` exist but
nothing writes them. Make context health **deterministic and free**: from the
delta engine + git, compute per-context staleness (% of files changed since
last scan), churn, test presence over `file_paths`, lint-warning density, and
audit findings (dangling refs). Feed the technical KPI category from these
snapshots automatically (`source='health_snapshot'` already exists on
`dev_kpi_measurements`). Contexts stop being only a map and become a scorecard
— and the idea scanner can prioritize unhealthy contexts without an LLM call.

### 3. Event-driven freshness instead of weekly cron

The Monday-3am delta scan is a floor, not a design. The delta preview
(`dev_tools_compute_scan_delta`) is token-free — run it opportunistically:
after CLI sessions end (Stop hook / post-commit), on project activation, and
before any context-scoped scan. Above a change threshold, auto-trigger the
delta re-scan; below it, just stamp per-context staleness in the UI and the
export. Add a **freshness gate** to consumers: an idea/KPI scan targeting a
context whose files drifted past a threshold should warn or refresh first —
today it silently analyzes a stale description against new code.

### 4. Contexts as verified contracts + an impact graph

`api_surface`, `db_tables`, and `cross_refs` are descriptive strings the LLM
emitted once. Verify them: extend `dev_tools_audit_contexts` to check
`db_tables` against the live schema and `api_surface` against the generated
command registry, and materialize `cross_refs` into a queryable dependency
graph. Then use it for **impact analysis**: a task or goal scoped to context X
automatically declares X's neighbors as review scope; the Task Runner injects
the owning context's file set + one-hop neighbors as the working set; a PR
touching files across N contexts gets flagged for cross-context review. This
is the piece autonomous execution needs to stop treating the repo as flat.

### 5. Context-scoped outcome attribution (close the autonomy loop)

Every artifact already carries the coordinates — ideas, goals, tasks (via
source idea), KPI measurements (via KPI scope). Build the attribution chain:
when a task ships inside context X (or use case U), snapshot the scoped KPIs
before/after and record the delta against the shipping artifact. That yields:
per-context/use-case ROI ("changes here move numbers; changes there don't"),
an Agent Scoreboard *per context* (Security Auditor is great in auth, noisy in
UI), and a derivation prioritizer that weights off-track KPIs by historical
movability. This is the feedback signal a fully autonomous loop needs to
allocate agent effort by measured outcome instead of by queue order.

**Sequencing note:** 1 → 2 → 3 are independently shippable and each is useful
alone; 4 hardens what 1–3 rely on; 5 depends on 1 (attribution needs the
behavioral unit) and 2 (needs cheap measurements to difference).

---

## Reference: commands & files

| Area | Where |
| --- | --- |
| Scan engine | `src-tauri/src/commands/infrastructure/context_generation.rs` (prompt, protocol parse, lazy clear, prune, timeout semantics) |
| Delta engine | `src-tauri/src/commands/infrastructure/incremental_scan.rs` (`walk_project_files`, `compute_delta`, `dev_tools_compute_scan_delta`) |
| Export | `src-tauri/src/commands/infrastructure/context_map_export.rs` (`context-map.json` v2 + managed CLAUDE.md splice) |
| Repo layer | `src-tauri/src/db/repos/dev_tools.rs` (`clear_project_context_map`, `set_context_pinned`, `replace_file_hashes`) |
| Audit | `dev_tools_audit_contexts` |
| Frontend | `src/features/plugins/dev-tools/sub_context/` (`ContextMapPage`, `ContextCard`, `ContextDetail`, `ScanOverlay`) |
| MCP tools | `src-tauri/src/mcp_server/tools.rs` (`context_list_groups` / `context_search_by_keyword` / `context_get_by_file_path` / `context_neighbors`) |
| KPI pairing | `kpi_scan.rs` (proposal scope rules), `engine/kpi_derivation.rs` (scope-filtered goal derivation), `src/features/teams/sub_factory/` (matrix + console) |
| CLI projection | `.claude/skills/refresh-context/` → `.claude/codebase-context.md` |
