//! The lab tool-call child table backfill, research-lab column alignment,
//! FK hygiene sweep, and the dev goals / KPI / context measurement surface
//! through the LLM spend ledger and fleet decisions.
//!
//! Slice of the original `run_incremental` / `ensure_composite_fires_table`
//! body, moved verbatim. The driver calls these modules in the same order
//! the statements appeared in, so the executed step sequence is unchanged.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    if !has_column(conn, "system_op_automations", "unattended_mode")? {
        ddl_step(
            conn,
            "ALTER TABLE system_op_automations ADD COLUMN unattended_mode TEXT NOT NULL DEFAULT 'auto';",
        )?;
    }

    // -- Research Lab plugin: defensive column ALTERs ---------------------------
    // The research_* tables are created with CREATE TABLE IF NOT EXISTS in
    // initial.rs. If a legacy DB has any of these tables with a drifted column
    // set (e.g. created before obsidian_vault_path was added), the SELECT
    // statements in db/repos/research_lab.rs will fail with
    // "no such column: <name>" and the UI surfaces "Database error: ..." on
    // every fetch/create. The block below idempotently brings legacy schemas
    // up to the current expected shape. Each ALTER is wrapped in `let _ =`
    // because SQLite errors on duplicate column names — that error is the
    // success path on already-migrated DBs.
    research_lab_align_columns(conn);

    // Reconcile the two clashing `dev_ideas.category` vocabularies into the
    // single canonical `IdeaCategory` enum. Idempotent — every reboot is a
    // no-op once the rows have been migrated. See `IdeaCategory` doc.
    crate::migrations::helpers::reconcile_idea_category_vocabulary(conn)?;

    // Re-install the persona_memories.importance trigger so the
    // 1..=5 bound is enforced at the DB layer regardless of whether a
    // future code path bypasses `validate_importance`. See MEMORY CONTRACT (4)
    // on `db::models::PersonaMemory`.
    crate::migrations::helpers::install_persona_memory_invariants(conn)?;

    // -- Lab: lab_tool_calls child table (1:N replaces JSON-array columns) -----
    // Replaces tool_calls_expected/actual JSON columns scattered across 5 lab
    // result tables + persona_test_runs. Lets future analytics query by
    // tool_name (e.g. "tool-call accuracy aggregated by tool"). Backfill,
    // dual-write, and column drop happen in subsequent steps of the same ADR.
    //
    // No FK on result_id yet: the parent tables share no common parent type and
    // the FK-hygiene ADR (2026-05-02-fk-hygiene-cascade) will retrofit FKs
    // table-by-table once it ships.
    //
    // ADR: 2026-05-02-lab-tool-calls-child-table.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS lab_tool_calls (
            id           TEXT PRIMARY KEY,
            result_kind  TEXT NOT NULL CHECK(result_kind IN ('arena','ab','matrix','consensus','eval','test_run')),
            result_id    TEXT NOT NULL,
            sequence     INTEGER NOT NULL,
            tool_name    TEXT NOT NULL,
            variant      TEXT NOT NULL CHECK(variant IN ('expected','actual')),
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(result_id, variant, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_lab_tool_calls_result ON lab_tool_calls(result_kind, result_id);
        CREATE INDEX IF NOT EXISTS idx_lab_tool_calls_tool ON lab_tool_calls(tool_name);"
    )?;
    backfill_lab_tool_calls(conn)?;
    drop_legacy_tool_calls_columns(conn);

    // FK hygiene: retrofit ON DELETE CASCADE / SET NULL onto child tables
    // that were originally created without REFERENCES clauses. Each table
    // is rebuilt independently and idempotently.
    // ADR: 2026-05-02-fk-hygiene-cascade.
    crate::migrations::fk_hygiene::run(conn)?;

    // -- Team assignments (Phase A orchestration) --------------------------------
    // Goal-driven workflows on top of PersonaTeams. An assignment is a top-level
    // goal; steps form a DAG (depends_on JSON array of step ids). The
    // team_assignment_orchestrator engine module walks the DAG, kicks off
    // persona executions, and surfaces failures through the existing
    // notification center for human review. Capabilities resolve to existing
    // DesignUseCase[] on persona.design_context — no capability_tags column.
    //
    // Phase A: manual matching only (user picks persona at composer time).
    // Phase B will add embedding + llm_eval strategies.
    // Phase C will populate companion_op_id from Athena dispatcher.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS team_assignments (
            id                  TEXT PRIMARY KEY,
            team_id             TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            goal                TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'queued'
                                CHECK(status IN ('queued','running','awaiting_review','done','failed','aborted')),
            match_strategy      TEXT NOT NULL DEFAULT 'manual'
                                CHECK(match_strategy IN ('manual','embedding','llm_eval')),
            max_parallel_steps  INTEGER NOT NULL DEFAULT 3,
            source              TEXT NOT NULL DEFAULT 'team_ui'
                                CHECK(source IN ('team_ui','athena','api')),
            companion_op_id     TEXT,
            goal_id             TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            started_at          TEXT,
            completed_at        TEXT,
            error_message       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_team_assignments_team
            ON team_assignments(team_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_team_assignments_status
            ON team_assignments(status) WHERE status IN ('queued','running','awaiting_review');",
    )?;

    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS team_assignment_steps (
            id                    TEXT PRIMARY KEY,
            assignment_id         TEXT NOT NULL REFERENCES team_assignments(id) ON DELETE CASCADE,
            step_order            INTEGER NOT NULL,
            title                 TEXT NOT NULL,
            description           TEXT,
            status                TEXT NOT NULL DEFAULT 'pending'
                                  CHECK(status IN ('pending','matching','running','awaiting_review','done','skipped','failed')),
            assigned_persona_id   TEXT REFERENCES personas(id) ON DELETE SET NULL,
            assigned_use_case_id  TEXT,
            match_confidence      REAL,
            match_rationale       TEXT,
            execution_id          TEXT REFERENCES persona_executions(id) ON DELETE SET NULL,
            depends_on            TEXT,
            output_summary        TEXT,
            retry_count           INTEGER NOT NULL DEFAULT 0,
            error_message         TEXT,
            started_at            TEXT,
            completed_at          TEXT,
            UNIQUE(assignment_id, step_order)
        );
        CREATE INDEX IF NOT EXISTS idx_team_assignment_steps_assignment
            ON team_assignment_steps(assignment_id, step_order);
        CREATE INDEX IF NOT EXISTS idx_team_assignment_steps_status
            ON team_assignment_steps(assignment_id, status);",
    )?;

    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS team_assignment_events (
            id              TEXT PRIMARY KEY,
            assignment_id   TEXT NOT NULL REFERENCES team_assignments(id) ON DELETE CASCADE,
            step_id         TEXT REFERENCES team_assignment_steps(id) ON DELETE CASCADE,
            kind            TEXT NOT NULL,
            payload         TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_team_assignment_events_assignment
            ON team_assignment_events(assignment_id, created_at);",
    )?;

    // -- Goals hub: link team assignments to a dev goal --------------------------
    // A linked assignment advances a `dev_goals` row: its step checklist + states
    // surface on the goal, and terminal/step transitions write `dev_goal_signals`.
    // Soft link (plain TEXT, no FK) to match the codebase's ALTER style and keep
    // fresh-install (CREATE block above) and migrated schemas identical.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_assignments.goal_id",
            description: "Link team assignments to a dev goal (goals hub)",
            already_applied: |conn| has_column(conn, "team_assignments", "goal_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_assignments ADD COLUMN goal_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Goals hub: lightweight ad-hoc checklist items on a dev goal -------------
    // Composed alongside sub-goals + linked-assignment steps into the goal's
    // unified checklist. Heavier breakdown stays in dev_goals (parent_goal_id).
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_goal_items",
            description: "Lightweight checklist items on a dev goal (goals hub)",
            already_applied: |conn| has_table(conn, "dev_goal_items"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_goal_items (
                        id          TEXT PRIMARY KEY,
                        goal_id     TEXT NOT NULL REFERENCES dev_goals(id) ON DELETE CASCADE,
                        title       TEXT NOT NULL,
                        done        INTEGER NOT NULL DEFAULT 0,
                        order_index INTEGER NOT NULL DEFAULT 0,
                        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_goal_items_goal
                        ON dev_goal_items(goal_id, order_index);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Team assignment templates (Phase C4) ------------------------------------
    // A saved, reusable assignment shape: title + goal + match strategy +
    // parallelism + the full step list (stored as a JSON array of
    // CreateTeamAssignmentStepInput). Instantiating a template clones it into
    // a fresh team_assignments row. Scoped per team (FK CASCADE) so a deleted
    // team takes its templates with it. No FK from instantiated assignments
    // back to the template — a template is a stamp, not a parent.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS team_assignment_templates (
            id                  TEXT PRIMARY KEY,
            team_id             TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            goal                TEXT NOT NULL,
            match_strategy      TEXT NOT NULL DEFAULT 'manual'
                                CHECK(match_strategy IN ('manual','embedding','llm_eval')),
            max_parallel_steps  INTEGER NOT NULL DEFAULT 3,
            steps_json          TEXT NOT NULL DEFAULT '[]',
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_team_assignment_templates_team
            ON team_assignment_templates(team_id, updated_at DESC);",
    )?;

    // -- KPI layer (docs/plans/kpi-driven-orchestration.md P0) -------------------
    // KPIs are the outcome layer above goals: per-project (or per context group)
    // success definitions with a stored measurement procedure, a target
    // ("volume"), and a time series. Goals derived from off-track KPIs carry
    // dev_goals.kpi_id (soft link, ALTER style).
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis",
            description: "KPI definitions (outcome layer above goals)",
            already_applied: |conn| has_table(conn, "dev_kpis"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_kpis (
                        id               TEXT PRIMARY KEY,
                        project_id       TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        context_group_id TEXT REFERENCES dev_context_groups(id) ON DELETE SET NULL,
                        name             TEXT NOT NULL,
                        description      TEXT,
                        category         TEXT NOT NULL DEFAULT 'technical'
                                         CHECK(category IN ('technical','traffic','value','quality')),
                        measure_kind     TEXT NOT NULL DEFAULT 'manual'
                                         CHECK(measure_kind IN ('codebase','connector','manual','derived')),
                        measure_config   TEXT NOT NULL DEFAULT '{}',
                        unit             TEXT NOT NULL DEFAULT '',
                        direction        TEXT NOT NULL DEFAULT 'up' CHECK(direction IN ('up','down')),
                        baseline_value   REAL,
                        target_value     REAL,
                        target_date      TEXT,
                        current_value    REAL,
                        last_measured_at TEXT,
                        cadence          TEXT NOT NULL DEFAULT 'manual'
                                         CHECK(cadence IN ('manual','daily','weekly')),
                        status           TEXT NOT NULL DEFAULT 'proposed'
                                         CHECK(status IN ('proposed','active','paused','archived')),
                        created_by       TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user','scan')),
                        rationale        TEXT,
                        needed_connector TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_kpis_project ON dev_kpis(project_id, status);
                    CREATE INDEX IF NOT EXISTS idx_dev_kpis_group ON dev_kpis(context_group_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpi_measurements",
            description: "KPI measurement time series",
            already_applied: |conn| has_table(conn, "dev_kpi_measurements"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_kpi_measurements (
                        id          TEXT PRIMARY KEY,
                        kpi_id      TEXT NOT NULL REFERENCES dev_kpis(id) ON DELETE CASCADE,
                        value       REAL NOT NULL,
                        measured_at TEXT NOT NULL DEFAULT (datetime('now')),
                        source      TEXT NOT NULL DEFAULT 'manual'
                                    CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation')),
                        env         TEXT NOT NULL DEFAULT 'production'
                                    CHECK(env IN ('local','test','production')),
                        evidence    TEXT,
                        note        TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_kpi_measurements_kpi
                        ON dev_kpi_measurements(kpi_id, measured_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    // KPI simulation (docs/plans/kpi-simulation-skill.md P0): measurements gain
    // an ENVIRONMENT axis (local / test / production — same vocabulary as the
    // passport env split) and a 'simulation' source. SQLite can't widen a CHECK
    // in place, so legacy tables are rebuilt (copy → drop → rename); fresh DBs
    // get the new shape from the CREATE above and skip this via the guard.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpi_measurements_env_sim",
            description: "env axis + simulation source on KPI measurements (table rebuild)",
            already_applied: |conn| {
                let sql: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='dev_kpi_measurements'",
                    [],
                    |r| r.get(0),
                )?;
                Ok(
                    sql.contains("'simulation'")
                        && has_column(conn, "dev_kpi_measurements", "env")?,
                )
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE dev_kpi_measurements_env_sim_new (
                        id          TEXT PRIMARY KEY,
                        kpi_id      TEXT NOT NULL REFERENCES dev_kpis(id) ON DELETE CASCADE,
                        value       REAL NOT NULL,
                        measured_at TEXT NOT NULL DEFAULT (datetime('now')),
                        source      TEXT NOT NULL DEFAULT 'manual'
                                    CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation')),
                        env         TEXT NOT NULL DEFAULT 'production'
                                    CHECK(env IN ('local','test','production')),
                        evidence    TEXT,
                        note        TEXT
                    );
                    INSERT INTO dev_kpi_measurements_env_sim_new
                        (id, kpi_id, value, measured_at, source, evidence, note)
                        SELECT id, kpi_id, value, measured_at, source, evidence, note
                        FROM dev_kpi_measurements;
                    DROP TABLE dev_kpi_measurements;
                    ALTER TABLE dev_kpi_measurements_env_sim_new RENAME TO dev_kpi_measurements;
                    CREATE INDEX IF NOT EXISTS idx_dev_kpi_measurements_kpi
                        ON dev_kpi_measurements(kpi_id, measured_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.metric_type",
            description: "Type-bound connector KPIs (P6): semantic metric type",
            already_applied: |conn| has_column(conn, "dev_kpis", "metric_type"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN metric_type TEXT;")?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.tier",
            description: "KPI tier (north_star/primary/supporting) for derivation precedence",
            already_applied: |conn| has_column(conn, "dev_kpis", "tier"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_kpis ADD COLUMN tier TEXT NOT NULL DEFAULT 'supporting';",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.context_id",
            description: "Context-level KPIs: scope a KPI to a single dev_context (NULL = project/group-level)",
            already_applied: |conn| has_column(conn, "dev_kpis", "context_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_kpis ADD COLUMN context_id TEXT REFERENCES dev_contexts(id) ON DELETE SET NULL;",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_kpis_context ON dev_kpis(context_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.factory_calibration",
            description: "Factory KPI console: persisted warn/crit thresholds, manual rating, pros/cons assessment",
            already_applied: |conn| has_column(conn, "dev_kpis", "warn_at"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN warn_at REAL;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN crit_at REAL;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN manual_rating INTEGER;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN assessment_pros TEXT;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN assessment_cons TEXT;")?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.skip_memory",
            description: "KPI derivation skip: remember an off-track KPI judged not team-actionable (cooldown + honest 'over to you' UI)",
            already_applied: |conn| has_column(conn, "dev_kpis", "last_skip_at"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN last_skip_at TEXT;")?;
                ddl_step(conn, "ALTER TABLE dev_kpis ADD COLUMN last_skip_rationale TEXT;")?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpi_bindings",
            description: "Swappable connector bindings for type-bound KPIs (P6)",
            already_applied: |conn| has_table(conn, "dev_kpi_bindings"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_kpi_bindings (
                        id            TEXT PRIMARY KEY,
                        kpi_id        TEXT NOT NULL REFERENCES dev_kpis(id) ON DELETE CASCADE,
                        credential_id TEXT NOT NULL,
                        service_type  TEXT NOT NULL,
                        procedure     TEXT NOT NULL,
                        composed_by   TEXT NOT NULL DEFAULT 'llm'
                                      CHECK(composed_by IN ('recipe','llm')),
                        status        TEXT NOT NULL DEFAULT 'active'
                                      CHECK(status IN ('active','archived','degraded')),
                        verified_at   TEXT,
                        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_kpi_bindings_kpi
                        ON dev_kpi_bindings(kpi_id, status);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_run_checkpoints",
            description: "F5: git checkpoint stage->SHA index for dev-tools runs",
            already_applied: |conn| has_table(conn, "dev_run_checkpoints"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_run_checkpoints (
                        id          TEXT PRIMARY KEY,
                        run_id      TEXT NOT NULL,
                        stage       TEXT NOT NULL,
                        sha         TEXT NOT NULL,
                        status      TEXT NOT NULL,
                        created_at  TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_run_checkpoints_run
                        ON dev_run_checkpoints(run_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "athena_wake_log",
            description: "Athena autonomy wake/impact ledger (wake-window design)",
            already_applied: |conn| has_table(conn, "athena_wake_log"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS athena_wake_log (
                        id              TEXT PRIMARY KEY,
                        surface         TEXT NOT NULL,
                        trigger_reason  TEXT NOT NULL,
                        signals_pending INTEGER NOT NULL DEFAULT 0,
                        oldest_age_min  INTEGER NOT NULL DEFAULT 0,
                        cli_calls       INTEGER NOT NULL DEFAULT 0,
                        actions_taken   INTEGER NOT NULL DEFAULT 0,
                        duration_ms     INTEGER NOT NULL DEFAULT 0,
                        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_athena_wake_log_surface
                        ON athena_wake_log(surface, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.thinking_level",
            description: "Resolved CLI effort level per execution (cost observability)",
            already_applied: |conn| has_column(conn, "persona_executions", "thinking_level"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN thinking_level TEXT",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_goals.kpi_id",
            description: "Link a derived goal to the KPI it serves",
            already_applied: |conn| has_column(conn, "dev_goals", "kpi_id"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_goals ADD COLUMN kpi_id TEXT;")?;
                Ok(())
            },
        },
    )?;

    // Goal-UAT browser-test gate: a dev_goal_item carrying verify_kind +
    // verify_config is a verification gate (not a manual to-do) — only a
    // passing browser test ticks it, and an open one keeps the goal under
    // 100% (the gate). verify_config is JSON `{scenario, url?}`.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_goal_items.verify_kind",
            description: "Browser-test UAT gate item on a dev goal",
            already_applied: |conn| has_column(conn, "dev_goal_items", "verify_kind"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_goal_items ADD COLUMN verify_kind TEXT;",
                )?;
                ddl_step(
                    conn,
                    "ALTER TABLE dev_goal_items ADD COLUMN verify_config TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- persona_executions: prompt-cache token visibility (P1). Capture how
    // many input tokens were served from cache vs. written, so prompt-cache
    // effectiveness is measurable. Both NOT NULL DEFAULT 0 — existing rows read
    // as 0/0 (no cache data), never null. Written at finalize via
    // executions::set_cache_tokens; surfaced on the execution detail.
    ddl_step(
        conn,
        "ALTER TABLE persona_executions ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;",
    )
    .ok();
    ddl_step(conn, "ALTER TABLE persona_executions ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0;").ok();

    // -- run_budgets (P2): persisted aggregate cost per multi-spawn run for
    // historical / cost-trend dashboards. Mirrors the in-memory RunBudgetLedger
    // (engine/run_budget.rs); written at each consumer's finalize. Keyed by the
    // run identity (evolution cycle id / lab run id / pipeline run id).
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS run_budgets (
            run_id       TEXT PRIMARY KEY,
            kind         TEXT NOT NULL,
            ceiling_usd  REAL NOT NULL DEFAULT 0,
            spent_usd    REAL NOT NULL DEFAULT 0,
            spawn_count  INTEGER NOT NULL DEFAULT 0,
            exceeded     INTEGER NOT NULL DEFAULT 0,
            enforce      INTEGER NOT NULL DEFAULT 0,
            finished     INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .ok();
    ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_run_budgets_kind ON run_budgets(kind, updated_at);",
    )
    .ok();

    // NOTE: the Groups→Teams Phase-3 DATA MIGRATION that used to live here was
    // relocated to the end of `run_incremental` (2026-05-24). It reads columns
    // (`persona_groups.shared_instructions`, `persona_teams.shared_instructions`,
    // `personas.home_team_id`, `persona_memories.home_team_id`) that are only
    // added by `run_incremental` — but `ensure_composite_fires_table` runs in the
    // earlier `initial::run` phase, so on a fresh DB those columns did not yet
    // exist and the migration aborted startup with "no such column:
    // g.shared_instructions". Moving it to phase 2 satisfies every dependency.

    // -- Context categorization parity with Vibeman: a technical `category` and
    // a human `business_feature` on contexts, plus a business `domain` on groups.
    // Standardizes the context map (comparable across projects) and enables
    // domain-scoped scanning / KPI targeting. Nullable TEXT — existing rows read
    // as null until the next context scan re-populates them.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_contexts.category",
            description: "Add technical category to dev_contexts",
            already_applied: |conn| has_column(conn, "dev_contexts", "category"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE dev_contexts ADD COLUMN category TEXT;")?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_contexts.business_feature",
            description: "Add business_feature to dev_contexts",
            already_applied: |conn| has_column(conn, "dev_contexts", "business_feature"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_contexts ADD COLUMN business_feature TEXT;",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_context_groups.domain",
            description: "Add business domain to dev_context_groups",
            already_applied: |conn| has_column(conn, "dev_context_groups", "domain"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_context_groups ADD COLUMN domain TEXT;",
                )?;
                Ok(())
            },
        },
    )?;
    // Canonical pin: a human-curated context that a full rescan must preserve
    // rather than DELETE-and-recreate. Adopts ktx's "canonical pins" idea (prior
    // human tie-breaks are protected across re-ingest) to fix the documented
    // near-miss where a full rescan silently destroyed a hand-curated map.
    // Boolean stored as INTEGER; existing rows default to unpinned.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_contexts.pinned",
            description: "Add canonical-pin flag to dev_contexts",
            already_applied: |conn| has_column(conn, "dev_contexts", "pinned"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_contexts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            // tiger finding #1: the headless LLM tier (scanners, lab/eval,
            // design-artifact spawns) recorded no model/tokens/cost — the
            // `result` line streamed past and was discarded. This is the
            // dedicated spend ledger (separate from companion_turn, which stays
            // companion-scoped). Append-only history: soft refs (no FK) so a
            // row survives deletion of its persona/project. Free-text
            // source/trigger_kind, mirroring companion_turn's origin.
            id: "dev_llm_spend",
            description: "Headless LLM spend ledger — model/tokens/cost per background call",
            already_applied: |conn| has_table(conn, "dev_llm_spend"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_llm_spend (
                        id                    TEXT PRIMARY KEY,
                        source                TEXT NOT NULL,
                        trigger_kind          TEXT NOT NULL,
                        model                 TEXT,
                        input_tokens          INTEGER,
                        output_tokens         INTEGER,
                        cache_read_tokens     INTEGER,
                        cache_creation_tokens INTEGER,
                        cost_usd              REAL,
                        duration_ms           INTEGER,
                        num_turns             INTEGER,
                        is_error              INTEGER NOT NULL DEFAULT 0,
                        persona_id            TEXT,
                        project_id            TEXT,
                        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_llm_spend_created
                        ON dev_llm_spend(created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_dev_llm_spend_source
                        ON dev_llm_spend(source, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_dev_llm_spend_trigger
                        ON dev_llm_spend(trigger_kind, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            // Phase 5a — durable fleet-decision ledger. Athena's per-session
            // orchestration verdicts (auto-fired action vs deferred consult) were
            // in-memory only (the screen-hash map in fleet_bridge), lost on
            // restart. This persists each decision so (a) she can skip re-asking a
            // screen she already decided — keyed on the STABLE claude_session_id +
            // screen_hash, since the registry id is regenerated each launch — and
            // (b) the user can see WHY she stopped/acted on a session. Append-only;
            // soft refs (no FK); free-text action/outcome/confidence/defer_reason.
            id: "fleet_decisions",
            description: "Durable Athena fleet-orchestration decision ledger",
            already_applied: |conn| has_table(conn, "fleet_decisions"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS fleet_decisions (
                        id                 TEXT PRIMARY KEY,
                        session_id         TEXT NOT NULL,
                        claude_session_id  TEXT,
                        screen_hash        TEXT NOT NULL,
                        action             TEXT NOT NULL,
                        outcome            TEXT NOT NULL,
                        confidence         TEXT,
                        decision_class     TEXT,
                        defer_reason       TEXT,
                        rationale          TEXT,
                        created_at         TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_fleet_decisions_created
                        ON fleet_decisions(created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_fleet_decisions_session
                        ON fleet_decisions(session_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_fleet_decisions_dedupe
                        ON fleet_decisions(claude_session_id, screen_hash);",
                )?;
                Ok(())
            },
        },
    )?;

    Ok(())
}
