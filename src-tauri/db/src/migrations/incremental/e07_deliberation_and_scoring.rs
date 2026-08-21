//! Retiring persona_groups, multi-instance claim columns, director scoring,
//! OAuth keepalive policy, and the team deliberation plane (deliberations,
//! agenda, channel messages, capability claims, north star).
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
            id: "retire_persona_groups",
            description: "Drop persona_groups table + persona_memories/dev_projects group_id columns (Groups→Teams Phase 5)",
            // Was `|_conn| Ok(false)` — always-run. Combined with the two
            // additive steps above (now deleted) that made this a permanent
            // drop/re-add cycle costing ~186 ms and two full table rewrites per
            // launch, forever.
            //
            // The always-run guard was not unreasonable on its own: the drops
            // below are individually guarded and tolerate failure, so re-running
            // was harmless in isolation. The defect was a relationship between
            // steps 370 lines apart, which no per-step instrument can see.
            //
            // This is a POSTCONDITION guard: it asserts the state the step
            // exists to reach, rather than claiming a step id was recorded
            // (there is no ledger to record it in). Fresh installs never create
            // these objects, so it short-circuits there too.
            already_applied: |conn| {
                Ok(!has_table(conn, "persona_groups")?
                    && !has_column(conn, "persona_memories", "group_id")?
                    && !has_column(conn, "dev_projects", "group_id")?)
            },
            apply: |conn| {
                // Drop dependent indexes first — SQLite DROP COLUMN refuses an
                // indexed column. IF EXISTS keeps this safe on fresh DBs.
                let _ = ddl_step(conn, "DROP INDEX IF EXISTS idx_personas_group_id;");
                let _ = ddl_step(conn, "DROP INDEX IF EXISTS idx_pm_group_id;");
                let _ = ddl_step(conn, "DROP INDEX IF EXISTS idx_dev_projects_group_id;");

                // No-FK columns: safe native DROP COLUMN. has_column guard makes
                // it a no-op on fresh DBs and on re-run — so "no such column"
                // is already impossible and the discarded Result could only ever
                // have been hiding a real failure. SQLite refuses DROP COLUMN
                // while any index/trigger/view still names the column; on these
                // two tables the consequence is a leftover dead column, which is
                // not worth aborting a launch over. So: report, don't swallow,
                // don't brick.
                if has_column(conn, "persona_memories", "group_id")? {
                    report_failed_group_id_drop(
                        "persona_memories",
                        ddl_step(conn, "ALTER TABLE persona_memories DROP COLUMN group_id;"),
                    );
                }
                if has_column(conn, "dev_projects", "group_id")? {
                    report_failed_group_id_drop(
                        "dev_projects",
                        ddl_step(conn, "ALTER TABLE dev_projects DROP COLUMN group_id;"),
                    );
                }

                // Drop the personas.group_id FK column outright. NULLing it is
                // NOT enough: with `PRAGMA foreign_keys = ON`, every INSERT into
                // personas resolves the FK's parent table, so leaving the FK in
                // place while dropping `persona_groups` breaks ALL persona
                // creation with "no such table: persona_groups". DROP COLUMN
                // removes the dangling FK (mirrors persona_memories/dev_projects
                // above; the index was already dropped). Guarded + idempotent.
                if has_column(conn, "personas", "group_id")? {
                    ddl_step(conn, "UPDATE personas SET group_id = NULL;")?;
                    if let Err(e) = ddl_step(conn, "ALTER TABLE personas DROP COLUMN group_id;") {
                        // Do NOT fall through to the DROP TABLE below. SQLite
                        // refuses DROP COLUMN while any index/trigger/view still
                        // names the column, and with the FK column left in place
                        // dropping `persona_groups` makes EVERY `INSERT INTO
                        // personas` fail with "no such table: persona_groups" —
                        // precisely the breakage the comment above describes.
                        // Discarding this Result made that outcome both silent
                        // and reachable. Keep both objects, log loudly, retry on
                        // the next launch (this step re-runs every boot).
                        tracing::error!(
                            error = %e,
                            "retire_persona_groups: could not drop personas.group_id — keeping \
                             persona_groups so persona creation keeps working; will retry on \
                             the next launch",
                        );
                        return Ok(());
                    }
                }
                let _ = ddl_step(conn, "DROP TABLE IF EXISTS persona_groups;");
                Ok(())
            },
        },
    )?;

    // Multi-driver orchestration (ADR 2026-05-26): per-row claim/lease columns
    // so MCP/REST-submitted executions and build-session promotions are run by
    // exactly ONE instance. The leader (or any instance) CAS-claims a queued
    // row by stamping `claimed_by_instance` + a `claim_expires_at` TTL; the TTL
    // lets a crashed claimant's row be re-claimed (mirrors the `trigger_version`
    // CAS already used by the scheduler). Additive + idempotent. The local-UI
    // path does NOT claim — in-process execution stays snappy; only queued work
    // a driver hands off to the leader is claim-gated. Both ALTERs run inside
    // one `ddl_step` transaction, so the single-column `already_applied` guard
    // is safe (both columns land or neither does).
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.claimed_by_instance",
            description: "Add per-instance claim/lease columns to persona_executions",
            already_applied: |conn| has_column(conn, "persona_executions", "claimed_by_instance"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN claimed_by_instance TEXT;\n\
                     ALTER TABLE persona_executions ADD COLUMN claim_expires_at TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "build_sessions.claimed_by_instance",
            description: "Add per-instance claim/lease columns to build_sessions",
            already_applied: |conn| has_column(conn, "build_sessions", "claimed_by_instance"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE build_sessions ADD COLUMN claimed_by_instance TEXT;\n\
                     ALTER TABLE build_sessions ADD COLUMN claim_expires_at TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Per-persona star: marks a persona as "in the Director's coaching scope".
    // Promotes the previously localStorage-only favorite to a durable column so
    // the Director batch (`get_starred`) can read it.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas.starred",
            description: "Add starred flag to personas (Director coaching scope)",
            already_applied: |conn| has_column(conn, "personas", "starred"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE personas ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;",
                )?;
                Ok(())
            },
        },
    )?;

    // Director verdict score + rendered review markdown, written onto the
    // execution the Director reviewed. `director_score` (0-5) backs the Verdict
    // column in the activity list; `director_review_md` backs the Director tab.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_executions.director_score",
            description: "Add director_score + director_review_md to persona_executions",
            already_applied: |conn| has_column(conn, "persona_executions", "director_score"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_executions ADD COLUMN director_score INTEGER;\n\
                     ALTER TABLE persona_executions ADD COLUMN director_review_md TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Version attribution for Arena results (Lab "Versions & Ratings" redesign).
    // Arena historically measured the persona's *current* prompt with no version
    // link; the consolidated table aggregates ratings per (version, model), so a
    // version-scoped Arena run now snapshots which version it measured. Nullable —
    // pre-redesign arena rows stay NULL and are excluded from the ratings rollup.
    run_step(
        conn,
        IncrementalMigration {
            id: "lab_arena.version_attribution",
            description: "Add version_id/version_number to lab_arena_runs + lab_arena_results",
            already_applied: |conn| has_column(conn, "lab_arena_runs", "version_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE lab_arena_runs ADD COLUMN version_id TEXT;\n\
                     ALTER TABLE lab_arena_runs ADD COLUMN version_number INTEGER;\n\
                     ALTER TABLE lab_arena_results ADD COLUMN version_id TEXT;\n\
                     ALTER TABLE lab_arena_results ADD COLUMN version_number INTEGER;",
                )?;
                Ok(())
            },
        },
    )?;

    // Allow the 'oauth_keepalive' policy_type. The OAuth keepalive auto-provision
    // (engine::rotation::auto_provision_oauth_rotation_policies) inserts policies
    // with policy_type='oauth_keepalive' and the rotation tick + dedup logic key
    // off that value — but the original CHECK constraint never listed it, so every
    // OAuth credential without a policy failed the insert with "CHECK constraint
    // failed" at every startup and keepalive rotation was never provisioned.
    // SQLite can't ALTER a CHECK in place, so rebuild the table with the value
    // added (mirrors the n8n_transform_sessions rebuild above). UNIQUE(credential_id,
    // policy_type) is preserved so a keepalive policy can coexist with a user's
    // 'scheduled' policy on the same credential. Nothing references this table, so
    // the drop/rename has no foreign-key fallout.
    run_step(
        conn,
        IncrementalMigration {
            id: "credential_rotation_policies.oauth_keepalive_policy_type",
            description: "Add 'oauth_keepalive' to credential_rotation_policies.policy_type CHECK",
            already_applied: |conn| {
                // Skip when the table is absent (fresh DB → schema.rs creates it with
                // the value already) or its stored CHECK already lists the value.
                // Counts only a present table whose SQL still lacks 'oauth_keepalive'.
                let stale: i64 = conn
                    .prepare(
                        "SELECT COUNT(*) FROM sqlite_master \
                         WHERE type='table' AND name='credential_rotation_policies' \
                         AND sql NOT LIKE '%oauth_keepalive%'",
                    )?
                    .query_row([], |row| row.get(0))?;
                Ok(stale == 0)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "DROP TABLE IF EXISTS credential_rotation_policies_new;
                     CREATE TABLE credential_rotation_policies_new (
                         id                TEXT PRIMARY KEY,
                         credential_id     TEXT NOT NULL REFERENCES persona_credentials(id) ON DELETE CASCADE,
                         enabled           INTEGER NOT NULL DEFAULT 1,
                         rotation_interval_days INTEGER NOT NULL DEFAULT 90,
                         policy_type       TEXT NOT NULL DEFAULT 'scheduled'
                                           CHECK(policy_type IN ('scheduled','on_suspicious','on_member_departure','manual','oauth_keepalive')),
                         last_rotated_at   TEXT,
                         next_rotation_at  TEXT,
                         created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                         updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
                         UNIQUE(credential_id, policy_type)
                     );
                     INSERT INTO credential_rotation_policies_new
                         (id, credential_id, enabled, rotation_interval_days, policy_type,
                          last_rotated_at, next_rotation_at, created_at, updated_at)
                     SELECT id, credential_id, enabled, rotation_interval_days, policy_type,
                            last_rotated_at, next_rotation_at, created_at, updated_at
                     FROM credential_rotation_policies;
                     DROP TABLE credential_rotation_policies;
                     ALTER TABLE credential_rotation_policies_new RENAME TO credential_rotation_policies;
                     CREATE INDEX IF NOT EXISTS idx_crp_credential ON credential_rotation_policies(credential_id);
                     CREATE INDEX IF NOT EXISTS idx_crp_next       ON credential_rotation_policies(next_rotation_at);
                     CREATE INDEX IF NOT EXISTS idx_crp_enabled    ON credential_rotation_policies(enabled);",
                )?;
                Ok(())
            },
        },
    )?;

    // ── Design D: Team Channel Deliberation Engine (D1 schema) ──────────────
    // Autonomous deliberation plane — see docs/plans/team-deliberation-engine.md.
    // D1 lands schema + bindings only; nothing is wired into the engine yet, and
    // the four added columns sit inert until their consuming phase (D3/D5).

    // A deliberation: a bounded, moderated team conversation. Length is bounded
    // by PROGRESS (the agenda + consecutive_stall_rounds), NOT a turn count.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_deliberations",
            description: "Create team_deliberations (Design D deliberation plane)",
            already_applied: |conn| has_table(conn, "team_deliberations"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS team_deliberations (
                        id            TEXT PRIMARY KEY,
                        team_id       TEXT NOT NULL REFERENCES persona_teams(id) ON DELETE CASCADE,
                        topic         TEXT NOT NULL,
                        goal          TEXT,
                        status        TEXT NOT NULL DEFAULT 'open',
                        round         INTEGER NOT NULL DEFAULT 0,
                        consecutive_stall_rounds INTEGER NOT NULL DEFAULT 0,
                        cost_budget_usd  REAL,
                        cost_spent_usd   REAL NOT NULL DEFAULT 0,
                        idle_deadline    TEXT,
                        resolution    TEXT,
                        spawned_assignment_id TEXT,
                        created_by    TEXT NOT NULL DEFAULT 'user',
                        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_delib_team_status
                        ON team_deliberations(team_id, status, updated_at DESC);
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_delib_one_active_per_team
                        ON team_deliberations(team_id)
                        WHERE status IN ('open','converging','escalated','paused');",
                )?;
                Ok(())
            },
        },
    )?;

    // The agenda backbone — the termination contract (the deliberation ends when
    // the agenda is empty), replacing the turn budget.
    run_step(
        conn,
        IncrementalMigration {
            id: "deliberation_agenda",
            description: "Create deliberation_agenda (Design D agenda backbone)",
            already_applied: |conn| has_table(conn, "deliberation_agenda"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS deliberation_agenda (
                        id              TEXT PRIMARY KEY,
                        deliberation_id TEXT NOT NULL REFERENCES team_deliberations(id) ON DELETE CASCADE,
                        item            TEXT NOT NULL,
                        status          TEXT NOT NULL DEFAULT 'open',
                        resolution      TEXT,
                        opened_by       TEXT,
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        resolved_at     TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_agenda_delib_status
                        ON deliberation_agenda(deliberation_id, status);",
                )?;
                Ok(())
            },
        },
    )?;

    // Link channel turns to their deliberation (turns ride the existing channel
    // read-model + UI). Injection is BY deliberation_id, not the `consumer` field.
    // Plain column (no inline FK) — matches the established ALTER-ADD style here.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_channel_messages.deliberation_id",
            description: "Add deliberation_id to team_channel_messages (Design D)",
            already_applied: |conn| has_column(conn, "team_channel_messages", "deliberation_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_channel_messages ADD COLUMN deliberation_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Display name of an EXTERNAL author (the team <-> Slack bridge, WP2).
    // Internal authors resolve their name from `author_id` (a persona id) or
    // from `author_kind` itself, so this stays NULL for every row the app
    // writes; a Slack participant has neither, and the read-model surfaces this
    // column as `TeamChannelItem.label` (which for channel rows was previously
    // a redundant copy of `author_kind`). Plain column, ALTER-ADD style,
    // matching `deliberation_id` above.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_channel_messages.author_label",
            description: "Add author_label to team_channel_messages (Slack bridge inbound)",
            already_applied: |conn| has_column(conn, "team_channel_messages", "author_label"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_channel_messages ADD COLUMN author_label TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Persona deliberation identity (typed PersonaCore JSON) — authored at the
    // template level (D5), read by the moderator (D2/D3). Inert until then.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas.core_profile",
            description: "Add core_profile to personas (Design D PersonaCore)",
            already_applied: |conn| has_column(conn, "personas", "core_profile"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE personas ADD COLUMN core_profile TEXT;")?;
                Ok(())
            },
        },
    )?;

    // Team shared motivation (typed TeamNorthStar JSON) — the "#1 in category"
    // imprint every member shares. Authored at the team-preset level (D5).
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_teams.north_star",
            description: "Add north_star to persona_teams (Design D TeamNorthStar)",
            already_applied: |conn| has_column(conn, "persona_teams", "north_star"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_teams ADD COLUMN north_star TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Per-persona conversation-scoped memory: lets a persona recall "what I
    // argued in this deliberation". Nullable scope; reuses persona_memories.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memories.deliberation_id",
            description: "Add deliberation_id scope to persona_memories (Design D)",
            already_applied: |conn| has_column(conn, "persona_memories", "deliberation_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memories ADD COLUMN deliberation_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // Gated mid-deliberation capability action (the conversation↔action loop).
    // `pending_action` holds the awaiting-approval capability request (JSON); the
    // new 'awaiting_action' status parks the deliberation until the user approves
    // or skips. Rebuild the one-active-per-team index to cover the new status.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_deliberations.pending_action",
            description: "Add pending_action + awaiting_action status (Design D gated actions)",
            already_applied: |conn| has_column(conn, "team_deliberations", "pending_action"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_deliberations ADD COLUMN pending_action TEXT;
                     DROP INDEX IF EXISTS idx_delib_one_active_per_team;
                     CREATE UNIQUE INDEX IF NOT EXISTS idx_delib_one_active_per_team
                         ON team_deliberations(team_id)
                         WHERE status IN ('open','converging','escalated','paused','awaiting_action');",
                )?;
                Ok(())
            },
        },
    )?;

    // Parallel deliberation tracks (sub-sessions). A deliberation can be split
    // into child "tracks" (parent_id set), each owning a slice of the agenda and
    // an optional roster subset (roster_ids). The parent parks at 'tracking'
    // until its tracks resolve, then a merge synthesizes one combined proposal.
    // The one-active-per-team index must count only TOP-LEVEL deliberations, or
    // a parent + its tracks would collide — so it gains `parent_id IS NULL`.
    run_step(
        conn,
        IncrementalMigration {
            id: "team_deliberations.tracks",
            description: "Add parent_id + roster_ids for parallel deliberation tracks",
            already_applied: |conn| has_column(conn, "team_deliberations", "parent_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_deliberations ADD COLUMN parent_id TEXT;
                     ALTER TABLE team_deliberations ADD COLUMN roster_ids TEXT;
                     DROP INDEX IF EXISTS idx_delib_one_active_per_team;
                     CREATE UNIQUE INDEX IF NOT EXISTS idx_delib_one_active_per_team
                         ON team_deliberations(team_id)
                         WHERE parent_id IS NULL
                           AND status IN ('open','converging','escalated','paused','awaiting_action','tracking');
                     CREATE INDEX IF NOT EXISTS idx_delib_parent ON team_deliberations(parent_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // Async gated actions: an approved capability runs in the background; the
    // deliberation parks at 'action_running' holding its persona_executions id,
    // and a reaper posts the output back + resumes when it finishes (so the flow
    // recovers even when the capability outlives any single request).
    run_step(
        conn,
        IncrementalMigration {
            id: "team_deliberations.action_execution",
            description: "Add action_execution_id + action_running status (async gated actions)",
            already_applied: |conn| has_column(conn, "team_deliberations", "action_execution_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_deliberations ADD COLUMN action_execution_id TEXT;
                     DROP INDEX IF EXISTS idx_delib_one_active_per_team;
                     CREATE UNIQUE INDEX IF NOT EXISTS idx_delib_one_active_per_team
                         ON team_deliberations(team_id)
                         WHERE parent_id IS NULL
                           AND status IN ('open','converging','escalated','paused','awaiting_action','tracking','action_running');",
                )?;
                Ok(())
            },
        },
    )?;

    // Atomic capability claim: one row per (group_root, use_case_id) so only the
    // FIRST concurrent approval across parallel tracks spawns a capability — the
    // PRIMARY KEY makes the de-dup race-free (the turn/approval-time scans can't).
    run_step(
        conn,
        IncrementalMigration {
            id: "deliberation_capability_claims",
            description: "Atomic per-group capability claim (race-free de-dup)",
            already_applied: |conn| has_table(conn, "deliberation_capability_claims"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS deliberation_capability_claims (
                        group_root      TEXT NOT NULL,
                        use_case_id     TEXT NOT NULL,
                        deliberation_id TEXT NOT NULL,
                        claimed_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (group_root, use_case_id)
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // Build telemetry (build-orchestration Phase 0). Additive observability so
    // the build-bench harness can measure per-phase wall-clock + CLI cost/tokens
    // for as-is vs multi-agent builds. See docs/architecture/build-orchestration-plan.md.

    Ok(())
}
