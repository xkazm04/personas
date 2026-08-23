//! Memory-review proposals, background jobs and curation schedules, business
//! outcome attribution, setup status, execution annotations, notification
//! subscriptions, the Twin plugin tables, and Discord/Slack inbound polling.
//!
//! Slice of the original `run_incremental` / `ensure_composite_fires_table`
//! body, moved verbatim. The driver calls these modules in the same order
//! the statements appeared in, so the executed step sequence is unchanged.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    let has_audit_incidents: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='audit_incidents'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_audit_incidents {
        ddl_step(
                    conn,
                            "CREATE TABLE IF NOT EXISTS audit_incidents (
                id              TEXT PRIMARY KEY,
                source_table    TEXT NOT NULL,
                source_id       TEXT NOT NULL,
                dedup_key       TEXT NOT NULL UNIQUE,
                persona_id      TEXT,
                persona_name    TEXT,
                execution_id    TEXT,
                severity        TEXT NOT NULL,
                kind            TEXT NOT NULL,
                title           TEXT NOT NULL,
                detail          TEXT,
                status          TEXT NOT NULL DEFAULT 'open',
                acknowledged_at TEXT,
                acknowledged_by TEXT,
                resolved_at     TEXT,
                resolution_note TEXT,
                continued_at    TEXT,
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_ai_status   ON audit_incidents(status, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_ai_persona  ON audit_incidents(persona_id, status);
            CREATE INDEX IF NOT EXISTS idx_ai_severity ON audit_incidents(severity, status);
            CREATE INDEX IF NOT EXISTS idx_ai_source   ON audit_incidents(source_table, source_id);"
        )?;
        tracing::info!("Created audit_incidents table (cross-source incidents inbox)");
    }

    // -- mode + companion_session_id columns on build_sessions ---------------
    // `mode` selects between 'interactive' (the legacy ask-the-user gate flow)
    // and 'one_shot' (autonomous build: LLM resolves every gate, retries up to
    // 3× on test failure, auto-promotes on success). Default NULL is treated
    // as 'interactive' at read time so existing rows stay on the proven path.
    //
    // `companion_session_id` links a build_session back to the Companion chat
    // session that originated it (when applicable) so the BuildWatcher job
    // can post a result message into that session's episode log on terminal
    // phase. NULL when the session was started from the regular UI.
    if !has_column(conn, "build_sessions", "mode")? {
        ddl_step(conn, "ALTER TABLE build_sessions ADD COLUMN mode TEXT;")?;
        tracing::info!("Added mode column to build_sessions");
    }
    if !has_column(conn, "build_sessions", "companion_session_id")? {
        ddl_step(
            conn,
            "ALTER TABLE build_sessions ADD COLUMN companion_session_id TEXT;",
        )?;
        tracing::info!("Added companion_session_id column to build_sessions");
    }

    // 2026-05-09 — Stage B Phase 1a: Recipe provenance for template-derived
    // recipes. Allows linking a recipe back to the (template, use_case_id) it
    // was derived from, so re-imports stay idempotent (Stage B Phase 1b's
    // derive_recipes_from_template can detect existing rows and update vs
    // create) and downstream UX can surface "newer version available" badges
    // when a template author bumps a recipe.
    //
    // All four columns are nullable: existing recipes (none of which are
    // template-derived today) keep NULL provenance and behave unchanged.
    // The unique index is partial — only enforced when source_template_id is
    // NOT NULL — so user-authored recipes with NULL provenance don't collide.
    if !has_column(conn, "recipe_definitions", "source_template_id")? {
        ddl_step(
            conn,
            "ALTER TABLE recipe_definitions ADD COLUMN source_template_id TEXT;
             ALTER TABLE recipe_definitions ADD COLUMN source_use_case_id TEXT;
             ALTER TABLE recipe_definitions ADD COLUMN source_use_case_name TEXT;
             ALTER TABLE recipe_definitions ADD COLUMN source_version TEXT;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_definitions_source
               ON recipe_definitions(source_template_id, source_use_case_id)
               WHERE source_template_id IS NOT NULL;",
        )?;
        tracing::info!(
            "Added provenance columns (source_template_id, source_use_case_id, source_use_case_name, source_version) + unique index to recipe_definitions"
        );
    }

    // 2026-05-09 — Stage D Phase 4: telemetry for the Glyph composer's recipe
    // suggestion chip. Append-only events log impression/accept/dismiss with
    // the match score for later eligibility analysis (Phase 5 mode-2 gate).
    // No FK to recipe_definitions — recipe deletes shouldn't cascade-delete
    // this audit trail. Index keyed on created_at DESC because every read is
    // a "last N events" query.
    if !has_table(conn, "recipe_suggestion_events")? {
        ddl_step(
            conn,
            "CREATE TABLE recipe_suggestion_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id TEXT NOT NULL,
                event_type TEXT NOT NULL CHECK(event_type IN ('impression','accept','dismiss')),
                score REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE INDEX IF NOT EXISTS idx_recipe_suggestion_events_created_at
               ON recipe_suggestion_events(created_at DESC);",
        )?;
        tracing::info!(
            "Created recipe_suggestion_events table + idx_recipe_suggestion_events_created_at"
        );
    }

    // Memory curation review proposals — concept borrowed from Anthropic
    // Managed Agents' dream pipeline (immutable input, separate output
    // store, review-and-discard). Personas's `review_memories_with_cli`
    // can write a proposal here instead of mutating directly; the user
    // explicitly applies or discards the proposal in a second step.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memory_review_proposal",
            description:
                "Create persona_memory_review_proposal table for review-and-discard memory curation",
            already_applied: |conn| has_table(conn, "persona_memory_review_proposal"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_memory_review_proposal (
                        id              TEXT PRIMARY KEY,
                        persona_id      TEXT,
                        threshold       INTEGER NOT NULL,
                        instructions    TEXT,
                        proposal_json   TEXT NOT NULL,
                        summary         TEXT,
                        reviewed_count  INTEGER NOT NULL DEFAULT 0,
                        proposed_changes INTEGER NOT NULL DEFAULT 0,
                        status          TEXT NOT NULL DEFAULT 'pending_review',
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        decided_at      TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_persona_memory_review_proposal_status
                        ON persona_memory_review_proposal(status, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_persona_memory_review_proposal_persona
                        ON persona_memory_review_proposal(persona_id, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;
    // NOTE: this step MUST live in run_incremental AFTER the table-creating
    // step above — the file's tail belongs to `ensure_composite_fires_table`,
    // which initial::run calls BEFORE run_incremental (an ALTER placed there
    // fails on fresh databases with "no such table").
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memory_review_proposal.team_id",
            description: "Team-scoped reflection proposals: NULL for persona proposals; set when a reflection pass consolidated memories across a team's members",
            already_applied: |conn| has_column(conn, "persona_memory_review_proposal", "team_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memory_review_proposal ADD COLUMN team_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // User-persona background-job table — projects the dream-job shape
    // (queued → running → completed | failed | canceled) onto the
    // user-personas side, mirroring `companion_background_job` for the
    // companion side. Worker lives in `engine::persona_jobs`. v1 ships
    // one kind: `memory_curation_run`.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_background_job",
            description: "Create persona_background_job table for async memory curation runs",
            already_applied: |conn| has_table(conn, "persona_background_job"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_background_job (
                        id                TEXT PRIMARY KEY,
                        kind              TEXT NOT NULL,
                        status            TEXT NOT NULL DEFAULT 'queued',
                        params_json       TEXT NOT NULL DEFAULT '{}',
                        persona_id        TEXT,
                        result_text       TEXT,
                        error_text        TEXT,
                        cancel_requested  INTEGER NOT NULL DEFAULT 0,
                        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                        started_at        TEXT,
                        completed_at      TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_persona_background_job_status
                        ON persona_background_job(status, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_persona_background_job_persona
                        ON persona_background_job(persona_id, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Per-persona curation schedule — F-CRON. Drives nightly memory
    // curation runs via `engine::curation_scheduler::tick`. One row
    // per persona at most. cron_expr is a 5-field cron expression
    // validated against `engine::cron::parse_cron` at the IPC
    // boundary. NULL `last_curation_at` = never run yet (scheduler
    // uses created_at as the reference point on first fire).
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_curation_schedule",
            description: "Create persona_curation_schedule table for scheduled memory curation",
            already_applied: |conn| has_table(conn, "persona_curation_schedule"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_curation_schedule (
                        persona_id        TEXT PRIMARY KEY
                                          REFERENCES personas(id) ON DELETE CASCADE,
                        cron_expr         TEXT NOT NULL,
                        last_curation_at  TEXT,
                        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Smee relay origin allowlist. JSON-encoded array of `owner/repo` strings.
    // When populated, the SSE relay drops events whose body.repository.full_name
    // is not in the list. NULL = back-compat (accept any repo, log warning).
    run_step(
        conn,
        IncrementalMigration {
            id: "smee_relays_allowed_repos",
            description: "Add allowed_repos column to smee_relays for origin authentication",
            already_applied: |conn| has_column(conn, "smee_relays", "allowed_repos"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE smee_relays ADD COLUMN allowed_repos TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Per-execution business outcome tracking. The existing `status` column
    // ('completed', 'failed', …) only captures whether the CLI subprocess
    // ran cleanly; many "completed" runs in fact produce no business value
    // ("no input provided", "no connector wired", "readiness report only").
    // `business_outcome` is the LLM's self-assessment of whether the run
    // actually delivered the persona's promised job. Emitted by the persona
    // via `<business_outcome>{value_delivered|no_input_available|
    // precondition_failed|partial}</business_outcome>` and parsed by the
    // runner. Default `unknown` for back-compat with rows that pre-date this
    // column.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions_business_outcome",
            description: "Add business_outcome column to persona_executions",
            already_applied: |conn| has_column(conn, "persona_executions", "business_outcome"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "ALTER TABLE persona_executions ADD COLUMN business_outcome TEXT NOT NULL DEFAULT 'unknown';
                     CREATE INDEX IF NOT EXISTS idx_pe_persona_outcome
                         ON persona_executions(persona_id, business_outcome);",
                )?;
                Ok(())
            },
        },
    )?;

    // Per-persona setup status. The adoption pre-flight (C1) writes
    // `needs_credentials` when the persona declares connectors that have no
    // vault credential bound; the persona-detail view surfaces this via a
    // "Setup required" badge and the scheduler refuses to auto-execute until
    // the user resolves it. Default `ready` for back-compat.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas_setup_status",
            description: "Add setup_status column to personas",
            already_applied: |conn| has_column(conn, "personas", "setup_status"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE personas ADD COLUMN setup_status TEXT NOT NULL DEFAULT 'ready';
                     CREATE INDEX IF NOT EXISTS idx_personas_setup_status
                         ON personas(setup_status);",
                )?;
                Ok(())
            },
        },
    )?;

    // Execution annotations: free-form tags, a note, and a star per execution.
    // One row per (execution_id, author) so a single human user (the default
    // 'user' author) overwrites their own annotation on re-save instead of
    // accumulating duplicates. Mirrors LangSmith trace annotations.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_execution_annotations",
            description: "Add persona_execution_annotations table",
            already_applied: |conn| has_table(conn, "persona_execution_annotations"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS persona_execution_annotations (
                        id           TEXT PRIMARY KEY,
                        execution_id TEXT NOT NULL REFERENCES persona_executions(id) ON DELETE CASCADE,
                        persona_id   TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                        author       TEXT NOT NULL DEFAULT 'user',
                        tags         TEXT,
                        note         TEXT,
                        starred      INTEGER NOT NULL DEFAULT 0,
                        created_at   TEXT NOT NULL,
                        updated_at   TEXT NOT NULL,
                        UNIQUE(execution_id, author)
                    );
                    CREATE INDEX IF NOT EXISTS idx_pea_execution ON persona_execution_annotations(execution_id);
                    CREATE INDEX IF NOT EXISTS idx_pea_persona   ON persona_execution_annotations(persona_id);
                    CREATE INDEX IF NOT EXISTS idx_pea_starred   ON persona_execution_annotations(persona_id, starred);",
                )?;
                Ok(())
            },
        },
    )?;

    // Outbound webhook notification subscriptions. Routes persona_events to
    // Slack/Discord/Teams/generic JSON webhooks via Mustache-style templates.
    // See `src-tauri/src/notifications/` for the dispatcher worker.
    run_step(
        conn,
        IncrementalMigration {
            id: "notification_subscriptions",
            description: "Create notification_subscriptions table for outbound webhook routing",
            already_applied: |conn| has_table(conn, "notification_subscriptions"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS notification_subscriptions (
                        id                   TEXT PRIMARY KEY,
                        label                TEXT NOT NULL,
                        provider             TEXT NOT NULL,
                        webhook_url          TEXT,
                        credential_id        TEXT REFERENCES persona_credentials(id) ON DELETE SET NULL,
                        event_types          TEXT NOT NULL,
                        template_body        TEXT,
                        enabled              INTEGER NOT NULL DEFAULT 1,
                        last_delivery_at     TEXT,
                        last_delivery_status TEXT,
                        last_error           TEXT,
                        created_at           TEXT NOT NULL,
                        updated_at           TEXT NOT NULL
                    );
                     CREATE INDEX IF NOT EXISTS idx_notif_subs_enabled
                         ON notification_subscriptions(enabled);
                     CREATE TABLE IF NOT EXISTS notification_dispatch_watermark (
                        id              INTEGER PRIMARY KEY CHECK (id = 1),
                        last_event_at   TEXT NOT NULL,
                        updated_at      TEXT NOT NULL
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Twin reflections — operator-audit journals. Each row is a prose summary
    // ("what's the relationship with Alice been about?") generated by Claude
    // from the twin's profile + recent communications. Stage 1 ships the
    // table + manual "Reflect" UI; future stages add scheduled reflections
    // and per-contact scoping. See docs/features/twin.md (Cycle 15).
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_reflections",
            description: "Create twin_reflections table for operator-audit journals",
            already_applied: |conn| has_table(conn, "twin_reflections"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS twin_reflections (
                        id          TEXT PRIMARY KEY,
                        twin_id     TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
                        prompt_seed TEXT NOT NULL,
                        content     TEXT NOT NULL,
                        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                     CREATE INDEX IF NOT EXISTS idx_twin_reflections_twin
                         ON twin_reflections(twin_id, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Twin contacts — durable per-twin record of every handle the twin has
    // interacted with on any channel. Auto-populated from twin_communications
    // (handles seen via list_contacts_with_activity) + manually editable
    // alias/notes. Stage 1 of the per-contact memory work; Stage 2 will add
    // proactive nudges scoped per (twin_id, contact_handle).
    // See docs/features/twin.md (Cycle 14).
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_contacts",
            description: "Create twin_contacts table for per-contact aliases and notes",
            already_applied: |conn| has_table(conn, "twin_contacts"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS twin_contacts (
                        id          TEXT PRIMARY KEY,
                        twin_id     TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
                        handle      TEXT NOT NULL,
                        alias       TEXT,
                        notes       TEXT,
                        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(twin_id, handle)
                    );
                     CREATE INDEX IF NOT EXISTS idx_twin_contacts_twin
                         ON twin_contacts(twin_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- disabled_dims_json on build_sessions + personas ---------------
    // 2026-05-18 — sigil-driven adoption (Phase 4): when the user toggles
    // a petal "off" in the SigilEditModal, that capability's bound
    // questions become inert. The runner skips emitting them; the
    // runtime executor won't surface the dim in any UI summary. Two
    // storage paths because the lifecycle differs:
    //   - build_sessions.disabled_dims_json: in-flight adoption state.
    //     Cleared when the session ends (along with the rest of the
    //     row). The runner reads this to decide whether to emit a
    //     question (`use_case_id` + `dimension` must NOT match any
    //     entry in the disabled map).
    //   - personas.disabled_dims_json: durable per-persona override.
    //     Survives past adoption — a user editing a view-mode persona
    //     can disable a dim on a capability, and that choice persists
    //     to future re-builds + runtime.
    // Shape: JSON object `{ [use_case_id: string]: GlyphDimension[] }`.
    // NULL is treated as "no disabled dims".
    if !has_column(conn, "build_sessions", "disabled_dims_json")? {
        ddl_step(
            conn,
            "ALTER TABLE build_sessions ADD COLUMN disabled_dims_json TEXT;",
        )?;
        tracing::info!("Added disabled_dims_json column to build_sessions");
    }
    if !has_column(conn, "personas", "disabled_dims_json")? {
        ddl_step(
            conn,
            "ALTER TABLE personas ADD COLUMN disabled_dims_json TEXT;",
        )?;
        tracing::info!("Added disabled_dims_json column to personas");
    }

    // Twin pending memories — back-cite the source communication when the
    // memory was queued via `record_interaction`. NULL for legacy rows and
    // for memories created by URL ingest / wiki audit (where no single
    // communication produced them). See docs/features/twin.md (Cycle 13).
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_pending_memories_source_communication_id",
            description:
                "Add source_communication_id column to twin_pending_memories for provenance",
            already_applied: |conn| {
                has_column(conn, "twin_pending_memories", "source_communication_id")
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE twin_pending_memories ADD COLUMN source_communication_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Twin distilled facts — curated, deduplicated facts about the twin or
    // its contacts, with provenance citing source twin_communications rows.
    // Foundation table for the future consolidation + recall pipeline ported
    // from companion::brain. See docs/features/twin.md (Cycle 12).
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_distilled_facts",
            description: "Create twin_distilled_facts table for curated, cited facts",
            already_applied: |conn| has_table(conn, "twin_distilled_facts"),
            apply: |conn| {
                ddl_step(
                    conn,
                                    "CREATE TABLE IF NOT EXISTS twin_distilled_facts (
                        id              TEXT PRIMARY KEY,
                        twin_id         TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
                        contact_handle  TEXT,
                        content         TEXT NOT NULL,
                        importance      INTEGER NOT NULL DEFAULT 3,
                        sources_json    TEXT NOT NULL DEFAULT '[]',
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        last_seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                     CREATE INDEX IF NOT EXISTS idx_twin_facts_twin
                         ON twin_distilled_facts(twin_id);
                     CREATE INDEX IF NOT EXISTS idx_twin_facts_contact
                         ON twin_distilled_facts(twin_id, contact_handle);
                     CREATE INDEX IF NOT EXISTS idx_twin_facts_importance
                         ON twin_distilled_facts(twin_id, importance DESC, last_seen_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Discord inbound polling — cursor state per (persona, channel) and a log
    // of messages we've fanned out to execute_persona so we can dedupe across
    // restarts and post replies once the run finishes. See
    // `engine/discord_poller.rs` for the loop that consumes these tables.
    run_step(
        conn,
        IncrementalMigration {
            id: "discord_inbound_polling",
            description: "Create discord_poll_state and discord_inbound_messages",
            already_applied: |conn| has_table(conn, "discord_poll_state"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS discord_poll_state (
                        persona_id      TEXT NOT NULL,
                        channel_id      TEXT NOT NULL,
                        last_message_id TEXT NOT NULL DEFAULT '',
                        last_polled_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (persona_id, channel_id)
                    );
                     CREATE TABLE IF NOT EXISTS discord_inbound_messages (
                        message_id          TEXT PRIMARY KEY,
                        persona_id          TEXT NOT NULL,
                        channel_id          TEXT NOT NULL,
                        credential_id       TEXT NOT NULL,
                        author_id           TEXT NOT NULL DEFAULT '',
                        execution_id        TEXT,
                        replied_message_id  TEXT,
                        received_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        replied_at          TEXT,
                        error               TEXT
                    );
                     CREATE INDEX IF NOT EXISTS idx_discord_inbound_pending
                         ON discord_inbound_messages(persona_id, channel_id, replied_message_id);
                     CREATE INDEX IF NOT EXISTS idx_discord_inbound_received
                         ON discord_inbound_messages(received_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Slack inbound polling — mirror of the Discord tables above. Cursor
    // state per (persona, channel) keyed by the latest message `ts`, plus a
    // log of messages we've fanned out to execute_persona so we can dedupe
    // across restarts and post threaded replies once the run finishes. See
    // `engine/slack_poller.rs` for the loop that consumes these tables.
    run_step(
        conn,
        IncrementalMigration {
            id: "slack_inbound_polling",
            description: "Create slack_poll_state and slack_inbound_messages",
            already_applied: |conn| has_table(conn, "slack_poll_state"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS slack_poll_state (
                        persona_id      TEXT NOT NULL,
                        channel_id      TEXT NOT NULL,
                        last_ts         TEXT NOT NULL DEFAULT '',
                        last_polled_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (persona_id, channel_id)
                    );
                     CREATE TABLE IF NOT EXISTS slack_inbound_messages (
                        message_ts          TEXT NOT NULL,
                        channel_id          TEXT NOT NULL,
                        persona_id          TEXT NOT NULL,
                        credential_id       TEXT NOT NULL,
                        author_id           TEXT NOT NULL DEFAULT '',
                        thread_ts           TEXT NOT NULL DEFAULT '',
                        execution_id        TEXT,
                        replied_message_ts  TEXT,
                        received_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        replied_at          TEXT,
                        error               TEXT,
                        PRIMARY KEY (channel_id, message_ts)
                    );
                     CREATE INDEX IF NOT EXISTS idx_slack_inbound_pending
                         ON slack_inbound_messages(persona_id, channel_id, replied_message_ts);
                     CREATE INDEX IF NOT EXISTS idx_slack_inbound_received
                         ON slack_inbound_messages(received_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // Widen persona_executions.status CHECK to include 'incomplete' — a
    // valid ExecutionState terminal variant the original constraint
    // omitted. Must run last: the rebuild copies the table via its own
    // stored DDL, so every prior `ADD COLUMN` migration must already be
    // applied for the new table to carry the full column set.

    Ok(())
}
