use rusqlite::Connection;

use crate::error::AppError;

use super::schema::SCHEMA;

/// Run the consolidated schema migration.
/// All 11 Vibeman migrations (090--112) are merged into a single idempotent schema.
pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    tracing::debug!("Running database migrations");

    // Pre-schema migrations: add columns that the SCHEMA's CREATE INDEX statements depend on.
    // These must run before SCHEMA so that indexes on new columns don't fail for existing DBs.
    let _ = conn.execute_batch(
        "ALTER TABLE persona_messages ADD COLUMN thread_id TEXT;"
    ); // ignore "duplicate column" error on re-run
    let _ = conn.execute_batch(
        "ALTER TABLE dev_goals ADD COLUMN parent_goal_id TEXT REFERENCES dev_goals(id) ON DELETE SET NULL;"
    ); // ignore "duplicate column" error on re-run

    // Competition slot diff metadata + auto-DQ (safe to run on existing DBs)
    let _ = conn.execute_batch(
        "ALTER TABLE dev_competition_slots ADD COLUMN disqualified INTEGER NOT NULL DEFAULT 0;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE dev_competition_slots ADD COLUMN disqualify_reason TEXT;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE dev_competition_slots ADD COLUMN diff_hash TEXT;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE dev_competition_slots ADD COLUMN diff_stats_json TEXT;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE dev_competition_slots ADD COLUMN diff_analyzed_at TEXT;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE dev_competitions ADD COLUMN winner_insight TEXT;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE dev_competitions ADD COLUMN baseline_json TEXT;"
    );

    conn.execute_batch(SCHEMA)?;

    // -- Smee Relay management table ------------------------------------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS smee_relays (
            id              TEXT PRIMARY KEY,
            label           TEXT NOT NULL,
            channel_url     TEXT NOT NULL UNIQUE,
            status          TEXT NOT NULL DEFAULT 'active',
            event_filter    TEXT,
            target_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
            events_relayed  INTEGER NOT NULL DEFAULT 0,
            last_event_at   TEXT,
            error           TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_smee_relays_status ON smee_relays(status);"
    )?;

    // -- Lab User Ratings table -----------------------------------------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS lab_user_ratings (
            id              TEXT PRIMARY KEY,
            run_id          TEXT NOT NULL,
            result_id       TEXT,
            scenario_name   TEXT NOT NULL,
            rating          INTEGER NOT NULL CHECK(rating IN (-1, 0, 1)),
            feedback        TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_lab_ratings_run ON lab_user_ratings(run_id);"
    )?;

    // -- Extend persona_prompt_versions with full persona snapshot fields ------
    for col in &[
        "ALTER TABLE persona_prompt_versions ADD COLUMN design_context TEXT;",
        "ALTER TABLE persona_prompt_versions ADD COLUMN last_design_result TEXT;",
        "ALTER TABLE persona_prompt_versions ADD COLUMN resolved_cells TEXT;",
        "ALTER TABLE persona_prompt_versions ADD COLUMN icon TEXT;",
        "ALTER TABLE persona_prompt_versions ADD COLUMN color TEXT;",
    ] {
        let _ = conn.execute_batch(col); // ignore "duplicate column" errors
    }

    // -- Deployment history for GitLab integration ----------------------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS deployment_history (
            id              TEXT PRIMARY KEY,
            persona_id      TEXT NOT NULL,
            persona_name    TEXT NOT NULL,
            project_id      INTEGER NOT NULL,
            method          TEXT NOT NULL,
            credentials_provisioned INTEGER NOT NULL DEFAULT 0,
            deploy_result   TEXT NOT NULL DEFAULT 'success',
            agent_id        TEXT,
            web_url         TEXT,
            snapshot_prompt TEXT,
            rolled_back_from TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_deploy_hist_persona_project
            ON deployment_history(persona_id, project_id);
        CREATE INDEX IF NOT EXISTS idx_deploy_hist_created
            ON deployment_history(created_at DESC);"
    )?;

    // -- Immutable ExecutionConfig snapshot per execution ----------------------
    let _ = conn.execute_batch(
        "ALTER TABLE persona_executions ADD COLUMN execution_config TEXT;"
    ); // ignore "duplicate column" error on re-run

    // -- Alert Rules (moved from frontend localStorage to backend DB) ----------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS alert_rules (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            metric      TEXT NOT NULL,
            operator    TEXT NOT NULL,
            threshold   REAL NOT NULL,
            severity    TEXT NOT NULL DEFAULT 'warning',
            persona_id  TEXT,
            enabled     INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);

        CREATE TABLE IF NOT EXISTS fired_alerts (
            id          TEXT PRIMARY KEY,
            rule_id     TEXT NOT NULL,
            rule_name   TEXT NOT NULL,
            metric      TEXT NOT NULL,
            severity    TEXT NOT NULL,
            message     TEXT NOT NULL,
            value       REAL NOT NULL,
            threshold   REAL NOT NULL,
            persona_id  TEXT,
            fired_at    TEXT NOT NULL DEFAULT (datetime('now')),
            dismissed   INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_fired_alerts_fired_at ON fired_alerts(fired_at DESC);
        CREATE INDEX IF NOT EXISTS idx_fired_alerts_rule_id ON fired_alerts(rule_id);"
    )?;

    // -- Trust score for graduated autonomy (Agent Trust Ladder) ---------------
    let _ = conn.execute_batch(
        "ALTER TABLE personas ADD COLUMN trust_score REAL NOT NULL DEFAULT 0.0;"
    ); // ignore "duplicate column" error on re-run

    // -- Shared Events Marketplace: catalog cache + subscriptions ---------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS shared_event_catalog (
            id               TEXT PRIMARY KEY,
            slug             TEXT NOT NULL UNIQUE,
            name             TEXT NOT NULL,
            description      TEXT,
            category         TEXT NOT NULL DEFAULT 'general',
            publisher        TEXT,
            icon             TEXT,
            color            TEXT,
            sample_payload   TEXT,
            event_schema     TEXT,
            subscriber_count INTEGER NOT NULL DEFAULT 0,
            is_featured      INTEGER NOT NULL DEFAULT 0,
            status           TEXT NOT NULL DEFAULT 'active',
            cloud_updated_at TEXT,
            cached_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_shared_catalog_category ON shared_event_catalog(category);
        CREATE INDEX IF NOT EXISTS idx_shared_catalog_slug ON shared_event_catalog(slug);

        CREATE TABLE IF NOT EXISTS shared_event_subscriptions (
            id               TEXT PRIMARY KEY,
            catalog_entry_id TEXT NOT NULL REFERENCES shared_event_catalog(id) ON DELETE CASCADE,
            slug             TEXT NOT NULL,
            enabled          INTEGER NOT NULL DEFAULT 1,
            last_cursor      TEXT,
            events_relayed   INTEGER NOT NULL DEFAULT 0,
            last_event_at    TEXT,
            error            TEXT,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_subs_catalog ON shared_event_subscriptions(catalog_entry_id);
        CREATE INDEX IF NOT EXISTS idx_shared_subs_enabled ON shared_event_subscriptions(enabled);"
    )?;

    // -- Shared Event Analytics --------------------------------------------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS shared_event_analytics (
            slug             TEXT PRIMARY KEY,
            total_received   INTEGER NOT NULL DEFAULT 0,
            total_failed     INTEGER NOT NULL DEFAULT 0,
            total_bytes      INTEGER NOT NULL DEFAULT 0,
            last_received_at TEXT,
            hourly_buckets   TEXT NOT NULL DEFAULT '[]',
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );"
    )?;

    // thread_id migration moved to pre-schema block (top of run())

    // -- Dead Letter Queue: add retry_count to persona_events ----------------
    let _ = conn.execute_batch(
        "ALTER TABLE persona_events ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;"
    ); // ignore "duplicate column" error on re-run

    // -- Composite trigger suppression persistence ----------------------------
    super::ensure_composite_fires_table(conn)?;

    // -- Normalize camelCase credential field keys to snake_case ---------------
    // Existing credentials may store "refreshToken" instead of "refresh_token".
    // This one-time migration renames them so all code can use a single key.
    super::helpers::normalize_credential_field_keys(conn)?;

    // -- Track whether execution log files may be incomplete ------------------
    let _ = conn.execute_batch(
        "ALTER TABLE persona_executions ADD COLUMN log_truncated INTEGER NOT NULL DEFAULT 0;"
    ); // ignore "duplicate column" error on re-run

    // -- Enforce at most one production version per persona --------------------
    // Before creating the unique index, fix any existing violations by keeping
    // only the highest-version-number production row per persona.
    conn.execute_batch(
        "UPDATE persona_prompt_versions SET tag = 'experimental'
         WHERE tag = 'production'
           AND id NOT IN (
               SELECT id FROM (
                   SELECT id, ROW_NUMBER() OVER (
                       PARTITION BY persona_id ORDER BY version_number DESC
                   ) AS rn
                   FROM persona_prompt_versions
                   WHERE tag = 'production'
               ) WHERE rn = 1
           );"
    )?;
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ppv_one_production
         ON persona_prompt_versions(persona_id) WHERE tag = 'production';"
    )?;

    // -- Healing audit log (surface silent failures) --------------------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS healing_audit_log (
            id              TEXT PRIMARY KEY,
            persona_id      TEXT,
            execution_id    TEXT,
            event_type      TEXT NOT NULL,
            subsystem       TEXT NOT NULL,
            message         TEXT NOT NULL,
            detail          TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_hal_persona  ON healing_audit_log(persona_id);
        CREATE INDEX IF NOT EXISTS idx_hal_created  ON healing_audit_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_hal_type     ON healing_audit_log(event_type);"
    )?;

    // -- Add github_url to dev_projects ----------------------------------------
    let _ = conn.execute_batch(
        "ALTER TABLE dev_projects ADD COLUMN github_url TEXT;"
    ); // ignore "duplicate column" error on re-run

    // -- Index on n8n_transform_sessions(status, updated_at DESC) for list queries
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_nts_status_updated ON n8n_transform_sessions(status, updated_at DESC);"
    )?;

    // -- Composable Agent Skills ------------------------------------------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skills (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            version     TEXT NOT NULL DEFAULT '1.0.0',
            description TEXT,
            category    TEXT,
            is_builtin  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(name, version)
        );
        CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);

        CREATE TABLE IF NOT EXISTS skill_components (
            id              TEXT PRIMARY KEY,
            skill_id        TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            component_type  TEXT NOT NULL,
            component_data  TEXT NOT NULL,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_skill_components_skill ON skill_components(skill_id);

        CREATE TABLE IF NOT EXISTS persona_skills (
            id          TEXT PRIMARY KEY,
            persona_id  TEXT NOT NULL,
            skill_id    TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            enabled     INTEGER NOT NULL DEFAULT 1,
            config      TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(persona_id, skill_id)
        );
        CREATE INDEX IF NOT EXISTS idx_persona_skills_persona ON persona_skills(persona_id);
        CREATE INDEX IF NOT EXISTS idx_persona_skills_skill ON persona_skills(skill_id);"
    )?;

    // -- A2A Gateway: external API keys for management API auth ---------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS external_api_keys (
            id            TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            key_hash      TEXT NOT NULL UNIQUE,
            key_prefix    TEXT NOT NULL,
            scopes        TEXT NOT NULL DEFAULT '[]',
            enabled       INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            last_used_at  TEXT,
            revoked_at    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_external_api_keys_hash ON external_api_keys(key_hash);
        CREATE INDEX IF NOT EXISTS idx_external_api_keys_prefix ON external_api_keys(key_prefix);"
    )?;

    // -- A2A Gateway: gateway_exposure column on personas (default local_only) -
    let _ = conn.execute_batch(
        "ALTER TABLE personas ADD COLUMN gateway_exposure TEXT NOT NULL DEFAULT 'local_only';"
    ); // ignore "duplicate column" error on re-run

    // -- Research Lab plugin tables -------------------------------------------
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS research_projects (
            id                  TEXT PRIMARY KEY,
            name                TEXT NOT NULL,
            description         TEXT,
            domain              TEXT,
            status              TEXT NOT NULL DEFAULT 'scoping',
            thesis              TEXT,
            scope_constraints   TEXT,
            team_id             TEXT,
            obsidian_vault_path TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS research_sources (
            id                  TEXT PRIMARY KEY,
            project_id          TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
            source_type         TEXT NOT NULL DEFAULT 'web',
            title               TEXT NOT NULL,
            authors             TEXT,
            year                INTEGER,
            abstract_text       TEXT,
            doi                 TEXT,
            url                 TEXT,
            pdf_path            TEXT,
            citation_count      INTEGER,
            metadata            TEXT,
            relevance_score     REAL,
            knowledge_base_id   TEXT,
            status              TEXT NOT NULL DEFAULT 'pending',
            ingested_at         TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_research_sources_project ON research_sources(project_id);

        CREATE TABLE IF NOT EXISTS research_citations (
            id                  TEXT PRIMARY KEY,
            source_id           TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
            cited_source_id     TEXT REFERENCES research_sources(id) ON DELETE SET NULL,
            cited_reference     TEXT,
            context             TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_research_citations_source ON research_citations(source_id);

        CREATE TABLE IF NOT EXISTS research_hypotheses (
            id                      TEXT PRIMARY KEY,
            project_id              TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
            statement               TEXT NOT NULL,
            rationale               TEXT,
            status                  TEXT NOT NULL DEFAULT 'proposed',
            confidence              REAL NOT NULL DEFAULT 0.5,
            parent_hypothesis_id    TEXT REFERENCES research_hypotheses(id) ON DELETE SET NULL,
            generated_by            TEXT,
            supporting_evidence     TEXT,
            counter_evidence        TEXT,
            linked_experiments      TEXT,
            created_at              TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_research_hypotheses_project ON research_hypotheses(project_id);

        CREATE TABLE IF NOT EXISTS research_experiments (
            id                  TEXT PRIMARY KEY,
            project_id          TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
            hypothesis_id       TEXT REFERENCES research_hypotheses(id) ON DELETE SET NULL,
            name                TEXT NOT NULL,
            methodology         TEXT,
            input_schema        TEXT,
            success_criteria    TEXT,
            status              TEXT NOT NULL DEFAULT 'designed',
            pipeline_id         TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_research_experiments_project ON research_experiments(project_id);

        CREATE TABLE IF NOT EXISTS research_experiment_runs (
            id                  TEXT PRIMARY KEY,
            experiment_id       TEXT NOT NULL REFERENCES research_experiments(id) ON DELETE CASCADE,
            run_number          INTEGER NOT NULL DEFAULT 1,
            inputs              TEXT,
            outputs             TEXT,
            metrics             TEXT,
            passed              INTEGER NOT NULL DEFAULT 0,
            execution_id        TEXT,
            duration_ms         INTEGER,
            cost_usd            REAL,
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_research_runs_experiment ON research_experiment_runs(experiment_id);

        CREATE TABLE IF NOT EXISTS research_findings (
            id                      TEXT PRIMARY KEY,
            project_id              TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
            title                   TEXT NOT NULL,
            description             TEXT,
            confidence              REAL NOT NULL DEFAULT 0.5,
            category                TEXT,
            source_experiment_ids   TEXT,
            source_ids              TEXT,
            hypothesis_ids          TEXT,
            generated_by            TEXT,
            status                  TEXT NOT NULL DEFAULT 'draft',
            created_at              TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_research_findings_project ON research_findings(project_id);

        CREATE TABLE IF NOT EXISTS research_reports (
            id                  TEXT PRIMARY KEY,
            project_id          TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            report_type         TEXT,
            status              TEXT NOT NULL DEFAULT 'outline',
            template            TEXT,
            format              TEXT DEFAULT 'markdown',
            review_id           TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_research_reports_project ON research_reports(project_id);

        CREATE TABLE IF NOT EXISTS research_report_sections (
            id                  TEXT PRIMARY KEY,
            report_id           TEXT NOT NULL REFERENCES research_reports(id) ON DELETE CASCADE,
            section_key         TEXT NOT NULL,
            title               TEXT,
            content             TEXT,
            sort_order          INTEGER NOT NULL DEFAULT 0,
            generated_by        TEXT,
            citation_ids        TEXT,
            status              TEXT NOT NULL DEFAULT 'empty',
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_research_sections_report ON research_report_sections(report_id);"
    )?;

    tracing::info!("Database migrations complete");
    Ok(())
}
