//! Per-context structural fingerprints, the reversible-agent change journal,
//! device pairing and cross-device remote jobs, recipe outcome attribution,
//! the KPI measurement-source widening, the goal status CHECK, and the
//! mcp_gateway_members foreign-key repair.
//!
//! Slice of the original `run_incremental` / `ensure_composite_fires_table`
//! body, moved verbatim. The driver calls these modules in the same order
//! the statements appeared in, so the executed step sequence is unchanged.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_context_fingerprints",
            description: "Per-context deterministic structural fingerprint cache (imports/primitives/shape counters/surface flags)",
            already_applied: |conn| has_table(conn, "dev_context_fingerprints"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_context_fingerprints (
                        project_id                  TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
                        context_id                  TEXT NOT NULL,
                        -- Hash over the file list AND every file's sha256.
                        content_hash                TEXT NOT NULL,
                        file_count                  INTEGER NOT NULL DEFAULT 0,
                        -- Mapped paths that no longer exist on disk. 13% of the
                        -- live map is dangling; per-context staleness must be
                        -- VISIBLE rather than silently skipped.
                        missing_file_count          INTEGER NOT NULL DEFAULT 0,
                        -- JSON arrays.
                        imports                     TEXT,
                        primitives                  TEXT,
                        -- Shape counters.
                        promise_all_count           INTEGER NOT NULL DEFAULT 0,
                        join_all_count              INTEGER NOT NULL DEFAULT 0,
                        await_count                 INTEGER NOT NULL DEFAULT 0,
                        sql_write_count             INTEGER NOT NULL DEFAULT 0,
                        spawn_count                 INTEGER NOT NULL DEFAULT 0,
                        use_effect_count            INTEGER NOT NULL DEFAULT 0,
                        set_state_after_await_count INTEGER NOT NULL DEFAULT 0,
                        -- Surface flags (0/1).
                        exports_components          INTEGER NOT NULL DEFAULT 0,
                        exports_hooks               INTEGER NOT NULL DEFAULT 0,
                        exports_commands            INTEGER NOT NULL DEFAULT 0,
                        exports_repo_fns            INTEGER NOT NULL DEFAULT 0,
                        computed_at                 TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (project_id, context_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_dev_context_fingerprints_hash
                        ON dev_context_fingerprints(project_id, content_hash);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Reversible Agent: durable change journal -----------------------------
    // The persistence target of the second CDC consumer (db/journal.rs): one
    // row per captured INSERT/UPDATE/DELETE on an allowlisted table, with
    // the OLD row values serialized as JSON for UPDATE/DELETE (before-image;
    // encrypted columns stay ciphertext — the hook copies values as stored)
    // and the owning execution stamped by the attribution context.
    //
    // `row_pk` is the TEXT `id` of the touched row (every allowlisted table
    // has one); undo addresses rows by pk, never by reusable rowid. `id` is
    // a plain INTEGER PRIMARY KEY: monotonic enough for replay ordering and
    // "later foreign write" conflict detection (only the oldest rows are
    // ever pruned). `undo_status` NULL = live, 'undone' = reversed,
    // 'conflict' = parked because a later foreign write touched the row.
    //
    // Journal writes are themselves EXCLUDED from CDC + journal capture
    // (cdc::table_to_event returns None; journal::is_journaled_table guards
    // explicitly), so this table cannot recurse.
    //
    // MUST stay INSIDE `run_incremental` — the file's tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE this function.
    run_step(
        conn,
        IncrementalMigration {
            id: "change_journal",
            description:
                "Reversible Agent: durable, execution-attributed change journal with before-images",
            already_applied: |conn| has_table(conn, "change_journal"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS change_journal (
                        id            INTEGER PRIMARY KEY,
                        execution_id  TEXT,
                        tbl           TEXT NOT NULL,
                        row_pk        TEXT,
                        row_id        INTEGER NOT NULL,
                        action        TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
                        before_image  TEXT,
                        undo_status   TEXT CHECK (undo_status IN ('undone', 'conflict')),
                        undone_at     TEXT,
                        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_change_journal_execution
                        ON change_journal(execution_id, id);
                    CREATE INDEX IF NOT EXISTS idx_change_journal_key
                        ON change_journal(tbl, row_pk, id);
                    CREATE INDEX IF NOT EXISTS idx_change_journal_created
                        ON change_journal(created_at);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- dev_tasks: updated_at (the staleness signal tasks never had) ----------
    // `dev_tasks` carried created_at / started_at / completed_at and nothing
    // else, so a task stuck `running` for six hours was indistinguishable from
    // one running six minutes except by re-deriving from started_at, and a
    // `queued` row that had been silently re-touched had no signal at all.
    // The attention queue (repos/dev_tools.rs::attention_queue) reads this as a
    // heartbeat: the task executor calls update_task on every progress
    // milestone, so a running task whose updated_at has gone quiet is genuinely
    // stuck rather than merely long.
    //
    // Added nullable + backfilled rather than NOT NULL DEFAULT: SQLite refuses
    // a non-constant default (`datetime('now')`) in ALTER TABLE ADD COLUMN.
    // The backfill uses the same COALESCE the readers do, so an existing row
    // gets its most recent real stamp instead of NULL or a fake "now" that
    // would make every historical task look freshly touched.
    //
    // MUST stay INSIDE `run_incremental` — the file's tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE this function.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_tasks_updated_at",
            description:
                "dev_tasks.updated_at (+ backfill from completed_at/started_at/created_at)",
            already_applied: |conn| has_column(conn, "dev_tasks", "updated_at"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_tasks ADD COLUMN updated_at TEXT;
                     UPDATE dev_tasks
                        SET updated_at = COALESCE(completed_at, started_at, created_at)
                      WHERE updated_at IS NULL;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- owned_devices: device-link pairing columns --------------------------
    // The `owned_devices` registry above predates the pairing ceremony; it only
    // recorded that a peer *is* one of ours. The signed pairing handshake adds
    // three facts worth persisting:
    //   • `is_home`     — which device is the user's primary ("home") machine.
    //                     At most one row is true; the repo enforces that.
    //   • `paired_at`   — when the fingerprint confirmation happened, distinct
    //                     from `added_at` (a row can be registered manually,
    //                     without a pairing ceremony, and then stay unpaired).
    //   • `public_key`  — the peer's Ed25519 public key (base64) as proven at
    //                     handshake time, so a later reconnect can be checked
    //                     against the key we actually paired with rather than
    //                     re-trusting whatever key the peer presents.
    // `display_name` is intentionally NOT added here: the original
    // `owned_devices` DDL already declares it `TEXT NOT NULL`.
    //
    // Guarded per-column (not per-table) because a DB that ran an earlier
    // partial of this step must be able to finish it. `has_column` on a table
    // that does not exist returns false, so the `has_table` check in `apply`
    // keeps an ALTER from firing against a missing table on an exotic DB.
    run_step(
        conn,
        IncrementalMigration {
            id: "owned_devices_pairing_columns",
            description:
                "Add is_home / paired_at / public_key to owned_devices (device-link pairing)",
            already_applied: |conn| {
                Ok(has_column(conn, "owned_devices", "is_home")?
                    && has_column(conn, "owned_devices", "paired_at")?
                    && has_column(conn, "owned_devices", "public_key")?)
            },
            apply: |conn| {
                if !has_table(conn, "owned_devices")? {
                    return Ok(());
                }
                if !has_column(conn, "owned_devices", "is_home")? {
                    ddl_step(
                        conn,
                        "ALTER TABLE owned_devices
                            ADD COLUMN is_home BOOLEAN NOT NULL DEFAULT 0;",
                    )?;
                }
                if !has_column(conn, "owned_devices", "paired_at")? {
                    ddl_step(conn, "ALTER TABLE owned_devices ADD COLUMN paired_at TEXT;")?;
                }
                if !has_column(conn, "owned_devices", "public_key")? {
                    ddl_step(
                        conn,
                        "ALTER TABLE owned_devices ADD COLUMN public_key TEXT;",
                    )?;
                }
                // At most one home device. A partial unique index is the
                // cheapest way to make the invariant a schema fact rather than
                // repo-only etiquette.
                ddl_step(
                    conn,
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_owned_devices_single_home
                        ON owned_devices(is_home) WHERE is_home = 1;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- remote_jobs / remote_job_notes: cross-device instruction dispatch ----
    // One paired device sends the other a natural-language instruction; the
    // receiving device runs it and streams back an ack, progress notes and a
    // final summary. Both roles read and write the SAME table, told apart by
    // `direction` ('outbound' = I asked, 'inbound' = I was asked), so a device
    // that does both keeps one chronological history instead of two.
    //
    // `last_seq` is the resume anchor and means slightly different things per
    // side — highest note EMITTED on the inbound (running) side, highest note
    // RECEIVED on the outbound side — but in both cases it is "everything up to
    // here is durable", which is exactly what a reconnect needs to replay from.
    //
    // The notes live in their own table rather than a JSON column because the
    // replay reads them with `seq > ?`, and the composite primary key
    // (job_id, seq) is what makes redelivery idempotent: a replayed note that
    // already landed hits the PK and is ignored, so exactly-once falls out of
    // the schema instead of out of careful application code.
    //
    // Not `p2p`-gated: the tables are plain data, and a lite build must still
    // migrate cleanly so a user who switches builds does not lose the history.
    run_step(
        conn,
        IncrementalMigration {
            id: "remote_jobs_tables",
            description: "remote_jobs + remote_job_notes (cross-device instruction dispatch)",
            already_applied: |conn| {
                Ok(has_table(conn, "remote_jobs")? && has_table(conn, "remote_job_notes")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS remote_jobs (
                        id                 TEXT PRIMARY KEY,
                        direction          TEXT NOT NULL
                                             CHECK(direction IN ('outbound','inbound')),
                        peer_id            TEXT NOT NULL,
                        peer_display_name  TEXT NOT NULL DEFAULT '',
                        kind               TEXT NOT NULL DEFAULT 'instruction',
                        instruction        TEXT NOT NULL,
                        status             TEXT NOT NULL,
                        summary            TEXT,
                        refusal_reason     TEXT,
                        last_seq           INTEGER NOT NULL DEFAULT 0,
                        created_at         TEXT NOT NULL,
                        updated_at         TEXT NOT NULL,
                        completed_at       TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_remote_jobs_peer
                        ON remote_jobs(peer_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_remote_jobs_direction_status
                        ON remote_jobs(direction, status);
                    CREATE TABLE IF NOT EXISTS remote_job_notes (
                        job_id      TEXT NOT NULL
                                      REFERENCES remote_jobs(id) ON DELETE CASCADE,
                        seq         INTEGER NOT NULL,
                        text        TEXT NOT NULL,
                        created_at  TEXT NOT NULL,
                        PRIMARY KEY (job_id, seq)
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Recipe outcome attribution ------------------------------------------
    // With 299 seeded recipes the product could not answer "which of these do
    // people actually run, and do they succeed?" An adopted capability carries
    // `source_recipe_id` in `personas.design_context.useCases[]`, but that
    // provenance was never joined to a run: nothing on the execution path
    // recorded which recipe produced an output, `dev_llm_spend` has only a
    // coarse `source:"recipe"` tag written by the dead playground path, and
    // `recipe_suggestion_events` measures composer chip impressions rather
    // than outcomes.
    //
    // Denormalized onto the execution row rather than resolved by a live join,
    // because `design_context` is mutable: detaching a capability deletes the
    // use case, which would silently rewrite the history of every run it ever
    // produced. A run's provenance is a fact about the past and must not move.
    //
    // Both columns are NULL when no recipe is behind the run. Historical rows
    // stay NULL — they genuinely lack the information and there is no honest
    // backfill for them.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions_recipe_provenance",
            description: "Add source_recipe_id/source_recipe_version to persona_executions",
            already_applied: |conn| {
                // Guarded on the table as well as the column: several tables
                // exist only in the app binary, and an ALTER against a missing
                // table would abort the whole migration run.
                Ok(!has_table(conn, "persona_executions")?
                    || has_column(conn, "persona_executions", "source_recipe_id")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN source_recipe_id TEXT;\n\
                     ALTER TABLE persona_executions ADD COLUMN source_recipe_version TEXT;\n\
                     CREATE INDEX IF NOT EXISTS idx_pe_source_recipe\n\
                         ON persona_executions(source_recipe_id, status)\n\
                         WHERE source_recipe_id IS NOT NULL;",
                )?;
                Ok(())
            },
        },
    )?;
    // The AI-compose measurement door writes `source = 'ai-compose'` — a value
    // the source CHECK never allowed. Both writers (`kpi_compose::
    // apply_composed_measure` and the Factory measurement-setup modal) were
    // therefore rejected by SQLite, and the background one swallowed the error
    // with `let _ =`: an AI-composed reading has never reached the series.
    // Widen the CHECK so it can.
    //
    // MUST live here and not in `ensure_composite_fires_table` (which owns the
    // file's tail): that phase runs BEFORE this one and is where the table is
    // created, so a rebuild placed there would race its own CREATE.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_kpi_measurements.source_ai_compose",
            description: "allow source='ai-compose' on KPI measurements (table rebuild)",
            already_applied: |conn| {
                if !has_table(conn, "dev_kpi_measurements")? {
                    return Ok(true);
                }
                if !has_column(conn, "dev_kpi_measurements", "source")? {
                    return Ok(true);
                }
                let sql: String = conn.query_row(
                    "SELECT COALESCE(sql, '') FROM sqlite_master
                     WHERE type='table' AND name='dev_kpi_measurements'",
                    [],
                    |r| r.get(0),
                )?;
                Ok(sql.contains("'ai-compose'"))
            },
            apply: widen_kpi_measurement_source_with_ai_compose,
        },
    )?;
    // `dev_goals.status` was a free TEXT column. Its canonical states existed
    // only in TypeScript, and correctness depended on every writer remembering
    // to call `normalizeGoalStatus` — which has already failed once (v1 wrote
    // 'in-progress' and matched 'in_progress', silently mis-laning every
    // in-progress goal), and which Rust never called at all. Constrain it at
    // the DB boundary, the way the module's own neighbours already are:
    // `dev_kpi_measurements.source`, `.env` and `dev_kpis.status` all carry
    // CHECKs.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_goals.status_check",
            description: "constrain dev_goals.status to the canonical set (table rebuild)",
            already_applied: |conn| {
                if !has_table(conn, "dev_goals")? {
                    return Ok(true);
                }
                if !has_column(conn, "dev_goals", "status")? {
                    return Ok(true);
                }
                let sql: String = conn.query_row(
                    "SELECT COALESCE(sql, '') FROM sqlite_master
                     WHERE type='table' AND name='dev_goals'",
                    [],
                    |r| r.get(0),
                )?;
                Ok(sql.contains("CHECK(status IN"))
            },
            apply: constrain_goal_status_to_canonical_set,
        },
    )?;

    // MUST stay in `run_incremental` (phase 2). `mcp_gateway_members` is created
    // in `ensure_composite_fires_table`, which `initial::run` calls in phase 1 —
    // i.e. BEFORE this function, despite sitting BELOW it in this file. A
    // rebuild placed in that tail would run before the table it rebuilds exists
    // and silently no-op. That inversion is what produced the bug being fixed
    // here in the first place.
    run_step(
        conn,
        IncrementalMigration {
            id: "mcp_gateway_members.credentials_fk",
            description: "Repoint mcp_gateway_members foreign keys from the phantom \
                          `credentials` table to `persona_credentials`",
            already_applied: |conn| {
                // Nothing to repair if the table is absent (it is created in
                // phase 1, so this is only reachable on an unusual database).
                if !has_table(conn, "mcp_gateway_members")? {
                    return Ok(true);
                }
                Ok(dangling_fk_count(conn, "mcp_gateway_members")? == 0)
            },
            apply: repoint_mcp_gateway_members_fk,
        },
    )?;

    Ok(())
}
