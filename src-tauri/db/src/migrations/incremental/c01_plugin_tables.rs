//! Plugin and workflow tables created unconditionally at boot: composite
//! trigger fires, Artist, Obsidian, MCP gateway, lab Consensus, Twin, and the
//! Composition Workflow surface.
//!
//! Slice of the original `run_incremental` / `ensure_composite_fires_table`
//! body, moved verbatim. The driver calls these modules in the same order
//! the statements appeared in, so the executed step sequence is unchanged.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS composite_trigger_fires (
            trigger_id  TEXT PRIMARY KEY,
            fired_at    TEXT NOT NULL
        );",
    )?;
    // -- Artist plugin tables -------------------------------------------------
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS artist_assets (
            id              TEXT PRIMARY KEY,
            file_name       TEXT NOT NULL,
            file_path       TEXT NOT NULL,
            asset_type      TEXT NOT NULL CHECK(asset_type IN ('2d','3d')),
            mime_type       TEXT,
            file_size       INTEGER NOT NULL DEFAULT 0,
            width           INTEGER,
            height          INTEGER,
            thumbnail_path  TEXT,
            tags            TEXT,
            source          TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_artist_assets_type ON artist_assets(asset_type);
        CREATE INDEX IF NOT EXISTS idx_artist_assets_created ON artist_assets(created_at);

        -- Deduplicate before creating unique index (keep earliest row per file_path)
        DELETE FROM artist_assets WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM artist_assets GROUP BY file_path
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_assets_path ON artist_assets(file_path);

        CREATE TABLE IF NOT EXISTS artist_tags (
            id              TEXT PRIMARY KEY,
            asset_id        TEXT NOT NULL REFERENCES artist_assets(id) ON DELETE CASCADE,
            tag             TEXT NOT NULL,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_artist_tags_asset ON artist_tags(asset_id);
        CREATE INDEX IF NOT EXISTS idx_artist_tags_tag ON artist_tags(tag);",
    )?;

    // ── Obsidian Brain: Sync State & Log ─────────────────────────────
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS obsidian_sync_state (
            id              TEXT PRIMARY KEY,
            entity_type     TEXT NOT NULL,
            entity_id       TEXT NOT NULL,
            vault_file_path TEXT NOT NULL,
            content_hash    TEXT NOT NULL,
            sync_direction  TEXT NOT NULL,
            synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(entity_type, entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_obsidian_sync_entity ON obsidian_sync_state(entity_type, entity_id);

        CREATE TABLE IF NOT EXISTS obsidian_sync_log (
            id              TEXT PRIMARY KEY,
            sync_type       TEXT NOT NULL,
            entity_type     TEXT NOT NULL,
            entity_id       TEXT,
            vault_file_path TEXT,
            action          TEXT NOT NULL,
            details         TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_obsidian_sync_log_created ON obsidian_sync_log(created_at DESC);"
    )?;

    // Companion (Athena) tables live in the user database, not the system
    // database. See `db::COMPANION_SCHEMA` and `db::init_user_db`.

    // -- MCP gateway membership ------------------------------------------------
    // Bundles multiple MCP-speaking credentials under one "gateway" credential so
    // that attaching the gateway to a persona inherits every member's tools. Added
    // 2026-04-08 as part of the LangSmith/Arcade MCP gateway pattern (finding #1
    // from /research run on the same date, see .planning/handoffs/2026-04-08-
    // mcp-gateway-arcade.md for the full phase plan).
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS mcp_gateway_members (
            id                      TEXT PRIMARY KEY,
            gateway_credential_id   TEXT NOT NULL,
            member_credential_id    TEXT NOT NULL,
            display_name            TEXT NOT NULL,
            enabled                 INTEGER NOT NULL DEFAULT 1,
            sort_order              INTEGER NOT NULL DEFAULT 0,
            created_at              TEXT NOT NULL DEFAULT (datetime('now')),
            -- The credentials table is `persona_credentials`. `credentials`
            -- does not exist and never has; SQLite resolves FK targets lazily,
            -- so this CREATE succeeded and every INSERT raised `no such table:
            -- main.credentials` under `foreign_keys = ON` instead. Existing
            -- installs are repaired by `repoint_mcp_gateway_members_fk` at the
            -- end of `run_incremental` (phase 2).
            FOREIGN KEY (gateway_credential_id) REFERENCES persona_credentials(id) ON DELETE CASCADE,
            FOREIGN KEY (member_credential_id) REFERENCES persona_credentials(id) ON DELETE CASCADE,
            UNIQUE (gateway_credential_id, member_credential_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_gw ON mcp_gateway_members(gateway_credential_id);
        CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_member ON mcp_gateway_members(member_credential_id);"
    )?;

    // -- JIT OAuth scaffolding on executions: REMOVED 2026-08-13 ---------------
    // Three `ALTER TABLE executions ADD COLUMN pending_auth_{url,started_at,
    // credential_id}` statements lived here, swallowed by `let _ = ddl_step(…)`.
    // There is no `executions` table (it is `persona_executions`), so all three
    // failed on every boot of every install since 2026-04-08 and the columns
    // have never existed anywhere.
    //
    // Deleted rather than corrected to `persona_executions`, decided from what
    // the code reads: `pending_auth_url` / `pending_auth_started_at` /
    // `pending_auth_credential_id` have ZERO readers and ZERO writers anywhere
    // in the tree — no Rust, no TypeScript, no SQL. The feature that actually
    // shipped, `PendingAuthModal.tsx`, takes its `credential_id` / `tool_name` /
    // `authorize_url` from the `AppError::AuthorizationRequired` error envelope
    // (`extractPendingAuthDetails`), which needs no persistence at all, and the
    // `AwaitingAuth` execution state the columns were scaffolding for was never
    // added to the `ExecutionState` lifecycle. Correcting the table name would
    // have added three permanently-NULL columns to the hottest table in the app.
    // If the runner pause/resume integration is ever built (see
    // `.planning/handoffs/2026-04-08-mcp-gateway-arcade.md` Phase B), it adds
    // its own guarded `run_step` against `persona_executions` at that time.

    // -- Lab: Consensus (stochastic multi-run agreement) ----------------------
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS lab_consensus_runs (
            id              TEXT PRIMARY KEY,
            persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            status          TEXT NOT NULL DEFAULT 'generating',
            num_samples     INTEGER NOT NULL DEFAULT 5,
            model_id        TEXT NOT NULL DEFAULT '',
            scenarios_count INTEGER NOT NULL DEFAULT 0,
            use_case_filter TEXT,
            agreement_rate  REAL,
            summary         TEXT,
            llm_summary     TEXT,
            progress_json   TEXT,
            error           TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_lab_consensus_runs_persona ON lab_consensus_runs(persona_id);

        CREATE TABLE IF NOT EXISTS lab_consensus_results (
            id                   TEXT PRIMARY KEY,
            run_id               TEXT NOT NULL REFERENCES lab_consensus_runs(id) ON DELETE CASCADE,
            sample_index         INTEGER NOT NULL DEFAULT 0,
            scenario_name        TEXT NOT NULL,
            model_id             TEXT NOT NULL,
            provider             TEXT NOT NULL DEFAULT '',
            status               TEXT NOT NULL DEFAULT 'pending',
            output_preview       TEXT,
            -- tool_calls_expected/actual retired in lab_tool_calls ADR.
            tool_accuracy_score  INTEGER,
            output_quality_score INTEGER,
            protocol_compliance  INTEGER,
            input_tokens         INTEGER NOT NULL DEFAULT 0,
            output_tokens        INTEGER NOT NULL DEFAULT 0,
            cost_usd             REAL NOT NULL DEFAULT 0.0,
            duration_ms          INTEGER NOT NULL DEFAULT 0,
            rationale            TEXT,
            suggestions          TEXT,
            error_message        TEXT,
            created_at           TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_lab_consensus_results_run ON lab_consensus_results(run_id);",
    )?;

    // -- dev_tasks: depth column (quick / campaign / deep_build) ---------------
    ddl_step(
        conn,
        "ALTER TABLE dev_tasks ADD COLUMN depth TEXT NOT NULL DEFAULT 'quick';",
    )
    .ok(); // ok() — column may already exist

    // -- dev_tasks: retry lineage (parent_task_id + attempt) ------------------
    // A retry used to be an unrelated task with a `[Retry] ` title prefix, so
    // nothing linked attempt N to attempt N-1 and the prefix accumulated into
    // the executor's prompt. Lineage is now structural. Same `.ok()` idiom as
    // `depth` above: both are also mirrored in the fresh schema, so on a new
    // database these ALTERs are expected to be duplicate-column no-ops.
    ddl_step(
        conn,
        "ALTER TABLE dev_tasks ADD COLUMN parent_task_id TEXT;",
    )
    .ok();
    ddl_step(
        conn,
        "ALTER TABLE dev_tasks ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;",
    )
    .ok();

    // -- dev_projects: monitoring connector fields ----------------------------
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN monitoring_credential_id TEXT;",
    )
    .ok();
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN monitoring_project_slug TEXT;",
    )
    .ok();

    // -- dev_projects: LLM-observability connector slot -----------------------
    // A dedicated credential pointer for LLM tracking (Langfuse / Helicone /
    // LangSmith / …), kept distinct from `monitoring_credential_id` (app
    // monitoring). Nullable; set via dev_tools_update_project. Added 2026-06-23.
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN llm_tracking_credential_id TEXT;",
    )
    .ok();

    // -- dev_projects: customer-support connector slot + data-analysis links --
    // `support_credential_id`: credential pointer for the incoming customer-
    // support channel (Discord / Gmail / Outlook …) — drives the passport's
    // Support dimension. `data_links`: JSON array of related dev_project ids
    // whose codebase post-processes this project's data (user-declared for
    // now; a future scan may propose them) — drives the passport's
    // Data-analysis dimension. Both nullable; set via dev_tools_update_project.
    // Added 2026-07-23.
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN support_credential_id TEXT;",
    )
    .ok();
    ddl_step(conn, "ALTER TABLE dev_projects ADD COLUMN data_links TEXT;").ok();

    // -- dev_projects: static_scan_config -------------------------------------
    // JSON envelope { tool: "fallow"|"knip"|..., command: [..argv..] } that
    // configures which static-analysis CLI the static_scan runner spawns for
    // this project. Sibling to the LLM-driven idea_scanner — see
    // commands/infrastructure/static_scan.rs.
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN static_scan_config TEXT;",
    )
    .ok();

    // -- dev_projects: auto-PR-on-success gate + GitHub credential pointer ---
    // When `auto_pr_on_success = 1` and a task ran inside a worktree, the
    // task_executor's success branch pushes the worktree branch and opens a
    // PR via `engine/platforms/github.rs::GitHubClient::create_pull_request`.
    // The credential is resolved from `pr_credential_id`. Both columns are
    // nullable / default-off so existing projects are unaffected.
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN auto_pr_on_success INTEGER NOT NULL DEFAULT 0;",
    )
    .ok();
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN pr_credential_id TEXT;",
    )
    .ok();

    // -- dev_projects: living test environment (URL + branch the team delivers into)
    // Both nullable / no default so existing projects are unaffected. Set later
    // via dev_tools_update_project once the team has a running test env to point at.
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN test_env_url TEXT;",
    )
    .ok();
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN test_env_branch TEXT;",
    )
    .ok();

    // -- dev_projects: primary/default branch (the source-control pipeline stage's
    // baseline, e.g. `main`/`master`). Nullable / no default; set via
    // dev_tools_update_project. Existing projects unaffected.
    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN main_branch TEXT;",
    )
    .ok();

    // -- dev_projects: standards & branching policy (Pipeline Stage 3). Opaque
    // JSON envelope { precommit, branching } set via dev_tools_set_standards_config;
    // the connected team's personas must respect it. Nullable / no default.
    // -- dev_ideas: strategist triage rank (1 = do next). Written by the
    // backlog-triage job (Product Strategist); backlog_to_goal promotes ranked
    // ideas first. Nullable — unranked ideas fall back to impact/effort order.
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN priority INTEGER;").ok();

    // -- dev_ideas: the FINDINGS SPINE (docs/plans/dev-findings-loop.md §3 2A).
    // An idea is no longer only a scanner proposal — every sensor (golden-standard
    // scan, passport gap, LLM cost, Sentry spike, off-track KPI) emits into this
    // table so the existing triage → task → PR → scoreboard machinery becomes
    // multi-sensor. All four columns are additive and nullable; a NULL `origin`
    // IS a classic Idea-Scanner idea, so every existing row and call site keeps
    // working untouched.
    //   origin      — 'standards_finding' | 'passport_gap' | 'llm_cost'
    //                 | 'sentry_spike' | 'kpi_offtrack' (validated in Rust).
    //   use_case_id — the emitting signal's use case. Orphan-tolerant, no FK
    //                 (same rationale as dev_projects.team_id).
    //   evidence    — JSON blob: the raw numbers that justified emission. Phase 3's
    //                 verification probe re-measures against these, so they must
    //                 stay comparable.
    //   dedup_key   — stable per underlying signal ('sentry:<shortId>',
    //                 'standards:<rule_key>', …). Idempotent emission: a sweep
    //                 never re-raises a finding that already exists in ANY status,
    //                 including `rejected` — a human "no" is durable.
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN origin TEXT;").ok();
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN use_case_id TEXT;").ok();
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN evidence TEXT;").ok();
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN dedup_key TEXT;").ok();
    // (The non-unique idx_dev_ideas_dedup this step used to create was replaced
    // by the partial UNIQUE index below — see the dedup-TOCTOU block.)

    // -- dev_ideas: VERIFICATION (docs/plans/dev-findings-loop.md §7, Phase 3A).
    // Nothing in the app checked whether shipped work moved the number that raised
    // the finding — "merged" was silently treated as "fixed". These close that:
    //   verify_state     — 'pending' | 'cleared' | 'moved' | 'unchanged' | 'regressed'.
    //                      NULL/pending = not yet judged. `unchanged` and `regressed`
    //                      are first-class outcomes, surfaced as loudly as `cleared`.
    //   verify_checked_at— when the last verdict was taken.
    //   verify_evidence  — the RE-MEASURED reading (same shape as `evidence`), so a
    //                      verdict can be audited: before vs after, side by side.
    // The probe is the sweep itself: emitters only fire when a signal is OVER
    // threshold, so a fresh emit that no longer carries the finding's dedup_key means
    // the signal is gone (= cleared).
    ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN verify_state TEXT;").ok();
    ddl_step(
        conn,
        "ALTER TABLE dev_ideas ADD COLUMN verify_checked_at TEXT;",
    )
    .ok();
    ddl_step(
        conn,
        "ALTER TABLE dev_ideas ADD COLUMN verify_evidence TEXT;",
    )
    .ok();

    // -- GAP-W2 (double-advance TOCTOU): at most ONE active assignment per
    // goal, enforced at the DB level. advance_goal's guard reads, then spends
    // seconds in LLM decomposition, then creates — two near-simultaneous
    // initiations (manual + autonomous tick, or two ticks) both passed the
    // stale guard and double-implemented the same goal. The partial unique
    // index makes the second create fail instead.
    ddl_step(
        conn,
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_assignment_per_goal
         ON team_assignments(goal_id)
         WHERE goal_id IS NOT NULL AND status IN ('queued','running','awaiting_review');",
    )
    .ok();

    // -- dedup_key TOCTOU (same class as GAP-W2 above): create_idea_deduped /
    // create_finding used a COUNT-then-INSERT guard with no transaction — two
    // concurrent sweeps both passed and both inserted. DB-enforce it, the way
    // audit_incidents.dedup_key already is. Hand-written ideas carry NULL
    // dedup_key (SQLite treats NULLs as distinct), so the partial index is
    // safe. First null-out any later duplicates a past race already produced
    // (keep the oldest row), or the index creation would fail.
    conn.execute(
        "UPDATE dev_ideas SET dedup_key = NULL
          WHERE dedup_key IS NOT NULL
            AND rowid NOT IN (
              SELECT MIN(rowid) FROM dev_ideas
               WHERE dedup_key IS NOT NULL
               GROUP BY project_id, dedup_key)",
        [],
    )
    .ok();
    ddl_step(
        conn,
        "DROP INDEX IF EXISTS idx_dev_ideas_dedup;
         CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_ideas_dedup_unique
             ON dev_ideas(project_id, dedup_key)
             WHERE dedup_key IS NOT NULL;",
    )
    .ok();

    ddl_step(
        conn,
        "ALTER TABLE dev_projects ADD COLUMN standards_config TEXT;",
    )
    .ok();

    // -- dev_standards: per-rule compliance findings from the golden-standard
    // LLM scan (Pipeline Stage 3b). One row per rule the scan checks.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_standards (
            id            TEXT PRIMARY KEY,
            project_id    TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            scan_id       TEXT,
            rule_key      TEXT NOT NULL,
            category      TEXT NOT NULL,
            title         TEXT NOT NULL,
            status        TEXT NOT NULL,
            severity      TEXT NOT NULL DEFAULT 'info',
            evidence      TEXT,
            recommendation TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );
         CREATE INDEX IF NOT EXISTS idx_dev_standards_project ON dev_standards(project_id);",
    )
    .ok();

    // -- audit_incidents: auto-continuation guard (P2.3b).
    // Nullable timestamp stamped when the incident-continuation reactive loop
    // re-runs the blocked work. NULL = not yet continued. The consumer claims a
    // resolved persona_blocker incident atomically via
    // `UPDATE ... SET continued_at = ? WHERE id = ? AND continued_at IS NULL`,
    // so a tick can never double-fire a re-run. Idempotent ALTER (re-run safe).
    ddl_step(
        conn,
        "ALTER TABLE audit_incidents ADD COLUMN continued_at TEXT;",
    )
    .ok();

    // ── Composition Workflows (persisted DAG definitions) ───────────────
    // Migrates workflows from frontend localStorage to backend SQLite.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS composition_workflows (
            id               TEXT PRIMARY KEY,
            name             TEXT NOT NULL,
            description      TEXT NOT NULL DEFAULT '',
            nodes_json       TEXT NOT NULL DEFAULT '[]',
            edges_json       TEXT NOT NULL DEFAULT '[]',
            input_schema_json TEXT,
            enabled          INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_composition_workflows_enabled ON composition_workflows(enabled);
        CREATE INDEX IF NOT EXISTS idx_composition_workflows_updated ON composition_workflows(updated_at);"
    )?;

    // -- Twin plugin: digital twin profiles (P0) -----------------------------
    // First slice of the Twin plugin. Multi-twin from day one (the user can
    // have a Founder Twin and a Personal Twin); exactly one is_active row is
    // resolved by the `builtin-twin` connector when a persona invokes a twin
    // tool. Tone, voice, channels, and memory tables land in P1-P4. The slug
    // is unique because it doubles as the Obsidian vault subfolder name.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_profiles (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            slug            TEXT NOT NULL UNIQUE,
            bio             TEXT,
            role            TEXT,
            languages       TEXT,
            pronouns        TEXT,
            obsidian_subpath TEXT NOT NULL,
            is_active       INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_twin_profiles_active ON twin_profiles(is_active);",
    )?;

    // -- Twin plugin: per-channel tone profiles (P1) -------------------------
    // Each twin can speak differently on each channel. The `generic` row is
    // the default fallback. UNIQUE(twin_id, channel) enforces at most one
    // tone per (twin, channel) pair.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_tones (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            channel         TEXT NOT NULL DEFAULT 'generic',
            voice_directives TEXT NOT NULL DEFAULT '',
            examples_json   TEXT,
            constraints_json TEXT,
            length_hint     TEXT,
            updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(twin_id, channel)
        );
        CREATE INDEX IF NOT EXISTS idx_twin_tones_twin ON twin_tones(twin_id);",
    )?;

    // -- Twin plugin: knowledge_base_id on profiles (P2) ---------------------
    // `has_column` rather than a discarded Result: the guard removes the
    // "duplicate column" re-run error this used to absorb, so a real failure is
    // no longer indistinguishable from a successful no-op. `twin_profiles` is
    // created a few steps above in this same function, so it always exists here.
    if !has_column(conn, "twin_profiles", "knowledge_base_id")? {
        ddl_step(
            conn,
            "ALTER TABLE twin_profiles ADD COLUMN knowledge_base_id TEXT;",
        )?;
    }

    // -- Twin plugin: persistent training directives (D5 — self-sharpening) --
    // Free-text "training style guide" per twin. The Training Studio seeds its
    // Directions box from this and can save edits back; every question/answer
    // generation prepends it so the studio learns the user's taste instead of
    // restating it each session.
    if !has_column(conn, "twin_profiles", "training_directives")? {
        ddl_step(
            conn,
            "ALTER TABLE twin_profiles ADD COLUMN training_directives TEXT;",
        )?;
    }

    // -- Twin plugin: pending memories inbox (P2) ----------------------------
    // Human-approval gate for memories. record_interaction writes here; the
    // user approves/rejects in the Knowledge tab. Approved memories get
    // ingested into the twin's knowledge base.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS twin_pending_memories (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            channel         TEXT,
            content         TEXT NOT NULL,
            title           TEXT,
            importance      INTEGER NOT NULL DEFAULT 3,
            status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
            reviewer_notes  TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            reviewed_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_twin_pending_twin ON twin_pending_memories(twin_id);
        CREATE INDEX IF NOT EXISTS idx_twin_pending_status ON twin_pending_memories(status);"
    )?;

    // -- Twin plugin: communication log (P2) ---------------------------------
    // Interaction log — what the twin said and received across channels.
    ddl_step(
                    conn,
                        "CREATE TABLE IF NOT EXISTS twin_communications (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            channel         TEXT NOT NULL,
            direction       TEXT NOT NULL DEFAULT 'out' CHECK(direction IN ('in','out')),
            contact_handle  TEXT,
            content         TEXT NOT NULL,
            summary         TEXT,
            key_facts_json  TEXT,
            occurred_at     TEXT NOT NULL DEFAULT (datetime('now')),
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_twin_comms_twin ON twin_communications(twin_id);
        CREATE INDEX IF NOT EXISTS idx_twin_comms_occurred ON twin_communications(occurred_at DESC);"
    )?;

    // -- Twin plugin: voice profiles (P3) ------------------------------------
    // One voice config per twin. Stores the provider, voice_id, and synthesis
    // parameters. UNIQUE(twin_id) enforces one voice per twin.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_voice_profiles (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL UNIQUE REFERENCES twin_profiles(id) ON DELETE CASCADE,
            provider        TEXT NOT NULL DEFAULT 'elevenlabs',
            credential_id   TEXT,
            voice_id        TEXT NOT NULL,
            model_id        TEXT,
            stability       REAL NOT NULL DEFAULT 0.5,
            similarity_boost REAL NOT NULL DEFAULT 0.75,
            style           REAL NOT NULL DEFAULT 0.0,
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    // -- Twin plugin: channel bindings (P4) ----------------------------------
    // Maps a twin to its deployment channels. Each row = one channel where
    // the twin speaks, via a credential (e.g. Discord bot token) and
    // optionally a persona that operates there.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_channels (
            id              TEXT PRIMARY KEY,
            twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            channel_type    TEXT NOT NULL,
            credential_id   TEXT NOT NULL,
            persona_id      TEXT,
            label           TEXT,
            is_active       INTEGER NOT NULL DEFAULT 1,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(twin_id, channel_type, credential_id)
        );
        CREATE INDEX IF NOT EXISTS idx_twin_channels_twin ON twin_channels(twin_id);",
    )?;

    // -- eval_method column on all lab result tables ----------------------------
    // Tracks whether scores came from full LLM evaluation, heuristic fallback, or timeout.
    for table in &[
        "lab_arena_results",
        "lab_ab_results",
        "lab_matrix_results",
        "lab_eval_results",
    ] {
        let _ = ddl_step(
            conn,
            &format!("ALTER TABLE {table} ADD COLUMN eval_method TEXT;"),
        );
    }

    // -- adoption_answers column on build_sessions --------------------------------
    // Stores questionnaire answers so they flow into test + promote pipelines.
    let has_adoption_answers: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('build_sessions') WHERE name = 'adoption_answers'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_adoption_answers {
        ddl_step(
            conn,
            "ALTER TABLE build_sessions ADD COLUMN adoption_answers TEXT;",
        )?;
        tracing::info!("Added adoption_answers column to build_sessions");
    }

    // -- traceparent column on persona_executions (CLI 2.1.110 TRACEPARENT) ------
    // W3C traceparent generated per execution and injected into the spawned CLI's
    // env so personas' own span tree can be correlated with the CLI's internal
    // API/tool call spans by downstream observability pipelines.
    let has_traceparent: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'traceparent'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_traceparent {
        ddl_step(
            conn,
            "ALTER TABLE persona_executions ADD COLUMN traceparent TEXT;",
        )?;
        tracing::info!("Added traceparent column to persona_executions");
    }

    // -- last_test_report column on personas (A-grade Phase 2) -------------------
    // Stores the JSON test report from `test_build_draft`'s last run so the
    // UI's TestReportModal can render real per-tool / per-connector results
    // *after* promote, and so the rapid-validation suite's
    // `acceptance.tool_tests` gate has something to read. Pre-Phase-2 the
    // report was returned inline by `triggerBuildTest` and never persisted —
    // navigating away dropped it. See
    // `docs/concepts/persona-capabilities/13-rapid-validation-personas.md`
    // §"Phase 2 (test-pass visibility)".
    let has_last_test_report: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'last_test_report'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_last_test_report {
        ddl_step(
            conn,
            "ALTER TABLE personas ADD COLUMN last_test_report TEXT;",
        )?;
        tracing::info!("Added last_test_report column to personas");
    }

    // -- Phase 5 v1: CLI session-resume awareness opt-in -----------------------
    // Per-persona gate for reading the user's active Claude CLI transcript and
    // injecting recent turns as a prompt prefix (alongside Phase 3 c ambient
    // context). Defaults to 0 (OFF) — must be paired with the global
    // cli_session toggle on AmbientContextFusion to actually fire.
    // See docs/features/companion/athena-cli-session-awareness.md.
    let has_cli_awareness: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'cli_awareness_enabled'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_cli_awareness {
        ddl_step(
            conn,
            "ALTER TABLE personas ADD COLUMN cli_awareness_enabled INTEGER NOT NULL DEFAULT 0;",
        )?;
        tracing::info!("Added cli_awareness_enabled column to personas (Phase 5 v1)");
    }

    // -- Per-persona Langfuse export gate ---------------------------------------
    // Default 1 (ON): existing personas continue exporting traces if the user
    // has the Langfuse plugin enabled and a connection configured. The toggle
    // on the persona settings tab lets users opt INDIVIDUAL personas out of
    // export — useful for personas handling sensitive content the user doesn't
    // want shipped, even when the plugin's global redact_content is off.
    let has_langfuse_export: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'langfuse_export_enabled'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_langfuse_export {
        conn.execute_batch(
            "ALTER TABLE personas ADD COLUMN langfuse_export_enabled INTEGER NOT NULL DEFAULT 1;",
        )?;
        tracing::info!("Added langfuse_export_enabled column to personas");
    }

    // -- Drop retired desktop-bridge catalog entries -----------------------------
    // `desktop_terminal` and `desktop_vscode` were removed from the credential
    // catalog; existing installs may still have the seeded rows. Remove them so
    // they stop appearing in the picker. Only builtin rows are touched — any
    // user credentials referencing them via the canonical tables remain intact.
    conn.execute(
        "DELETE FROM connector_definitions WHERE name IN ('desktop_terminal','desktop_vscode') AND is_builtin = 1",
        [],
    )?;

    // -- Resource scoping: scoped_resources blob on persona_credentials ----------
    // Post-auth picker stores user-selected sub-resources (GitHub repos, Supabase
    // projects, Google Drive folders, etc.) as a JSON blob alongside the credential.
    // Plaintext (not field-level encrypted) because identifiers are not secrets;
    // the auth fields that grant access live in credential_fields and stay
    // encrypted. Default NULL = broad scope (feature is opt-in; existing rows are
    // unaffected).
    let has_scoped_resources: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_credentials') WHERE name = 'scoped_resources'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_scoped_resources {
        ddl_step(
            conn,
            "ALTER TABLE persona_credentials ADD COLUMN scoped_resources TEXT;",
        )?;
        tracing::info!("Added scoped_resources column to persona_credentials");
    }

    // -- Connector resources spec: resources column on connector_definitions -----
    // JSON array describing how to list user-pickable sub-resources (repos,
    // projects, etc.). Seeded from scripts/connectors/builtin/*.json `resources[]`.
    // See src-tauri/src/db/models/connector.rs for the typed shape.
    let has_connector_resources: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('connector_definitions') WHERE name = 'resources'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_connector_resources {
        ddl_step(
            conn,
            "ALTER TABLE connector_definitions ADD COLUMN resources TEXT;",
        )?;
        tracing::info!("Added resources column to connector_definitions");
    }

    // -- Lab: per-result event stream (typed sequence captured during lab runs) --
    // Each lab scenario produces a stream of typed events (assistant text, tool
    // use with args, tool result, system_init, result). The lab result table
    // stores only aggregate scores + tool name list; events sit in a sidecar
    // table so the ScenarioDetailPanel can render the actual conversation when
    // a row scored low. result_kind disambiguates which lab table the
    // result_id points at (eval/ab/arena/matrix/consensus). Forward-only —
    // older results have no events. Truncated payloads at the boundary so a
    // single chatty scenario can't blow up the DB.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS lab_result_events (
            id                  TEXT PRIMARY KEY,
            result_id           TEXT NOT NULL,
            result_kind         TEXT NOT NULL,
            event_index         INTEGER NOT NULL,
            event_type          TEXT NOT NULL,
            tool_name           TEXT,
            tool_args_preview   TEXT,
            tool_result_preview TEXT,
            text_preview        TEXT,
            ts_ms_relative      INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_lab_result_events_lookup
            ON lab_result_events(result_kind, result_id, event_index);",
    )?;

    // -- Dev Tools: per-file content-hash cache for incremental rescan ----------
    // Populated by `commands/infrastructure/context_generation.rs` after a
    // successful scan. On the next scan, `commands/infrastructure/incremental_scan.rs`
    // diffs the live file tree against this table and feeds the LLM only the
    // {added, modified, deleted} delta — unchanged regions short-circuit. PK is
    // (project_id, file_path) because file_path is unique per project but the
    // same relative path may exist in multiple projects.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_context_file_hashes (
            project_id          TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            file_path           TEXT NOT NULL,
            sha256              TEXT NOT NULL,
            size_bytes          INTEGER NOT NULL DEFAULT 0,
            last_extracted_at   TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (project_id, file_path)
        );
        CREATE INDEX IF NOT EXISTS idx_dev_context_file_hashes_project
            ON dev_context_file_hashes(project_id);",
    )?;

    // -- System-operation automations -------------------------------------------
    // A trigger (schedule cron OR event listener) bound to a built-in system
    // operation (NOT a persona execution). First op: `context_scan` (re-derive a
    // dev-tools project's context map). Committed by the Chain Studio when a
    // route runs `schedule|event → System event`, and by the Context Map "Plan
    // update" button. The background event-bus tick runs due schedule rows and
    // matches event rows; see `engine/system_ops.rs`.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS system_op_automations (
            id                  TEXT PRIMARY KEY,
            op_kind             TEXT NOT NULL,
            params_json         TEXT NOT NULL DEFAULT '{}',
            trigger_kind        TEXT NOT NULL,
            cron                TEXT,
            timezone            TEXT,
            listen_event_type   TEXT,
            source_filter       TEXT,
            enabled             INTEGER NOT NULL DEFAULT 1,
            next_run_at         TEXT,
            last_run_at         TEXT,
            last_status         TEXT,
            last_detail         TEXT,
            label               TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_system_op_automations_due
            ON system_op_automations(trigger_kind, enabled, next_run_at);
        CREATE INDEX IF NOT EXISTS idx_system_op_automations_event
            ON system_op_automations(trigger_kind, enabled, listen_event_type);",
    )?;

    // `unattended_mode` (`auto` | `approval`): the safety gate for system-op
    // automations that act on production signal (the signal-dispatch ops).
    // `approval` holds the run (`last_status = "held"`) instead of dispatching;
    // the human dispatches from Triage. Default `auto` preserves the behavior
    // existing rows already had.

    Ok(())
}
