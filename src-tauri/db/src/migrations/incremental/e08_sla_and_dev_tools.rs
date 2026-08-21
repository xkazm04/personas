//! Build-session telemetry, SLA rollups and breach episodes, missed schedule
//! runs, retirement of the DB-backed skills system, skill usage telemetry,
//! doc-rot tracking, and memory-claim health.
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
            id: "build_sessions_telemetry",
            description: "Add phase_timings_json + cost/token/turn columns to build_sessions",
            already_applied: |conn| has_column(conn, "build_sessions", "phase_timings_json"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE build_sessions ADD COLUMN phase_timings_json TEXT;
                     ALTER TABLE build_sessions ADD COLUMN total_cost_usd REAL;
                     ALTER TABLE build_sessions ADD COLUMN input_tokens INTEGER;
                     ALTER TABLE build_sessions ADD COLUMN output_tokens INTEGER;
                     ALTER TABLE build_sessions ADD COLUMN num_turns INTEGER;",
                )?;
                Ok(())
            },
        },
    )?;

    // Persisted daily SLA rollups (per persona × local day). Lets the SLA
    // dashboard serve its trend + aggregates from a bounded rollup table
    // instead of re-scanning the full `persona_executions` history on every
    // load, and lets the trend survive execution retention. Backfills from
    // existing history using the server's local-day definition (the same one
    // the runtime rollup writer in `cleanup_tick` uses). MUST stay INSIDE
    // `run_incremental` (fresh DBs run this after the base schema exists) — the
    // tail below belongs to `ensure_composite_fires_table`, which `initial::run`
    // calls BEFORE `run_incremental`, so a step appended there would fail on a
    // fresh DB.
    run_step(
        conn,
        IncrementalMigration {
            id: "sla_daily_rollups",
            description: "Persisted daily SLA rollups (per persona × local day) + backfill",
            already_applied: |conn| has_table(conn, "sla_daily"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS sla_daily (
                        persona_id      TEXT NOT NULL,
                        day             TEXT NOT NULL,
                        total           INTEGER NOT NULL DEFAULT 0,
                        successful      INTEGER NOT NULL DEFAULT 0,
                        failed          INTEGER NOT NULL DEFAULT 0,
                        cancelled       INTEGER NOT NULL DEFAULT 0,
                        timed_count     INTEGER NOT NULL DEFAULT 0,
                        duration_sum_ms REAL NOT NULL DEFAULT 0,
                        cost_sum_usd    REAL NOT NULL DEFAULT 0,
                        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (persona_id, day)
                    );
                    CREATE INDEX IF NOT EXISTS idx_sla_daily_day ON sla_daily(day);",
                )?;
                // Backfill from existing execution history. Reuses the exact
                // rollup writer the runtime path uses, so backfilled and
                // live-written rows share one definition.
                let offset_min = crate::repos::communication::sla::server_offset_minutes();
                crate::repos::communication::sla::upsert_sla_daily_conn(conn, offset_min)?;
                Ok(())
            },
        },
    )?;

    // Durable SLA breach-episode state (one row per persona). Powers the
    // reliability-breach bus events emitted on the execution-completion path:
    // the row is what dedupes a breach to ONE enter-event (and one recovery)
    // even across restarts — without it, every failing run after the first
    // would re-emit. Zero-config: thresholds are code constants in
    // `repos::communication::sla`, there is no `sla_targets` table by design.
    // MUST stay INSIDE `run_incremental` for the same reason as `sla_daily`
    // above (fresh DBs run this after the base schema; the tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE `run_incremental`).
    run_step(
        conn,
        IncrementalMigration {
            id: "sla_breach_episodes",
            description: "Durable per-persona SLA breach-episode dedup state",
            already_applied: |conn| has_table(conn, "sla_breach_episodes"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS sla_breach_episodes (
                        persona_id           TEXT PRIMARY KEY,
                        is_open              INTEGER NOT NULL DEFAULT 0,
                        reason               TEXT,
                        consecutive_failures INTEGER NOT NULL DEFAULT 0,
                        success_rate         REAL NOT NULL DEFAULT 0,
                        decided              INTEGER NOT NULL DEFAULT 0,
                        opened_at            TEXT,
                        recovered_at         TEXT,
                        updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_sla_breach_episodes_open
                        ON sla_breach_episodes(is_open);",
                )?;
                Ok(())
            },
        },
    )?;

    // Durable per-trigger schedule side-state: the count of scheduled slots
    // that were DISCARDED while the app was offline (the startup overdue sweep
    // fires ONE catch-up and drops the rest under the default backfill cap of
    // 1), so a daily-job user gets a visible "missed N while offline" record
    // instead of silent loss. One row per schedule trigger; cleared after the
    // user backfills or dismisses. MUST stay INSIDE `run_incremental` (fresh
    // DBs run this after the base schema; the tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE `run_incremental`).
    run_step(
        conn,
        IncrementalMigration {
            id: "schedule_missed_runs",
            description: "Per-trigger discarded-while-offline slot count for schedule visibility",
            already_applied: |conn| has_table(conn, "schedule_missed_runs"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS schedule_missed_runs (
                        trigger_id      TEXT PRIMARY KEY,
                        missed_count    INTEGER NOT NULL DEFAULT 0,
                        first_missed_at TEXT,
                        last_missed_at  TEXT,
                        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Direction 3 (lost fires get a home): machine-readable reason a schedule is
    // Paused/Unscheduled (e.g. `invalid_timezone`), stored on the same per-trigger
    // side-state row so the schedule row can explain WHY next_trigger_at is NULL
    // instead of just showing "Paused/Unscheduled". Guarded ALTER — reuses the
    // Direction 1 table so a trigger can carry both a missed count and a reason.
    run_step(
        conn,
        IncrementalMigration {
            id: "schedule_missed_runs.status_reason",
            description: "Machine-readable schedule pause reason (e.g. invalid_timezone)",
            already_applied: |conn| has_column(conn, "schedule_missed_runs", "status_reason"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE schedule_missed_runs ADD COLUMN status_reason TEXT;
                     ALTER TABLE schedule_missed_runs ADD COLUMN status_reason_detail TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Retire the orphaned DB skills system ("System A": skills / skill_components
    // / persona_skills). It was unreachable at both ends — no execution path read
    // `persona_skills`, no seeder wrote rows, and its frontend API had zero
    // importers (retired 2026-07-17). Fresh DBs no longer create the tables (the
    // CREATE was removed from initial.rs); this step cleans up LEGACY databases
    // that still carry them.
    //
    // GUARDED DROP — never delete user data. Each table is dropped ONLY IF it is
    // empty (`SELECT COUNT(*) = 0`). A non-empty table is left in place with a
    // `tracing::warn` so a user who somehow populated it keeps their rows and is
    // told why the table survived. Child tables are dropped before `skills` to
    // respect the FK references. Because `already_applied` is schema-shape-based
    // (no migration ledger), a non-empty table simply means this step re-checks
    // (and re-warns) on each boot until the rows are gone — cheap and informative.
    // NOTE: this step MUST live in `run_incremental` (not `ensure_composite_fires_table`)
    // — `init_test_db` and the boot path replay both, but only `run_incremental` is
    // the canonical home for schema teardown of this kind.
    run_step(
        conn,
        IncrementalMigration {
            id: "retire_db_skills_system",
            description: "Drop the orphaned DB skills system (skills/skill_components/persona_skills) IF empty; leave non-empty tables in place with a warning",
            already_applied: |conn| {
                Ok(!has_table(conn, "skills")?
                    && !has_table(conn, "skill_components")?
                    && !has_table(conn, "persona_skills")?)
            },
            apply: |conn| {
                // Drop children first (both reference skills(id)).
                for table in ["persona_skills", "skill_components", "skills"] {
                    if !has_table(conn, table)? {
                        continue;
                    }
                    let count: i64 = conn.query_row(
                        &format!("SELECT COUNT(*) FROM {table}"),
                        [],
                        |r| r.get(0),
                    )?;
                    if count == 0 {
                        ddl_step(conn, &format!("DROP TABLE IF EXISTS {table};"))?;
                    } else {
                        tracing::warn!(
                            table,
                            row_count = count,
                            "Retired DB skills system: leaving non-empty table in place to avoid deleting user data; drop it manually if the rows are no longer needed"
                        );
                    }
                }
                Ok(())
            },
        },
    )?;

    // Skill usage telemetry (Brainiac-adoption P1 — docs/plans/brainiac-adoption-
    // skills-memory-docs.md). Registry = filesystem-reconciled identity + hash
    // history for `.claude/skills` (global + per-project); events = APPEND-ONLY
    // invocation log mined from Claude Code transcripts (repos expose
    // insert+select only — the Brainiac grant discipline); scan_state = per-file
    // byte watermark so mining stays incremental. Names deliberately avoid the
    // retired System-A `skills` tables above. MUST stay INSIDE `run_incremental`
    // (the tail belongs to `ensure_composite_fires_table`).
    run_step(
        conn,
        IncrementalMigration {
            id: "skill_usage_telemetry",
            description: "Skill registry + append-only usage events + transcript scan watermarks",
            already_applied: |conn| has_table(conn, "skill_usage_events"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS skill_registry (
                        id              TEXT PRIMARY KEY,
                        name            TEXT NOT NULL,
                        scope           TEXT NOT NULL CHECK (scope IN ('global','project')),
                        project_id      TEXT,
                        content_hash    TEXT,
                        description     TEXT,
                        origin          TEXT NOT NULL DEFAULT 'authored',
                        first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
                        last_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
                        missing_since   TEXT
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_registry_ident
                        ON skill_registry(name, scope, COALESCE(project_id,''));
                    CREATE TABLE IF NOT EXISTS skill_revisions (
                        skill_id     TEXT NOT NULL REFERENCES skill_registry(id) ON DELETE CASCADE,
                        rev          INTEGER NOT NULL,
                        content_hash TEXT,
                        changed_at   TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (skill_id, rev)
                    );
                    CREATE TABLE IF NOT EXISTS skill_usage_events (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        skill_name  TEXT NOT NULL,
                        project_id  TEXT,
                        session_id  TEXT,
                        event       TEXT NOT NULL CHECK (event IN ('invoke','fetch')),
                        source      TEXT NOT NULL CHECK (source IN ('transcript','dev_runner')),
                        occurred_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_sue_name
                        ON skill_usage_events(skill_name, project_id, occurred_at DESC);
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_sue_dedup
                        ON skill_usage_events(session_id, skill_name, occurred_at);
                    CREATE TABLE IF NOT EXISTS skill_scan_state (
                        file_path   TEXT PRIMARY KEY,
                        byte_offset INTEGER NOT NULL DEFAULT 0,
                        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Doc-rot telemetry (Brainiac-adoption P2). doc_status = the local
    // `dirty_at` (git-derived: coupled sources newer than the doc);
    // doc_read_events = APPEND-ONLY reads mined from transcripts, stamped
    // `was_dirty` at insert so "rot being consumed" survives the doc later
    // getting fixed (Brainiac 0025's harm-ranking signal). Resetting
    // skill_scan_state is deliberate: the shared transcript miner now also
    // extracts doc reads, and already-consumed bytes must be re-mined once to
    // backfill them (skill events dedup via their unique index, so the replay
    // is idempotent). MUST stay INSIDE `run_incremental`.
    run_step(
        conn,
        IncrementalMigration {
            id: "doc_rot_telemetry",
            description: "Git-derived doc dirty tracking + append-only doc read events (+ one-time miner watermark reset)",
            already_applied: |conn| has_table(conn, "doc_read_events"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS doc_status (
                        project_id         TEXT NOT NULL,
                        doc_path           TEXT NOT NULL,
                        coupled_scope      TEXT,
                        last_doc_commit    TEXT,
                        last_source_commit TEXT,
                        dirty_since        TEXT,
                        changed_sources    TEXT,
                        scanned_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (project_id, doc_path)
                    );
                    CREATE INDEX IF NOT EXISTS idx_doc_status_dirty
                        ON doc_status(project_id, dirty_since) WHERE dirty_since IS NOT NULL;
                    CREATE TABLE IF NOT EXISTS doc_read_events (
                        id         INTEGER PRIMARY KEY AUTOINCREMENT,
                        project_id TEXT NOT NULL,
                        doc_path   TEXT NOT NULL,
                        session_id TEXT,
                        was_dirty  INTEGER NOT NULL DEFAULT 0,
                        read_at    TEXT NOT NULL
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_dre_dedup
                        ON doc_read_events(session_id, project_id, doc_path, read_at);
                    CREATE INDEX IF NOT EXISTS idx_dre_doc
                        ON doc_read_events(project_id, doc_path, read_at DESC);
                    DELETE FROM skill_scan_state;",
                )?;
                Ok(())
            },
        },
    )?;

    // Skill semantic versioning (docs/skill-standard.md). The declared
    // `version:` frontmatter ("major.minor") joins the hash-based identity:
    // registry rows carry the current declared version, revision rows the
    // version at each hash change. NULL = the skill predates the standard
    // (unversioned; consumers treat it as an implicit 1.0). Existing revision
    // rows stay NULL — history is not fabricated. MUST stay INSIDE
    // `run_incremental`.
    run_step(
        conn,
        IncrementalMigration {
            id: "skill_semantic_version",
            description: "Declared major.minor skill version on registry + revision rows",
            already_applied: |conn| {
                // Missing table (test binaries drop some tables) counts as
                // applied — ALTER on a missing table would hard-fail.
                Ok(!has_table(conn, "skill_registry")?
                    || has_column(conn, "skill_registry", "version")?)
            },
            apply: |conn| {
                if has_table(conn, "skill_registry")? {
                    ddl_step(conn, "ALTER TABLE skill_registry ADD COLUMN version TEXT;")?;
                }
                if has_table(conn, "skill_revisions")? {
                    ddl_step(conn, "ALTER TABLE skill_revisions ADD COLUMN version TEXT;")?;
                }
                Ok(())
            },
        },
    )?;

    // Doc-rot content signal. The git rule (coupled sources newer than the
    // doc) cannot express "this doc names a file that no longer exists" — and
    // that case used to be INVISIBLE: a doc whose references had all been
    // renamed away coupled to nothing, went unscoped, and unscoped never went
    // dirty. `broken_refs` is the JSON list of referenced repo paths that are
    // gone while their parent directory still stands. Additive; a legacy row
    // reads NULL and degrades to "no content evidence", never to a false pass.
    run_step(
        conn,
        IncrementalMigration {
            id: "doc_rot_broken_refs",
            description: "doc_status.broken_refs — referenced repo paths that no longer exist",
            already_applied: |conn| has_column(conn, "doc_status", "broken_refs"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE doc_status ADD COLUMN broken_refs TEXT")?;
                Ok(())
            },
        },
    )?;

    // Memory claims + knowledge health (Brainiac-adoption P3). memory_claims =
    // the open-until-resolved dispute loop (Brainiac memory_feedback): a
    // negative claim (`wrong`/`outdated`) stays OPEN until a human answers
    // reverified/deprecated/dismissed; `helpful` asserts nothing to fix and is
    // never "open". persona_memories.open_claim_count is the denormalized
    // open-NEGATIVE counter the decay scorer reads (MEMORY CONTRACT-adjacent:
    // only the claims repo writes it). knowledge_health_snapshots = per-scope
    // currency/consistency/governance rollups for trend lines (Brainiac 0014).
    // NOTE deliberate deviations from the adoption plan, recorded there too:
    // no `valid_to` column (category half-life decay + the working-tier 30-day
    // expiry + ACTIVE_CAP already implement TTL/neglect in continuous form)
    // and no `superseded_by` (derived_from + archive cover lineage until a
    // real supersession writer exists). MUST stay INSIDE `run_incremental`.
    run_step(
        conn,
        IncrementalMigration {
            id: "memory_claims_health",
            description: "Memory dispute claims (open-until-resolved) + open-claim counter + knowledge health snapshots",
            already_applied: |conn| has_table(conn, "memory_claims"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS memory_claims (
                        id              TEXT PRIMARY KEY,
                        memory_id       TEXT NOT NULL REFERENCES persona_memories(id) ON DELETE CASCADE,
                        verdict         TEXT NOT NULL CHECK (verdict IN ('helpful','wrong','outdated')),
                        note            TEXT,
                        source          TEXT NOT NULL DEFAULT 'user',
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        resolution      TEXT CHECK (resolution IN ('reverified','deprecated','dismissed')),
                        resolution_note TEXT,
                        resolved_at     TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_memory_claims_memory
                        ON memory_claims(memory_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_memory_claims_open
                        ON memory_claims(memory_id)
                        WHERE resolution IS NULL AND verdict != 'helpful';
                    ALTER TABLE persona_memories ADD COLUMN open_claim_count INTEGER NOT NULL DEFAULT 0;
                    CREATE TABLE IF NOT EXISTS knowledge_health_snapshots (
                        id          TEXT PRIMARY KEY,
                        scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('persona','team','project')),
                        scope_id    TEXT NOT NULL,
                        captured_at TEXT NOT NULL DEFAULT (datetime('now')),
                        score       INTEGER NOT NULL,
                        currency    INTEGER,
                        consistency INTEGER,
                        governance  INTEGER,
                        stale_count INTEGER,
                        total_count INTEGER,
                        open_claims INTEGER
                    );
                    CREATE INDEX IF NOT EXISTS idx_khs_scope
                        ON knowledge_health_snapshots(scope_kind, scope_id, captured_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Triage/Run-Desk keyset indexes. Both surfaces order by
    // `created_at DESC` under a status (and, for tasks, a project) filter;
    // without these the paged reads degrade to a full scan + sort of
    // `dev_ideas` / `dev_tasks` on every page. MUST stay INSIDE
    // `run_incremental` — the file's tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE this function.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_triage_page_indexes",
            description: "Keyset indexes for the unified Backlog (dev_ideas) and Run Desk (dev_tasks) paged reads",
            already_applied: |conn| has_index(conn, "idx_dev_ideas_triage"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_ideas_triage
                        ON dev_ideas(status, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_dev_tasks_page
                        ON dev_tasks(project_id, status, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // `pending` was never part of the dev_tasks vocabulary
    // (queued|running|completed|failed|cancelled) but a legacy writer used it,
    // and every status-driven surface rendered those rows as nothing — they
    // were invisible AND unrunnable. Idempotent by construction: after the
    // first pass the UPDATE matches zero rows, so it can run on every boot.
    ddl_step(
        conn,
        "UPDATE dev_tasks SET status = 'queued' WHERE status = 'pending';",
    )?;

    // Durable auto-run ledger. The scheduler's state lived only in the
    // in-memory `AUTO_RUN_JOBS` map, so a restart mid-wave lost the run
    // entirely — the banner vanished and nothing recorded why the wave
    // stopped. This table is the restart-surviving record; the in-memory map
    // stays the live view.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_auto_runs (
            id                 TEXT PRIMARY KEY,
            project_id         TEXT,
            status             TEXT,
            snapshot_size      INTEGER,
            completed          INTEGER,
            failed             INTEGER,
            skipped            INTEGER,
            iterations         INTEGER,
            termination_reason TEXT,
            started_at         TEXT,
            finished_at        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_dev_auto_runs_project
            ON dev_auto_runs(project_id, started_at DESC);",
    )?;

    // -- Dev Tools: per-context deterministic structural fingerprint ------------
    // The scan-efficiency keystone. Every scan (context map, skills coverage,
    // engineering-pattern compliance) used to re-read files to answer ONE
    // question and then throw the reading away: a probe over this repo read
    // 13,622 files to answer 6 questions, because the only narrowing metadata
    // was `dev_contexts.category` (4 values) — all 236 `description` fields are
    // the literal placeholder "Pending LLM description".
    //
    // This table caches CHEAP DETERMINISTIC FACTS (no LLM, no network) per
    // context, keyed by `content_hash` — a hash over the context's file LIST
    // and each file's sha256, so any membership OR content change invalidates
    // it. Future questions become SQL instead of file reads.
    //
    // MUST stay INSIDE `run_incremental` — the file's tail belongs to
    // `ensure_composite_fires_table`, which runs BEFORE this function.

    Ok(())
}
