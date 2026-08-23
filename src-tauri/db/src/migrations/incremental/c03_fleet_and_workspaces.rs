//! Fleet session durability, external API key capabilities, dev use cases,
//! persona lifecycle, healing sources, deployment targets, and the workspace
//! knowledge centre tables.
//!
//! Slice of the original `run_incremental` / `ensure_composite_fires_table`
//! body, moved verbatim. The driver calls these modules in the same order
//! the statements appeared in, so the executed step sequence is unchanged.

use rusqlite::{Connection, OptionalExtension};

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            // Fleet registry durability — the fleet's session registry was
            // in-memory only (`registry::FleetRegistry::sessions`), so every
            // app restart / update / crash lost the WHOLE fleet (three
            // total-loss restarts on 2026-07-24; recovering eight stranded
            // conversations took a hand-written json + a resume script).
            // Everything needed to resurrect a row is already known, so this
            // table mirrors the registry: rows are upserted from the existing
            // emit points and rehydrated as dozing tombstones on boot.
            //
            // Only rows with a BOUND `claude_session_id` are ever written —
            // they are the only ones `claude --resume` can bring back, and it
            // keeps never-attached spawns out of the rehydration set.
            // `run_id` / `run_label` are the run-harvest lane's grouping key
            // (a batch tag stamped at spawn); nullable = "ad hoc".
            id: "fleet_sessions",
            description: "Durable fleet session registry (survives app restarts)",
            already_applied: |conn| has_table(conn, "fleet_sessions"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS fleet_sessions (
                        id                 TEXT PRIMARY KEY,
                        claude_session_id  TEXT NOT NULL,
                        cwd                TEXT NOT NULL,
                        project_label      TEXT NOT NULL,
                        name               TEXT,
                        title              TEXT,
                        args_json          TEXT NOT NULL DEFAULT '[]',
                        mode               TEXT NOT NULL DEFAULT 'interactive',
                        state              TEXT NOT NULL,
                        state_reason       TEXT,
                        run_id             TEXT,
                        run_label          TEXT,
                        created_at_ms      INTEGER NOT NULL,
                        last_activity_ms   INTEGER NOT NULL,
                        updated_at_ms      INTEGER NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_fleet_sessions_state
                        ON fleet_sessions(state, updated_at_ms DESC);
                    CREATE INDEX IF NOT EXISTS idx_fleet_sessions_claude
                        ON fleet_sessions(claude_session_id);
                    CREATE INDEX IF NOT EXISTS idx_fleet_sessions_run
                        ON fleet_sessions(run_id, created_at_ms);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- External API keys: capability-token columns (Direction 5, P1) --------
    // Upgrade path for EXISTING DBs whose `external_api_keys` predates the
    // capability-token columns. Fresh DBs are already born with these columns
    // (see initial.rs), so this is a pure upgrade step. Adds hard expiry,
    // browser-origin binding, and a human label so the key-creation UI and
    // (later) the pairing ceremony can mint time-boxed, origin-bound,
    // least-privilege keys. All nullable, so existing keys and the process
    // "system" key are unaffected: NULL expires_at = non-expiring, NULL
    // bound_origin = no origin restriction.
    //
    // Guarded on `has_table` first: some code paths reach run_incremental with
    // `external_api_keys` not yet present, and an unguarded ALTER would abort
    // the whole chain. `already_applied` (has_column) then makes the ALTER
    // itself idempotent. See docs/architecture/cloud-integration-bridge.md.
    run_step(
        conn,
        IncrementalMigration {
            id: "external_api_keys.capability_columns",
            description: "external_api_keys: expires_at + bound_origin + label",
            already_applied: |conn| {
                // No-op if the table is absent (nothing to alter yet) or the
                // first column already exists.
                Ok(!has_table(conn, "external_api_keys")?
                    || has_column(conn, "external_api_keys", "expires_at")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE external_api_keys ADD COLUMN expires_at TEXT;
                     ALTER TABLE external_api_keys ADD COLUMN bound_origin TEXT;
                     ALTER TABLE external_api_keys ADD COLUMN label TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Split the scraper config's overloaded `name` into a short title + a
    // separate use-case description (Phase 1b-2 follow-up).
    run_step(
        conn,
        IncrementalMigration {
            id: "scraper_configs.description",
            description: "scraper_configs: add description column",
            already_applied: |conn| {
                Ok(!has_table(conn, "scraper_configs")?
                    || has_column(conn, "scraper_configs", "description")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE scraper_configs ADD COLUMN description TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // ---------------------------------------------------------------------
    // Use-case slice layer (docs/plans/use-case-slice-layer.md)
    //
    // A use case is a *slice through* contexts, not a subdivision of one: the
    // behavioral unit ("checkout conversion") that a KPI can actually own,
    // where a context is a code-ownership partition that outcomes cut across.
    // `slug` is the telemetry join key — it matches the use-case name the LLM
    // Overview already folds observability pinpoints by.
    // ---------------------------------------------------------------------
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_use_cases",
            description:
                "Use-case slice layer: behavioral units spanning contexts, the narrowest KPI scope",
            already_applied: |conn| has_table(conn, "dev_use_cases"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_use_cases (
                        id                 TEXT PRIMARY KEY,
                        project_id         TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        name               TEXT NOT NULL,
                        slug               TEXT NOT NULL,
                        description        TEXT,
                        kind               TEXT NOT NULL DEFAULT 'capability'
                                           CHECK(kind IN ('user_flow','capability','integration','ops')),
                        primary_context_id TEXT REFERENCES dev_contexts(id) ON DELETE SET NULL,
                        status             TEXT NOT NULL DEFAULT 'active'
                                           CHECK(status IN ('proposed','active','archived')),
                        created_by         TEXT NOT NULL DEFAULT 'user'
                                           CHECK(created_by IN ('user','scan','backfill')),
                        pinned             INTEGER NOT NULL DEFAULT 0,
                        rationale          TEXT,
                        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(project_id, slug)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_use_cases_project
                     ON dev_use_cases(project_id, status);",
                )?;
                // The slice. Cascades on either side; the scan's
                // snapshot/reconcile pass rebuilds it by context NAME after a
                // full rescan recreates context rows under fresh ids.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_use_case_contexts (
                        use_case_id TEXT NOT NULL REFERENCES dev_use_cases(id) ON DELETE CASCADE,
                        context_id  TEXT NOT NULL REFERENCES dev_contexts(id) ON DELETE CASCADE,
                        PRIMARY KEY (use_case_id, context_id)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_use_case_contexts_context
                     ON dev_use_case_contexts(context_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpis.use_case_id",
            description:
                "Use-case-scoped KPIs: the narrowest KPI scope (narrower than a single context)",
            already_applied: |conn| has_column(conn, "dev_kpis", "use_case_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_kpis ADD COLUMN use_case_id TEXT REFERENCES dev_use_cases(id) ON DELETE SET NULL;",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_kpis_use_case ON dev_kpis(use_case_id);",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memories.derived_from",
            description: "Reflection provenance: JSON array of source memory ids a synthesized insight was derived from (no FK by design — sources are archived, and may later be deleted, without erasing the insight's lineage)",
            already_applied: |conn| has_column(conn, "persona_memories", "derived_from"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memories ADD COLUMN derived_from TEXT;",
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "chain_stop_reasons.create",
            description: "Chain stop reasons: structured record of why a chain relay did NOT continue at each non-continuation path (handoff suppression, cycle, depth/budget limit, predicate miss, quarantine) — queryable per chain_trace_id for the Chain tab's end-of-chain explanation",
            already_applied: |conn| has_table(conn, "chain_stop_reasons"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS chain_stop_reasons (
                        id                TEXT PRIMARY KEY,
                        chain_trace_id    TEXT NOT NULL,
                        link_execution_id TEXT NOT NULL,
                        trigger_id        TEXT,
                        target_persona_id TEXT,
                        reason_token      TEXT NOT NULL,
                        detail            TEXT,
                        chain_depth       INTEGER NOT NULL DEFAULT 0,
                        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_csr_chain ON chain_stop_reasons(chain_trace_id);
                    CREATE INDEX IF NOT EXISTS idx_csr_link  ON chain_stop_reasons(link_execution_id);
                    CREATE INDEX IF NOT EXISTS idx_csr_created ON chain_stop_reasons(created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    // First-class persona lifecycle (Draft → Active → Archived). Replaces the
    // frontend draft heuristic (`!last_design_result && prompt == default`) with
    // a durable column. Default `active` so every existing real persona keeps
    // routing to the editor. The one-time backfill infers `draft` from the SAME
    // heuristic the frontend used — a persona that never finished a build (no
    // design result / design context) AND still carries the placeholder/empty
    // system_prompt. A completed build always populated `last_design_result`, so
    // a real persona whose prompt merely LOOKS like the placeholder is NOT
    // yanked into draft. Archiving lands only via the runtime archive command.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas.lifecycle",
            description:
                "First-class persona lifecycle column (draft|active|archived) + draft backfill",
            already_applied: |conn| has_column(conn, "personas", "lifecycle"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE personas ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active';
                     CREATE INDEX IF NOT EXISTS idx_personas_lifecycle ON personas(lifecycle);",
                )?;
                // Backfill drafts. Mirrors PersonaOverviewPage's isDraft():
                //   !last_design_result && (system_prompt == placeholder || blank)
                // Also treat a NULL/blank design_context as part of "never built"
                // for defense in depth (a finished build writes design_context).
                //
                // ORDERING FIX (2026-07-14): this migration lives in
                // `ensure_composite_fires_table`, which `migrations::run()`
                // executes BEFORE `run_incremental()` adds the trust columns.
                // On a FRESH database `trust_origin` therefore does not exist
                // yet and the previous unconditional reference to it errored
                // ("no such column: trust_origin") — bricking init on every
                // fresh install (and init_test_db). Guard the system-persona
                // exclusion on column existence: a fresh DB has zero persona
                // rows at this point (seeds run after migrations), so the
                // clause is vacuously unnecessary there; on legacy DBs the
                // column exists and the exclusion applies as designed.
                let trust_clause = if has_column(conn, "personas", "trust_origin")? {
                    "AND COALESCE(trust_origin, 'builtin') != 'system'"
                } else {
                    ""
                };
                ddl_step(
                    conn,
                    &format!(
                        "UPDATE personas SET lifecycle = 'draft'
                         WHERE (last_design_result IS NULL OR TRIM(last_design_result) = '')
                           AND (design_context IS NULL OR TRIM(design_context) = '')
                           AND (system_prompt = 'You are a helpful AI assistant.'
                                OR TRIM(COALESCE(system_prompt, '')) = '')
                           {trust_clause};"
                    ),
                )?;
                Ok(())
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_healing_issues.source",
            description: "Provenance of a healing issue: NULL/'engine' for the self-healing pipeline (legacy default), 'director' for issues routed from a Director coaching verdict. Lets the health UI badge the origin and lets the Director dedup its own open issues without a schema-less title hack.",
            already_applied: |conn| has_column(conn, "persona_healing_issues", "source"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_healing_issues ADD COLUMN source TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "deployment_history.target",
            description: "Deploy target for a history row: 'gitlab' (legacy default — Duo agent / AGENTS.md) or 'cloud' (Personas Cloud managed endpoint). Lets the unified deployment audit trail carry cloud deploys alongside GitLab, and is the substrate the deferred cloud-version-rollback builds on.",
            already_applied: |conn| has_column(conn, "deployment_history", "target"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE deployment_history ADD COLUMN target TEXT NOT NULL DEFAULT 'gitlab';",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_center_tables",
            description: "Workspace Knowledge Center (docs/plans/workspace-knowledge-center.md): dev_workspaces promotes the sub_workspaces localStorage prototype to SQLite; workspace_knowledge is the governed cross-project practice store (observed→proposed→adopted ladder, provenance, applicability, rejection kept for miner dedup); workspace_practice_adoption tracks per-project adoption state (the scaling surface).",
            already_applied: |conn| has_table(conn, "dev_workspaces"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_workspaces (
                        id          TEXT PRIMARY KEY,
                        name        TEXT NOT NULL,
                        color       TEXT,
                        description TEXT,
                        created_at  TEXT NOT NULL,
                        updated_at  TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS workspace_knowledge (
                        id                TEXT PRIMARY KEY,
                        workspace_id      TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE CASCADE,
                        kind              TEXT NOT NULL CHECK(kind IN ('pattern','pitfall','decision','howto','fact')),
                        title             TEXT NOT NULL,
                        statement         TEXT NOT NULL,
                        detail_md         TEXT,
                        topic             TEXT,
                        abstraction       TEXT,
                        ftype             TEXT,
                        durability        TEXT,
                        governing_id      TEXT,
                        evidence_count    INTEGER,
                        applicability     TEXT,
                        status            TEXT NOT NULL DEFAULT 'observed'
                                          CHECK(status IN ('observed','proposed','adopted','deprecated','rejected')),
                        origin_project_id TEXT,
                        provenance        TEXT,
                        confidence        REAL,
                        dedup_key         TEXT,
                        superseded_by     TEXT,
                        valid_from        TEXT,
                        valid_to          TEXT,
                        decided_at        TEXT,
                        created_at        TEXT NOT NULL,
                        updated_at        TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_ws_status
                        ON workspace_knowledge(workspace_id, status);
                    CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_dedup
                        ON workspace_knowledge(workspace_id, dedup_key);
                    CREATE TABLE IF NOT EXISTS workspace_practice_adoption (
                        practice_id      TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
                        project_id       TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        state            TEXT NOT NULL CHECK(state IN ('na','proposed','to_process','dispatched','adopted','diverged')),
                        fleet_key        TEXT,
                        note             TEXT,
                        last_verified_at TEXT,
                        updated_at       TEXT NOT NULL,
                        PRIMARY KEY (practice_id, project_id)
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects.workspace_id",
            description: "Single-workspace-per-project binding (nullable). Replaces the retired dev_projects.group_id design-time folder; NULL = unassigned. No cascade — deleting a workspace nulls the column via the delete repo fn, never touching projects.",
            already_applied: |conn| has_column(conn, "dev_projects", "workspace_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects ADD COLUMN workspace_id TEXT REFERENCES dev_workspaces(id);",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_knowledge.topic",
            description: "Free-form slash-path taxonomy node for a practice (e.g. 'ui/motion/reveals'), authored by harvest agents. The library derives its arbitrary-depth topic tree from this column; nullable = uncategorized. Added as a separate ALTER so DBs that created workspace_knowledge before this column pick it up.",
            already_applied: |conn| has_column(conn, "workspace_knowledge", "topic"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN topic TEXT;")?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_knowledge.categorization_axes",
            description: "Categorization axes orthogonal to the topic tree, for ranking + filtering the library (docs/plans/workspace-knowledge-center.md, divergence-scan synthesis): `abstraction` (macro|meso|micro — the altitude of the practice), `ftype` (finding-type taxonomy: architecture|module-boundary|data-flow|extensibility|api-design|state-mgmt|error-strategy|concurrency-reliability|perf-strategy|testing-strategy|micro-technique), `durability` (durable|situational|mechanical — whether it's worth being knowledge vs a lint rule), `governing_id` (roll a micro-instance up under a macro doctrine), `evidence_count` (prevalence). All nullable; validation lives in Rust, not a DB CHECK.",
            already_applied: |conn| has_column(conn, "workspace_knowledge", "abstraction"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN abstraction TEXT;")?;
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN ftype TEXT;")?;
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN durability TEXT;")?;
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN governing_id TEXT;")?;
                ddl_step(conn, "ALTER TABLE workspace_knowledge ADD COLUMN evidence_count INTEGER;")?;
                Ok(())
            },
        },
    )?;

    // -- dev_memories: the development loop's project-scoped memory ----------
    // docs/plans/backlog-memory-loop.md Phase 2. Decisions used to land only in
    // `team_memories` (team-keyed), so teamless projects learned nothing and the
    // task executor — which knows a project, not a team — had nothing to read.
    // This is the loop's canonical store; team memory stays the cross-persona
    // ledger and both are written in parallel.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_memories (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            category    TEXT NOT NULL DEFAULT 'learned',
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            importance  INTEGER NOT NULL DEFAULT 5,
            source_kind TEXT NOT NULL DEFAULT 'task_outcome',
            source_id   TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_dev_mem_project  ON dev_memories(project_id);
        CREATE INDEX IF NOT EXISTS idx_dev_mem_recent   ON dev_memories(project_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_dev_mem_category ON dev_memories(project_id, category);
        -- One memory per source event: re-recording the same decision or the
        -- same task's outcome updates nothing and inserts nothing.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_mem_source
            ON dev_memories(project_id, source_kind, source_id)
            WHERE source_id IS NOT NULL;",
    )?;

    // -- workspace_practice_adoption: the `to_process` execution queue -------
    // Adopting a practice used to seed every applicable member repo at
    // `proposed` regardless of what the practice ASKS FOR, so an adopted
    // pitfall ("stop doing X") looked identical to an adopted fact and nothing
    // downstream could tell which cells owed work. Actionable kinds now seed
    // `to_process` (see repos::dev_workspaces::initial_adoption_state) — the
    // queue a future executor drains. SQLite cannot widen a CHECK in place, so
    // the table is rebuilt.
    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_practice_adoption.to_process",
            description: "Widen workspace_practice_adoption.state CHECK with 'to_process' — the per-repo execution queue seeded when an ACTIONABLE practice (pitfall/pattern) is adopted, distinct from 'proposed' (reference material, distributed not executed).",
            already_applied: |conn| {
                let sql: Option<String> = conn
                    .query_row(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name='workspace_practice_adoption'",
                        [],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(AppError::Database)?;
                // A missing table is "applied": the CREATE above already ships
                // the widened CHECK on fresh databases.
                Ok(sql.map(|s| s.contains("to_process")).unwrap_or(true))
            },
            apply: |conn| {
                // FKs off for the drop/rename: the guard must live OUTSIDE the
                // ddl_step transaction — `PRAGMA foreign_keys` is a no-op once
                // a transaction is open.
                let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;
                ddl_step(
                    conn,
                    "DROP TABLE IF EXISTS workspace_practice_adoption_new;
                    CREATE TABLE workspace_practice_adoption_new (
                        practice_id      TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
                        project_id       TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        state            TEXT NOT NULL CHECK(state IN ('na','proposed','to_process','dispatched','adopted','diverged')),
                        fleet_key        TEXT,
                        note             TEXT,
                        last_verified_at TEXT,
                        updated_at       TEXT NOT NULL,
                        PRIMARY KEY (practice_id, project_id)
                    );
                    INSERT INTO workspace_practice_adoption_new
                        SELECT practice_id, project_id, state, fleet_key, note, last_verified_at, updated_at
                        FROM workspace_practice_adoption;
                    DROP TABLE workspace_practice_adoption;
                    ALTER TABLE workspace_practice_adoption_new RENAME TO workspace_practice_adoption;",
                )?;
                Ok(())
            },
        },
    )?;

    // ---------------------------------------------------------------------
    // Ship layer: milestones (Factory L2 → Ship tab)
    //
    // A milestone is a CONVERGENCE CUT over the primitives the scans already
    // generate: use cases join with a bucket (core/later/never), goals bind
    // as measurable objectives, and contexts are never members — they derive
    // from the bound use cases' slices at read time. Progress is likewise
    // derived (use-case states + KPI coverage + context health), so the
    // schema stores decisions, never percentages.
    // ---------------------------------------------------------------------
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_milestones",
            description: "Ship layer: milestones as convergence cuts (roadmap spine + scope membership); progress derives, only decisions are stored",
            already_applied: |conn| has_table(conn, "dev_milestones"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_milestones (
                        id           TEXT PRIMARY KEY,
                        project_id   TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        name         TEXT NOT NULL,
                        goal         TEXT,
                        status       TEXT NOT NULL DEFAULT 'planned'
                                     CHECK(status IN ('planned','active','shipped')),
                        order_index  INTEGER NOT NULL DEFAULT 0,
                        target_date  TEXT,
                        cut_at       TEXT,
                        shipped_at   TEXT,
                        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_milestones_project
                     ON dev_milestones(project_id, status, order_index);",
                )?;
                // Scope membership. One row per (milestone, item); an item
                // belongs to at most one bucket per milestone. `item_kind`
                // 'use_case' rows reference dev_use_cases (the work), 'goal'
                // rows reference dev_goals (the objectives). No FK on item_id
                // because it is polymorphic — orphans are swept at read time,
                // mirroring how context rescans rebuild slices by name.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_milestone_items (
                        milestone_id    TEXT NOT NULL REFERENCES dev_milestones(id) ON DELETE CASCADE,
                        item_kind       TEXT NOT NULL CHECK(item_kind IN ('use_case','goal')),
                        item_id         TEXT NOT NULL,
                        bucket          TEXT NOT NULL DEFAULT 'core'
                                        CHECK(bucket IN ('core','later','never')),
                        added_after_cut INTEGER NOT NULL DEFAULT 0,
                        order_index     INTEGER NOT NULL DEFAULT 0,
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (milestone_id, item_kind, item_id)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_milestone_items_item
                     ON dev_milestone_items(item_kind, item_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- dev_milestones.cut_at backfill -------------------------------------
    // `cut_at` is the scope-creep baseline: items joined after it carry
    // `added_after_cut`. It used to be stamped ONLY on a status transition to
    // 'active' in `update_milestone`, but a milestone created directly active
    // — the seeded "Onboard to Personas" one every project gets — never makes
    // that transition, so its `cut_at` stayed NULL forever and the creep
    // signal never fired on the one milestone most projects will ever have.
    // `create_milestone` now stamps it in the INSERT; this repairs the rows
    // already on disk. Runs immediately after the block that creates the
    // table (has_table guard for the case where that block was skipped), and
    // is naturally idempotent — after one pass no active row has a NULL cut.

    Ok(())
}
