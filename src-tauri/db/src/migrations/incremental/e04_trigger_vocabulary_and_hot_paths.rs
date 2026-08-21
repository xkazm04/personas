//! Widening the trigger vocabulary to the whole TriggerKind set, the
//! enabled/status drift repair, pending trigger fires, the chat_messages role
//! CHECK rebuild, circuit-breaker persistence, and the composite indexes for
//! memory / chat / automation / team hot paths.
//!
//! Slice of the original `run_incremental` / `ensure_composite_fires_table`
//! body, moved verbatim. The driver calls these modules in the same order
//! the statements appeared in, so the executed step sequence is unchanged.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    let migrated = conn
        .execute(
            "UPDATE n8n_transform_sessions
         SET status = 'interrupted', error = NULL
         WHERE status = 'failed' AND error LIKE '%App closed during transform%'",
            [],
        )
        .unwrap_or(0);
    if migrated > 0 {
        tracing::info!(
            "Migrated {migrated} interrupted n8n sessions from failed+string to interrupted status"
        );
    }

    // Cloud webhook relay watermark table
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS cloud_webhook_watermarks (
            trigger_id      TEXT PRIMARY KEY,
            last_seen_ts    TEXT NOT NULL,
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    // -- Widen chat_messages role CHECK to include 'system' and 'tool' ----------
    // Detect support by PARSING the stored DDL (mirroring the persona_triggers /
    // persona_executions migrations in this file), NEVER by a live INSERT probe.
    // chat_messages has `persona_id NOT NULL REFERENCES personas(id)` and the
    // pool runs with `PRAGMA foreign_keys = ON`, so a probe row with a fake
    // persona ALWAYS fails on the FK -- never on the role CHECK -- which made the
    // old INSERT-probe a permanent false-positive that rebuilt the whole table
    // (an O(n) copy of all chat history) on every single launch.
    let chat_messages_sql: String = conn
        .prepare("SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='chat_messages'")?
        .query_row([], |row| row.get::<_, String>(0))
        .unwrap_or_default();

    // Only rebuild when the table genuinely exists but its stored CHECK lacks
    // the widened role set. A fresh DB already carries
    // CHECK(role IN ('user','assistant','system','tool')) -> no-op. An absent
    // table (empty DDL) must NOT trigger a rebuild of a non-existent table.
    let needs_role_migration = !chat_messages_sql.is_empty()
        && !(chat_messages_sql.contains("'system'") && chat_messages_sql.contains("'tool'"));

    if needs_role_migration {
        ddl_step(
            conn,
            "DROP TABLE IF EXISTS chat_messages_new;
            CREATE TABLE chat_messages_new (
                id              TEXT PRIMARY KEY,
                persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                session_id      TEXT NOT NULL,
                role            TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
                content         TEXT NOT NULL,
                execution_id    TEXT,
                metadata        TEXT,
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO chat_messages_new SELECT * FROM chat_messages;
            DROP TABLE chat_messages;
            ALTER TABLE chat_messages_new RENAME TO chat_messages;
            CREATE INDEX IF NOT EXISTS idx_chat_persona   ON chat_messages(persona_id);
            CREATE INDEX IF NOT EXISTS idx_chat_session   ON chat_messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_chat_created   ON chat_messages(created_at);",
        )?;
        tracing::info!("Widened chat_messages role CHECK to include system and tool");
    }

    // Circuit breaker persistence table (survive restarts, 15-min TTL)
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS circuit_breaker_state (
            provider              TEXT PRIMARY KEY,
            consecutive_failures  INTEGER NOT NULL DEFAULT 0,
            is_open               INTEGER NOT NULL DEFAULT 0,
            opened_at             TEXT,
            updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    // -- Add trigger_version column for race-safe CAS on mark_triggered ----------
    // Replaces value-based CAS (WHERE next_trigger_at IS ?old) with a monotonic
    // version counter.  Two concurrent ticks reading the same version will race on
    // the UPDATE, but only the first to increment wins; the second touches 0 rows.
    let has_trigger_version: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_triggers') WHERE name = 'trigger_version'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_trigger_version {
        ddl_step(
            conn,
            "ALTER TABLE persona_triggers ADD COLUMN trigger_version INTEGER NOT NULL DEFAULT 0;",
        )?;
        tracing::info!("Added trigger_version column to persona_triggers for CAS safety");
    }

    // -- Add unattended_mode column for the destructive-action gate (UAT P5) ------
    // Controls what happens when this trigger fires UNATTENDED (schedule/event):
    //   'auto'     — fire normally (default; preserves all existing behavior)
    //   'dry_run'  — fire, but the launched run is_simulation (outbound suppressed)
    //   'approval' — hold the launch for human approval before it runs
    let has_unattended_mode: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_triggers') WHERE name = 'unattended_mode'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_unattended_mode {
        ddl_step(
            conn,
            "ALTER TABLE persona_triggers ADD COLUMN unattended_mode TEXT NOT NULL DEFAULT 'auto';",
        )?;
        tracing::info!(
            "Added unattended_mode column to persona_triggers (UAT P5 destructive-action gate)"
        );
    }

    // -- Widen persona_triggers.trigger_type to the whole TriggerKind vocabulary --
    //
    // The CHECK admitted six members while the Add-trigger menu offered ten, so
    // `file_watcher`, `clipboard`, `app_focus` and `composite` could not be
    // stored on ANY install — including all six one-click quick templates,
    // three natural-language-parser branches, and two alias maps that
    // *manufacture* two of the four from LLM/template shorthand. The engine has
    // always had the dispatch loops (`engine/src/{file_watcher,clipboard_monitor,
    // app_focus}.rs`, `src/engine/composite.rs`, each reading
    // `get_enabled_by_type` for its own kind) and `TriggerConfig::from_raw` has
    // always had the arms; the column was the only thing refusing, and it
    // refused with an anonymous `CHECK constraint failed`.
    //
    // The member list comes from `TriggerKind::sql_check_list()`, the same
    // source the base schema is resolved from — so this step also becomes the
    // automatic rebuild whenever a future kind is added: the guard below
    // compares the stored DDL against the enum rather than against a literal.
    //
    // SQLite cannot ALTER a CHECK, so this is the standard 12-step rebuild.
    let trigger_table_sql: String = conn
        .prepare(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='persona_triggers'",
        )?
        .query_row([], |row| row.get::<_, String>(0))
        .unwrap_or_default();

    let missing_kinds: Vec<&str> = personas_core::models::TriggerKind::ALL
        .iter()
        .map(|k| k.as_str())
        .filter(|name| !trigger_table_sql.contains(&format!("'{name}'")))
        .collect();

    if !trigger_table_sql.is_empty() && !missing_kinds.is_empty() {
        // The replacement shape is derived from the table's OWN stored DDL, not
        // hand-written here — the `widen_kpi_measurement_source_with_ai_compose`
        // / `rebuild_executions_table_with_incomplete_status` discipline. The
        // two earlier persona_triggers rebuilds in this file (:469, :1071) DID
        // hand-write their column lists, and replaying the second one against a
        // copy of the operator's live database destroyed `status`,
        // `trigger_version` and `unattended_mode` — 351 non-null values each —
        // while preserving the row count exactly, so no row-count assertion
        // could have caught it. This step runs at the END of the chain, where
        // the live shape is not knowable from this file, which is precisely
        // when a hand-written list is most wrong.
        //
        // Only the CHECK's member list changes, so one `replacen` over the
        // stored DDL does the whole job, and `SELECT *` is then sound because
        // the staging shape descends from the source's own DDL.
        let open_paren = trigger_table_sql
            .find("CHECK(trigger_type IN (")
            .map(|i| i + "CHECK(trigger_type IN (".len());
        let (start, end) = match open_paren
            .and_then(|s| trigger_table_sql[s..].find(')').map(|e| (s, s + e)))
        {
            Some(pair) => pair,
            None => {
                // Not the shape this step was written against. Bail loudly
                // rather than build a table that silently keeps the old
                // constraint (or mangles a different clause).
                return Err(AppError::Validation(
                    "persona_triggers.trigger_type CHECK is not in the expected shape — refusing to rebuild"
                        .into(),
                ));
            }
        };
        let widened = format!(
            "{}{}{}",
            &trigger_table_sql[..start],
            personas_core::models::TriggerKind::sql_check_list(),
            &trigger_table_sql[end..],
        );
        // Re-point the CREATE at a staging name. `persona_triggers` occurs once
        // as the table name; the FK clause references `personas`, which does
        // not contain the token.
        let staged = widened.replacen("persona_triggers", "persona_triggers_kinds_new", 1);
        if staged == widened {
            return Err(AppError::Validation(
                "persona_triggers rebuild could not re-point its CREATE at a staging name".into(),
            ));
        }

        // Index/trigger DDL to replay after the rename — dropping the table
        // drops them with it. Auto-indexes have a NULL `sql`.
        let aux_sql: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT sql FROM sqlite_master
                 WHERE tbl_name='persona_triggers'
                   AND type IN ('index','trigger')
                   AND sql IS NOT NULL",
            )?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?
        };

        // FK enforcement OFF for the swap: with foreign_keys=ON the
        // `DROP TABLE persona_triggers` fires ON DELETE SET NULL on
        // persona_executions.trigger_id and ON DELETE CASCADE on
        // pending_trigger_fires / composite_trigger_fires. The guard re-enables
        // FK on scope exit.
        let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

        let mut batch = String::new();
        batch.push_str("DROP TABLE IF EXISTS persona_triggers_kinds_new;\n");
        batch.push_str(&staged);
        batch.push_str(";\n");
        batch.push_str("INSERT INTO persona_triggers_kinds_new SELECT * FROM persona_triggers;\n");
        batch.push_str("DROP TABLE persona_triggers;\n");
        batch.push_str("ALTER TABLE persona_triggers_kinds_new RENAME TO persona_triggers;\n");
        for s in &aux_sql {
            batch.push_str(s);
            batch.push_str(";\n");
        }
        ddl_step(conn, &batch)?;
        tracing::info!(
            added = ?missing_kinds,
            "Widened persona_triggers.trigger_type CHECK to the full TriggerKind vocabulary"
        );
    }

    // -- Repair enabled/status drift written by this tree -------------------------
    // `status` was added as `NOT NULL DEFAULT 'active'`, so every INSERT that
    // wrote `enabled` WITHOUT naming `status` produced `enabled=0,
    // status='active'` — a row the UI badge reads as OFF and the two dispatch
    // predicates (`get_due`, `get_enabled_by_type`, both keyed on `status`) read
    // as ON. Persona duplication was a guaranteed producer: it copies every
    // trigger with `enabled=0` and no status. The writers are fixed; this
    // reconciles rows they already wrote. Only touches rows where the two
    // genuinely disagree, and always believes the column the *user* toggled.
    let drifted = conn.execute(
        "UPDATE persona_triggers
            SET status = 'disabled', updated_at = ?1
          WHERE enabled = 0 AND status = 'active'",
        rusqlite::params![chrono::Utc::now().to_rfc3339()],
    )?;
    if drifted > 0 {
        tracing::info!(
            rows = drifted,
            "Reconciled persona_triggers rows that read 'off' in the UI and 'active' to the dispatcher"
        );
    }

    // -- Pending trigger fires (the 'approval' unattended-mode hold, UAT P5) ------
    // When a scheduler-fired trigger is in `approval` mode, its fire is HELD here
    // instead of publishing the event; a human approves/rejects, and on approval
    // the captured event is published (the normal flow then creates the run).
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS pending_trigger_fires (
            id              TEXT PRIMARY KEY,
            trigger_id      TEXT NOT NULL REFERENCES persona_triggers(id) ON DELETE CASCADE,
            persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            event_type      TEXT NOT NULL,
            payload         TEXT,
            use_case_id     TEXT,
            status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending', 'approved', 'rejected')),
            created_at      TEXT NOT NULL,
            resolved_at     TEXT
        );",
    )?;
    ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_ptf_status ON pending_trigger_fires(status);",
    )?;

    // -- Composite indexes for memory & chat hot-path queries --------------------
    // These are idempotent (IF NOT EXISTS) and cover the top query patterns that
    // degrade to full table scans as data grows.
    ddl_step(
        conn,
        // chat_messages: get_session_messages + list_sessions
        // WHERE persona_id = ? AND session_id = ? ORDER BY created_at DESC
        "CREATE INDEX IF NOT EXISTS idx_chat_persona_session_created
         ON chat_messages(persona_id, session_id, created_at DESC);

         -- persona_memories: get_by_persona
         -- WHERE persona_id = ? ORDER BY importance DESC, created_at DESC
         CREATE INDEX IF NOT EXISTS idx_pm_persona_importance_created
         ON persona_memories(persona_id, importance DESC, created_at DESC);

         -- persona_memories: run_lifecycle
         -- WHERE persona_id = ? AND tier = 'working' AND access_count ...
         CREATE INDEX IF NOT EXISTS idx_pm_persona_tier_access
         ON persona_memories(persona_id, tier, access_count, created_at);

         -- persona_memories: get_all filtered by persona_id + category
         CREATE INDEX IF NOT EXISTS idx_pm_persona_category
         ON persona_memories(persona_id, category);

         -- chat_session_context: get_latest_session
         -- WHERE persona_id = ? ORDER BY updated_at DESC LIMIT 1
         CREATE INDEX IF NOT EXISTS idx_chat_ctx_persona_updated
         ON chat_session_context(persona_id, updated_at DESC);",
    )?;
    tracing::info!("Ensured composite indexes for memory & chat hot-path queries");

    // -- Composite indexes for automation_runs hot-path queries -------------------
    // The single-column idx_automation_runs_automation cannot satisfy ORDER BY
    // started_at DESC without a filesort; a composite index eliminates that.
    // The (status, started_at) index lets reap_stale_runs avoid a full table scan.
    ddl_step(
        conn,
        // get_runs_by_automation: WHERE automation_id = ? ORDER BY started_at DESC
        "CREATE INDEX IF NOT EXISTS idx_automation_runs_auto_started
         ON automation_runs(automation_id, started_at DESC);

         -- reap_stale_runs: WHERE status = 'running' AND julianday(started_at) ...
         CREATE INDEX IF NOT EXISTS idx_automation_runs_status_started
         ON automation_runs(status, started_at);",
    )?;
    tracing::info!("Ensured composite indexes for automation_runs hot-path queries");

    // -- Composite indexes for team_memories and pipeline_runs hot-path queries ----
    // team_memories: get_by_team, get_for_injection, evict_excess all filter by
    // team_id and sort by importance DESC, created_at DESC/ASC. A composite index
    // lets SQLite satisfy the WHERE + ORDER BY without a filesort.
    // pipeline_runs: has_running_pipeline filters (team_id, status); list_pipeline_runs
    // filters team_id and sorts by started_at DESC.
    ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_tm_team_importance_created
         ON team_memories(team_id, importance DESC, created_at DESC);

         CREATE INDEX IF NOT EXISTS idx_pr_team_status
         ON pipeline_runs(team_id, status);

         CREATE INDEX IF NOT EXISTS idx_pr_team_started
         ON pipeline_runs(team_id, started_at DESC);",
    )?;
    tracing::info!(
        "Ensured composite indexes for team_memories and pipeline_runs hot-path queries"
    );

    // team_memories: get_all, get_total_count filter (team_id, run_id); evict_excess
    // filters (team_id, run_id IS NOT NULL). A composite index lets SQLite satisfy
    // these without scanning the full table and then post-filtering by run_id.
    ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_tm_team_run
         ON team_memories(team_id, run_id);",
    )?;
    tracing::info!("Ensured composite index idx_tm_team_run on team_memories");

    // Add composite index for trigger_id + created_at on persona_executions
    // Covers get_by_trigger_id query: WHERE trigger_id = ? ORDER BY created_at DESC
    ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_pe_trigger_created
         ON persona_executions(trigger_id, created_at DESC);",
    )?;
    tracing::info!("Ensured composite index idx_pe_trigger_created on persona_executions");

    // Phase 17: template_category column on personas for tier-3 illustration resolution.
    // Populated by template adoption flows via `infer_template_category`. Null for
    // manually-created personas and pre-existing rows — resolver falls through to hash tier.
    let has_template_category: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('personas') WHERE name = 'template_category'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_template_category {
        ddl_step(
            conn,
            "ALTER TABLE personas ADD COLUMN template_category TEXT;",
        )?;
        tracing::info!("Added template_category column to personas");
    }

    // mutation_strategy column on evolution_policies — selects between the
    // existing mechanical mutator (shuffle/drop/duplicate prompt segments,
    // permute tools, jiggle timeout) and an LLM-critique-and-rewrite mutator
    // that uses recent low-fitness traces as the gradient signal. NULL means
    // "mechanical" (the legacy default), so existing rows stay on the proven
    // path until a user opts into the new strategy.
    let has_mutation_strategy: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('evolution_policies') WHERE name = 'mutation_strategy'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_mutation_strategy {
        ddl_step(
            conn,
            "ALTER TABLE evolution_policies ADD COLUMN mutation_strategy TEXT;",
        )?;
        tracing::info!("Added mutation_strategy column to evolution_policies");
    }

    // last_heartbeat_at column on persona_executions — written by the runner
    // every 30s alongside the EXECUTION_HEARTBEAT event so a supervisor scan
    // can detect long-silent runs. Today, stuck CLI subprocesses are caught
    // only by hard timeout_ms kill; this column lets a passive watchdog emit
    // a stale-execution signal earlier without changing the canonical status
    // lifecycle.
    let has_last_heartbeat_at: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('persona_executions') WHERE name = 'last_heartbeat_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_last_heartbeat_at {
        ddl_step(
            conn,
            "ALTER TABLE persona_executions ADD COLUMN last_heartbeat_at TEXT;",
        )?;
        tracing::info!("Added last_heartbeat_at column to persona_executions");
    }

    // -- audit_incidents: cross-source promoted incidents ------------------
    // See `src/features/overview/sub_incidents/DESIGN.md` for the rollout
    // plan and the per-source promotion rules. Stores rows promoted from
    // 7 existing audit-shaped tables under a single triage lifecycle
    // (open → acknowledged → resolved | dismissed). The dedup_key is
    // `{source_table}:{source_id}` and is UNIQUE so concurrent inserts are
    // idempotent under SQLite WAL.

    Ok(())
}
