//! The persona_executions 'incomplete' status rebuild, dev_projects team
//! linkage, persona_teams workspace fields, home-team back-references, the
//! cross-device sync columns and tombstones, owned devices, and the
//! Groups->Teams data migration.
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
            id: "persona_executions_incomplete_status",
            description: "Add 'incomplete' to persona_executions.status CHECK constraint",
            already_applied: |conn| {
                let sql: String = conn
                    .query_row(
                        "SELECT COALESCE(sql, '') FROM sqlite_master
                         WHERE type='table' AND name='persona_executions'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or_default();
                // Empty == table not created yet (fresh DB): base schema
                // already carries the widened CHECK, so treat as applied.
                Ok(sql.is_empty() || sql.contains("'incomplete'"))
            },
            apply: rebuild_executions_table_with_incomplete_status,
        },
    )?;

    // Structured setup detail (adoption-honesty redesign). The flat
    // `setup_status` string stays as the coarse execute-gate; this nullable
    // JSON column carries the rich `PersonaSetup` — typed blockers + wired
    // triggers + a human-readable readiness preview — that the UI routes on.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas_setup_detail",
            description: "Add setup_detail JSON column to personas",
            already_applied: |conn| has_column(conn, "personas", "setup_detail"),
            apply: |conn| {
                ddl_step(conn, "ALTER TABLE personas ADD COLUMN setup_detail TEXT;")?;
                Ok(())
            },
        },
    )?;

    // Group-scoped shared memory (PersonaGroup productionization, 2026-05-22).
    // Mirrors the use_case_id pattern from Phase C5: nullable column, no FK
    // by design — see MEMORY CONTRACT (5) in db/models/memory.rs. Stage 1
    // ships the schema; Stage 2 will OR-in group_id matches in the injection
    // hot path so memories authored in group context are shared with every
    // group member's prompt.
    // REMOVED 2026-08-15: `persona_memories_group_id`.
    //
    // It added `persona_memories.group_id`, which `retire_persona_groups`
    // (~370 lines below) drops. That step's guard is `|_conn| Ok(false)`, so it
    // runs on EVERY launch — and because this step ran first and put the column
    // back, the pair undid and redid each other forever. Replayed against a copy
    // of the live 331 MB database: 186.1 ms then 181.2 ms per boot, of which
    // 108 ms is SQLite rewriting all 6,535 rows / 37 MB of `persona_memories`,
    // because DROP COLUMN rewrites every row. The residue after two boots is
    // byte-identical to the start.
    //
    // Nothing could have caught it: the idempotency test asserts the fixed
    // point (correctly — the schema IS stable), there is no migrations ledger,
    // and the `tracing::info!` receipt goes to a sink installed after the
    // migrations run.

    // Dev-tools project ↔ PersonaTeam binding (2026-05-22). Lets developers
    // bind a dev_projects row to a PersonaTeam (pipeline) so the project
    // surface in ProjectManagerPage shows the bound pipeline inline. No FK
    // by design — the same orphan-tolerance rationale as use_case_id.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects_team_id",
            description: "Add team_id column to dev_projects for pipeline binding",
            already_applied: |conn| has_column(conn, "dev_projects", "team_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects ADD COLUMN team_id TEXT;
                     CREATE INDEX IF NOT EXISTS idx_dev_projects_team_id ON dev_projects(team_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // Dev-tools project ↔ PersonaGroup binding (2026-05-22). Complementary
    // to team_id: team_id is the execution-time pipeline, group_id is the
    // design-time workspace folder. Both can be set independently. Same
    // orphan-tolerance policy.
    // REMOVED 2026-08-15: `dev_projects_group_id`. Same pair as the note above —
    // it re-added a column `retire_persona_groups` drops on every launch.

    // Groups → Teams consolidation (ADR 2026-05-23-groups-into-teams),
    // Phase 1 — additive only. A PersonaTeam gains a "workspace" facet
    // (shared instructions + new-persona defaults, ported from
    // PersonaGroup), and a persona gains a single nullable home_team_id
    // = the team whose workspace settings + injected memory apply at
    // runtime (resolves the 1:N group vs N:M team cardinality). Injected
    // memory re-anchors via persona_memories.home_team_id. Nothing is
    // migrated or dropped here — the group_id columns stay intact.
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_teams_workspace_fields",
            description: "Add workspace settings (shared_instructions + defaults) to persona_teams",
            already_applied: |conn| has_column(conn, "persona_teams", "shared_instructions"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_teams ADD COLUMN shared_instructions TEXT;
                     ALTER TABLE persona_teams ADD COLUMN default_model_profile TEXT;
                     ALTER TABLE persona_teams ADD COLUMN default_max_budget_usd REAL;
                     ALTER TABLE persona_teams ADD COLUMN default_max_turns INTEGER;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "personas_home_team_id",
            // Guarded on the INDEX, not the column: base schema's CREATE TABLE
            // already defines `home_team_id` for fresh DBs (so a column-guard
            // would skip here and the index would never be created), while
            // legacy DBs lack the column entirely. The base-schema CREATE INDEX
            // line was removed because it ran *before* this ALTER and failed on
            // legacy DBs that pre-date the column; this migration is now the
            // sole creator of the index (and adds the column when missing), so
            // both fresh and legacy DBs converge to column + index.
            description: "Add home_team_id to personas + its index (workspace anchor for the Groups→Teams merge)",
            already_applied: |conn| has_index(conn, "idx_personas_home_team_id"),
            apply: |conn| {
                if !has_column(conn, "personas", "home_team_id")? {
                    ddl_step(
                        conn,
                        "ALTER TABLE personas ADD COLUMN home_team_id TEXT REFERENCES persona_teams(id) ON DELETE SET NULL;",
                    )?;
                }
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_personas_home_team_id ON personas(home_team_id);",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memories_home_team_id",
            description: "Add home_team_id to persona_memories (injected-memory scope re-anchor)",
            already_applied: |conn| has_column(conn, "persona_memories", "home_team_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memories ADD COLUMN home_team_id TEXT;
                     CREATE INDEX IF NOT EXISTS idx_persona_memories_home_team_id ON persona_memories(home_team_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // ── Cross-device persona continuity, Stage 1 (ADR
    // 2026-05-24-cross-device-persona-continuity). Additive only: a sync-state
    // ledger mirroring `obsidian_sync_state`, content-hash / origin-device
    // columns on personas, and an explicit tombstone table so hard-deletes can
    // propagate across devices instead of resurrecting on the next pull.
    run_step(
        conn,
        IncrementalMigration {
            id: "personas_sync_columns",
            description: "Add content_hash + last_modified_device to personas (cross-device sync)",
            already_applied: |conn| has_column(conn, "personas", "content_hash"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE personas ADD COLUMN content_hash TEXT;
                     ALTER TABLE personas ADD COLUMN last_modified_device TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_sync_state",
            description: "Per-(persona, remote-device) sync ledger for cross-device continuity",
            already_applied: |conn| has_table(conn, "persona_sync_state"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_sync_state (
                        id              TEXT PRIMARY KEY,
                        persona_id      TEXT NOT NULL,
                        remote_device   TEXT NOT NULL,
                        base_hash       TEXT NOT NULL,
                        sync_direction  TEXT,
                        synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(persona_id, remote_device)
                    );
                    CREATE INDEX IF NOT EXISTS idx_persona_sync_state_persona
                        ON persona_sync_state(persona_id);
                    CREATE INDEX IF NOT EXISTS idx_persona_sync_state_device
                        ON persona_sync_state(remote_device);",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_tombstones",
            description: "Tombstones for deleted personas so deletes propagate across devices",
            already_applied: |conn| has_table(conn, "persona_tombstones"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_tombstones (
                        persona_id   TEXT PRIMARY KEY,
                        deleted_at   TEXT NOT NULL,
                        device_id    TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_persona_tombstones_deleted_at
                        ON persona_tombstones(deleted_at);",
                )?;
                Ok(())
            },
        },
    )?;

    // ── Cross-device persona continuity, Stage 2 (same ADR): the
    // device-ownership data model. `local_identity.device_group_id` is the shared
    // anchor that marks a set of peers as "the same user's devices"; the
    // `owned_devices` registry is what a pairing flow (this stage's commands, or
    // the fleet `/friend` QR-pairing UI) writes into. Backend model only — no
    // pairing handshake here.
    run_step(
        conn,
        IncrementalMigration {
            id: "local_identity_device_group_id",
            description: "Add device_group_id to local_identity (cross-device ownership anchor)",
            already_applied: |conn| has_column(conn, "local_identity", "device_group_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE local_identity ADD COLUMN device_group_id TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "owned_devices",
            description: "Registry of a user's own paired devices for workspace sync",
            already_applied: |conn| has_table(conn, "owned_devices"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS owned_devices (
                        peer_id          TEXT PRIMARY KEY,
                        device_group_id  TEXT NOT NULL,
                        display_name     TEXT NOT NULL,
                        added_at         TEXT NOT NULL,
                        last_synced_at   TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_owned_devices_group
                        ON owned_devices(device_group_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // Groups → Teams consolidation, Phase 3 — DATA MIGRATION (guarded,
    // reversible). Each PersonaGroup becomes a connection-less "workspace
    // team" carrying its settings; members get home_team_id + a membership
    // row; injected memories + dev_projects re-point onto the new team.
    //
    // MUST run here at the end of `run_incremental` (phase 2), NOT in
    // `ensure_composite_fires_table` (phase 1) where it originally lived: it
    // reads `persona_groups.shared_instructions` / `persona_teams.shared_instructions`
    // / `personas.home_team_id` / `persona_memories.home_team_id`, all of which
    // are added by earlier `run_incremental` steps. Relocated 2026-05-24 to fix a
    // fresh-DB startup abort ("no such column: g.shared_instructions").
    //
    // Reversibility: the source columns (personas.group_id,
    // persona_memories.group_id, persona_groups table, dev_projects.group_id)
    // are KEPT INTACT — this migration only POPULATES the new home_team_id /
    // membership / team rows. The destructive drop of group_id + persona_groups
    // is a separate, later phase. Every statement is idempotent (guarded by
    // `NOT EXISTS` / `home_team_id IS NULL`), so a re-run is a no-op.
    //
    // Workspace-team id is deterministic: 'wsteam-' || group.id, so the
    // mapping is stable across re-runs without a side table.
    run_step(
        conn,
        IncrementalMigration {
            id: "groups_to_teams_data_migration",
            description: "Migrate PersonaGroups into workspace PersonaTeams (home_team_id + membership + memory re-anchor)",
            // No clean boolean marker (zero groups = legitimate no-op), so
            // rely on run_step's id-tracking to run once; the SQL is
            // idempotent regardless.
            already_applied: |_conn| Ok(false),
            apply: |conn| {
                // Fresh DBs (post-Phase-5 schema) never create `persona_groups`
                // or `personas.group_id`, so this whole data migration is a
                // no-op there — guard on the table's existence to avoid a
                // "no such table" panic. Existing DBs still have both at this
                // point in the sequence (the drop migration runs LAST).
                let groups_table_exists: i64 = conn
                    .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='persona_groups'")?
                    .query_row([], |row| row.get(0))?;
                if groups_table_exists == 0 {
                    return Ok(());
                }
                ddl_step(
                    conn,
                    "
                    -- 1. group → workspace team (carry settings; disabled so it
                    --    doesn't appear as a runnable pipeline until the user
                    --    opts in — workspace teams have no connections).
                    INSERT INTO persona_teams
                        (id, name, color, enabled, shared_instructions,
                         default_model_profile, default_max_budget_usd,
                         default_max_turns, created_at, updated_at)
                    SELECT 'wsteam-' || g.id, g.name, g.color, 1,
                           g.shared_instructions, g.default_model_profile,
                           g.default_max_budget_usd, g.default_max_turns,
                           g.created_at, g.updated_at
                    FROM persona_groups g
                    WHERE NOT EXISTS (
                        SELECT 1 FROM persona_teams t WHERE t.id = 'wsteam-' || g.id
                    );

                    -- 2. personas: set home_team_id from their group.
                    UPDATE personas
                    SET home_team_id = 'wsteam-' || group_id
                    WHERE group_id IS NOT NULL AND home_team_id IS NULL;

                    -- 3. membership row per grouped persona (idempotent).
                    INSERT INTO persona_team_members
                        (id, team_id, persona_id, role, position_x, position_y, created_at)
                    SELECT lower(hex(randomblob(16))), 'wsteam-' || p.group_id,
                           p.id, 'worker', 0, 0, datetime('now')
                    FROM personas p
                    WHERE p.group_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM persona_team_members m
                        WHERE m.team_id = 'wsteam-' || p.group_id AND m.persona_id = p.id
                    );

                    -- 4. injected memories re-anchor onto the workspace team.
                    UPDATE persona_memories
                    SET home_team_id = 'wsteam-' || group_id
                    WHERE group_id IS NOT NULL AND home_team_id IS NULL;
                    ",
                )?;
                // 5. dev_projects: re-point the group binding to the team
                //    binding, but only when dev_projects actually has both
                //    columns (group_id was added late; team_id earlier).
                if has_column(conn, "dev_projects", "group_id")?
                    && has_column(conn, "dev_projects", "team_id")?
                {
                    ddl_step(
                        conn,
                        "UPDATE dev_projects
                         SET team_id = 'wsteam-' || group_id
                         WHERE group_id IS NOT NULL AND team_id IS NULL;",
                    )?;
                }
                Ok(())
            },
        },
    )?;

    // Groups→Teams Phase 5 — retire the PersonaGroup primitive. Runs AFTER
    // `groups_to_teams_data_migration` has re-anchored every group onto a
    // workspace team (home_team_id + membership + memory). Destructive +
    // irreversible: drops the `persona_groups` table and the orphan-tolerant
    // `group_id` columns on `persona_memories` and `dev_projects`.
    //
    // `personas.group_id` is deliberately NOT dropped: it carries an inline
    // `REFERENCES persona_groups(id)` FK, and SQLite's `ALTER TABLE DROP
    // COLUMN` refuses a FK-constrained column without a full rebuild of the
    // central `personas` table — too risky on a live DB for a column that is
    // now dead (no Rust struct field, no read, no write) and forced to NULL
    // below. It is invisible to all code; the concept is fully retired.
    // ADR: 2026-05-23-groups-into-teams (Phase 5).

    Ok(())
}
