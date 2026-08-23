//! Milestone cut/rating columns, harvest coverage depth, incident diagnoses,
//! credential consumer edges, autopilot night runs, assignment outcomes,
//! evolution promotion proposals, automation suggestions, lab A/B experiments
//! and policy proposals.
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
            id: "dev_milestones.backfill_cut_at",
            description: "Backfill cut_at = created_at for milestones already 'active' with no cut stamp, so the scope-creep baseline exists on milestones that were created directly active.",
            already_applied: |conn| {
                if !has_table(conn, "dev_milestones")? {
                    return Ok(true);
                }
                let pending: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM dev_milestones WHERE status = 'active' AND cut_at IS NULL",
                    [],
                    |row| row.get(0),
                )?;
                Ok(pending == 0)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "UPDATE dev_milestones SET cut_at = created_at
                     WHERE status = 'active' AND cut_at IS NULL;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- dev_milestone_items.description + rating ---------------------------
    // A scope member carried only its bucket, so the WHY of a decision lived
    // nowhere: why this use case is core, why that goal was pushed to later.
    // `description` is that note. `rating` is the operator's own read on the
    // item (1..5), and is NULL by design — "unrated" must stay distinguishable
    // from "rated 1", which is why there is no DEFAULT here. The CHECK rides
    // along on the ADD COLUMN: SQLite evaluates it per row, and NULL is not
    // FALSE, so every pre-existing row passes on a populated database.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_milestone_items.description_rating",
            description: "Give a milestone scope member a free-text rationale and an operator rating (1..5, NULL = unrated), so a bucket decision carries its reason and its judged value.",
            already_applied: |conn| has_column(conn, "dev_milestone_items", "rating"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_milestone_items ADD COLUMN description TEXT;
                     ALTER TABLE dev_milestone_items ADD COLUMN rating INTEGER
                         CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5));",
                )?;
                Ok(())
            },
        },
    )?;

    // -- workspace_harvest_coverage: which territory has been read ----------
    // The harvest engine used to send one agent at a whole repository with an
    // item cap and no map, so it read the root configs and stopped — and had
    // no way to know that on the next run either. This table is the memory:
    // one row per (member repo, scope), NULL `last_harvested_at` meaning "never
    // read". Rows are rebuilt from the derived scope list on every prepare,
    // preserving harvest history for scopes that survive a re-scan.
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS workspace_harvest_coverage (
            project_id        TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            scope_id          TEXT NOT NULL,
            scope_label       TEXT NOT NULL,
            kind              TEXT NOT NULL DEFAULT 'group',
            file_count        INTEGER NOT NULL DEFAULT 0,
            last_harvested_at TEXT,
            last_run_dir      TEXT,
            items_found       INTEGER NOT NULL DEFAULT 0,
            run_count         INTEGER NOT NULL DEFAULT 0,
            updated_at        TEXT NOT NULL,
            PRIMARY KEY (project_id, scope_id)
        );
        CREATE INDEX IF NOT EXISTS idx_harvest_coverage_project
            ON workspace_harvest_coverage(project_id, last_harvested_at);",
    )?;

    // -- coverage DEPTH, not just visits ------------------------------------
    // The first coverage ledger recorded WHETHER a territory had been visited.
    // The 2026-07-27 twelve-territory scan showed that is not enough: every
    // agent volunteered a real read-depth ("~11% of 404 files", "26% of 508",
    // "~7% of the command layer") plus the specific pockets it never opened —
    // and all of it was discarded, leaving a territory read at 11% and one read
    // exhaustively indistinguishable. That is the same "visited == covered"
    // error the scoping work exists to remove, one level up.
    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_harvest_coverage.depth",
            description: "Record how much of a scope was actually read (files_read / files_total / estimated_pct) and which pockets were left unread, so coverage reports depth instead of a visit and the next wave can resume into the gaps.",
            already_applied: |conn| has_column(conn, "workspace_harvest_coverage", "estimated_pct"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE workspace_harvest_coverage ADD COLUMN files_read INTEGER;
                     ALTER TABLE workspace_harvest_coverage ADD COLUMN files_total INTEGER;
                     ALTER TABLE workspace_harvest_coverage ADD COLUMN estimated_pct INTEGER;
                     ALTER TABLE workspace_harvest_coverage ADD COLUMN unread_pockets TEXT;
                     ALTER TABLE workspace_harvest_coverage ADD COLUMN coverage_note TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- workspace_knowledge.harvest_scope ----------------------------------
    // Which territory produced a practice. Without it the library cannot be
    // filtered or measured by scope, and yield-per-territory — the number that
    // tells you whether a scope is worth re-dispatching — is uncomputable.
    run_step(
        conn,
        IncrementalMigration {
            id: "workspace_knowledge.harvest_scope",
            description: "Stamp the harvest scope (territory) that produced each practice, so the library can filter by territory and yield-per-scope is measurable.",
            already_applied: |conn| has_column(conn, "workspace_knowledge", "harvest_scope"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE workspace_knowledge ADD COLUMN harvest_scope TEXT;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- dev_workspaces.adopt_default_skills --------------------------------
    // Consent flag set at workspace creation: when 1, projects assigned to the
    // workspace get the app's preset scan-* skills installed (system-skill
    // lane). Consent is explicit — the checkbox in the create form — never
    // implied, so the default is 0.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_workspaces.adopt_default_skills",
            description: "Per-workspace consent to populate the preset scan skills into member projects on assignment.",
            already_applied: |conn| has_column(conn, "dev_workspaces", "adopt_default_skills"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_workspaces ADD COLUMN adopt_default_skills INTEGER NOT NULL DEFAULT 0;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- companion_tours ----------------------------------------------------
    // MOVED 2026-08-15 to COMPANION_SCHEMA in db/src/lib.rs. This file's
    // migrations run against the MAIN database; every companion_tours query
    // executes on `&UserDbPool`, so the table was being created in one store
    // and read from the other. See the note at its new definition.

    // -- incident_diagnoses: Autonomous NOC v1 root-cause diagnoses ----------
    // One row per audit incident (UNIQUE incident_id). Written by the
    // server-side alert evaluator's auto-diagnosis pass and by the manual
    // "Diagnose" action in the incident detail modal. `approval_id` records
    // the (at most one) pending companion-approval proposal — the
    // remediation-loop cap for v1.
    run_step(
        conn,
        IncrementalMigration {
            id: "incident_diagnoses",
            description:
                "Create incident_diagnoses (NOC auto-diagnosis attached to audit_incidents)",
            already_applied: |conn| has_table(conn, "incident_diagnoses"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS incident_diagnoses (
                        id                 TEXT PRIMARY KEY,
                        incident_id        TEXT NOT NULL UNIQUE REFERENCES audit_incidents(id) ON DELETE CASCADE,
                        summary            TEXT NOT NULL,
                        evidence           TEXT,
                        proposed_action    TEXT,
                        proposed_rationale TEXT,
                        approval_id        TEXT,
                        confidence         REAL NOT NULL DEFAULT 0,
                        diagnosed_at       TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // -- credential_consumer_edges: Zero-Plaintext Broker live blast-radius --
    // One row per (credential, external-consumer-key) pair, UPSERTed on every
    // proxied management-API call so the dependency graph reflects observed
    // reality, not just declared bindings. Consumer identity is the
    // `external_api_keys` row that authenticated the call (per-consumer
    // handle or broad key). No FK to external_api_keys: revoked keys stay
    // visible as historical consumers (readers join for live status).
    run_step(
        conn,
        IncrementalMigration {
            id: "credential_consumer_edges",
            description: "Create credential_consumer_edges (broker per-consumer usage edges)",
            already_applied: |conn| has_table(conn, "credential_consumer_edges"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS credential_consumer_edges (
                        id               TEXT PRIMARY KEY,
                        credential_id    TEXT NOT NULL,
                        consumer_key_id  TEXT NOT NULL,
                        consumer_name    TEXT NOT NULL,
                        call_count       INTEGER NOT NULL DEFAULT 0,
                        last_status      INTEGER,
                        first_used_at    TEXT NOT NULL DEFAULT (datetime('now')),
                        last_used_at     TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(credential_id, consumer_key_id)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_consumer_edges_credential
                        ON credential_consumer_edges(credential_id);",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_consumer_edges_consumer
                        ON credential_consumer_edges(consumer_key_id);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- autopilot_night_runs: Overnight Portfolio Engine ledger -------------
    // One row per project per night (UNIQUE(project_id, night) is the
    // once-per-night claim). Written by the overnight subscription tick and
    // the manual `dev_tools_run_overnight_now` command; read by the
    // night-runs list command and the morning digest. Soft ref to
    // dev_projects (no FK): a night's audit trail survives project deletion.
    run_step(
        conn,
        IncrementalMigration {
            id: "autopilot_night_runs",
            description:
                "Create autopilot_night_runs (Overnight Portfolio Engine per-night ledger)",
            already_applied: |conn| has_table(conn, "autopilot_night_runs"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS autopilot_night_runs (
                        id                 TEXT PRIMARY KEY,
                        project_id         TEXT NOT NULL,
                        night              TEXT NOT NULL,
                        mode               TEXT NOT NULL,
                        status             TEXT NOT NULL DEFAULT 'running',
                        scan_added         INTEGER NOT NULL DEFAULT 0,
                        scan_modified      INTEGER NOT NULL DEFAULT 0,
                        scan_deleted       INTEGER NOT NULL DEFAULT 0,
                        triage_applied     INTEGER NOT NULL DEFAULT 0,
                        ideas_accepted     INTEGER NOT NULL DEFAULT 0,
                        ideas_rejected     INTEGER NOT NULL DEFAULT 0,
                        dispatched_count   INTEGER NOT NULL DEFAULT 0,
                        skipped_count      INTEGER NOT NULL DEFAULT 0,
                        blocked_reason     TEXT,
                        degraded           INTEGER NOT NULL DEFAULT 0,
                        projected_cost_usd REAL NOT NULL DEFAULT 0,
                        month_spend_usd    REAL NOT NULL DEFAULT 0,
                        ceiling_usd        REAL,
                        session_ids        TEXT,
                        started_at         TEXT NOT NULL DEFAULT (datetime('now')),
                        finished_at        TEXT,
                        UNIQUE(project_id, night)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_night_runs_project
                        ON autopilot_night_runs(project_id, started_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Self-Evolving Team v1: assignment outcomes + team-scoped trust ------
    // `assignment_outcomes` — one learning record per terminal assignment
    // (UNIQUE(assignment_id) makes the first terminal transition the writer).
    // `team_member_trust` — Brier-updated, floored per-(team, persona) trust
    // the matcher overlays on the persona's global trust_score. Soft refs
    // (no FK) so the learning ledger survives assignment/team deletion audits.
    run_step(
        conn,
        IncrementalMigration {
            id: "assignment_outcomes",
            description: "Create assignment_outcomes + team_member_trust (Self-Evolving Team v1)",
            already_applied: |conn| has_table(conn, "assignment_outcomes"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS assignment_outcomes (
                        id                    TEXT PRIMARY KEY,
                        assignment_id         TEXT NOT NULL UNIQUE,
                        team_id               TEXT NOT NULL,
                        status                TEXT NOT NULL,
                        steps_total           INTEGER NOT NULL DEFAULT 0,
                        steps_done            INTEGER NOT NULL DEFAULT 0,
                        steps_failed          INTEGER NOT NULL DEFAULT 0,
                        steps_skipped         INTEGER NOT NULL DEFAULT 0,
                        review_interventions  INTEGER NOT NULL DEFAULT 0,
                        duration_secs         INTEGER,
                        outcome_json          TEXT NOT NULL DEFAULT '{}',
                        retro_deliberation_id TEXT,
                        retro_skipped_reason  TEXT,
                        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_assignment_outcomes_team
                        ON assignment_outcomes(team_id, created_at DESC);
                    CREATE TABLE IF NOT EXISTS team_member_trust (
                        team_id    TEXT NOT NULL,
                        persona_id TEXT NOT NULL,
                        trust      REAL NOT NULL,
                        samples    INTEGER NOT NULL DEFAULT 0,
                        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                        PRIMARY KEY (team_id, persona_id)
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Darwin Mode v1: measured-fitness provenance marker ------------------
    // `fitness_source` distinguishes an offspring's mid-parent PREDICTION
    // ("inherited") from a fixture-replay EVALUATION ("measured"). Legacy rows
    // stay NULL (all inherited by construction).
    run_step(
        conn,
        IncrementalMigration {
            id: "genome_results_fitness_source",
            description: "Add fitness_source (measured|inherited) to genome_breeding_results",
            already_applied: |conn| has_column(conn, "genome_breeding_results", "fitness_source"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE genome_breeding_results ADD COLUMN fitness_source TEXT;",
                )
            },
        },
    )?;

    // -- Darwin Mode v1: human-gated promotion queue -------------------------
    // An evolution cycle whose challenger beats the incumbent FILES a row here;
    // nothing is applied until a human approves (see
    // db/src/repos/lab/evolution_proposals.rs). Soft refs to evolution_cycles /
    // personas (no FK): the audit trail survives cycle/persona deletion.
    run_step(
        conn,
        IncrementalMigration {
            id: "evolution_promotion_proposals",
            description:
                "Create evolution_promotion_proposals (Darwin Mode review-gated promotion)",
            already_applied: |conn| has_table(conn, "evolution_promotion_proposals"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS evolution_promotion_proposals (
                        id                 TEXT PRIMARY KEY,
                        cycle_id           TEXT NOT NULL,
                        persona_id         TEXT NOT NULL,
                        status             TEXT NOT NULL DEFAULT 'pending',
                        winner_genome_json TEXT NOT NULL,
                        new_prompt         TEXT NOT NULL,
                        incumbent_score    REAL NOT NULL,
                        winner_score       REAL NOT NULL,
                        improvement        REAL NOT NULL,
                        threshold          REAL NOT NULL,
                        fitness_source     TEXT NOT NULL DEFAULT 'measured',
                        evidence_json      TEXT,
                        base_updated_at    TEXT NOT NULL,
                        decision_note      TEXT,
                        created_at         TEXT NOT NULL,
                        decided_at         TEXT
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_evo_proposals_persona
                        ON evolution_promotion_proposals(persona_id, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Self-Wiring Fabric v1: mined automation suggestions -----------------
    // Written by `engine::pattern_miner` (event→manual-run co-occurrence),
    // rendered as ghost cables in the Studio patchbay. UNIQUE(event_type,
    // persona_id) makes the miner's upsert idempotent; `committed_trigger_id`
    // is the mined-route tag that excludes an accepted suggestion's own
    // trigger traffic from future evidence.
    run_step(
        conn,
        IncrementalMigration {
            id: "automation_suggestions",
            description: "Create automation_suggestions (Self-Wiring Fabric mined ghost cables)",
            already_applied: |conn| has_table(conn, "automation_suggestions"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS automation_suggestions (
                        id                   TEXT PRIMARY KEY,
                        event_type           TEXT NOT NULL,
                        persona_id           TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                        status               TEXT NOT NULL DEFAULT 'proposed'
                                             CHECK(status IN ('proposed','accepted','rejected')),
                        occurrence_count     INTEGER NOT NULL DEFAULT 0,
                        manual_run_count     INTEGER NOT NULL DEFAULT 0,
                        support              REAL NOT NULL DEFAULT 0,
                        window_seconds       INTEGER NOT NULL,
                        lookback_days        INTEGER NOT NULL,
                        evidence_json        TEXT NOT NULL DEFAULT '[]',
                        committed_trigger_id TEXT,
                        first_seen_at        TEXT,
                        last_seen_at         TEXT,
                        decided_at           TEXT,
                        created_at           TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(event_type, persona_id)
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_autosuggest_status
                        ON automation_suggestions(status, updated_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- lab_ab_experiments: Director's Lab experiment registry --------------
    // One row per commissioned verdict→hypothesis experiment (batch-3
    // Director's Lab v1). Provenance-first: review_id soft-refs the approved
    // Director verdict (persona_manual_reviews, no FK — the audit trail
    // survives review pruning), hypothesis_json is the typed hypothesis
    // block, provenance_json snapshots the verdict evidence. status:
    // awaiting_variant | variant_ready | declined_budget | running |
    // concluded (running/concluded reserved for the deferred canary loop).
    run_step(
        conn,
        IncrementalMigration {
            id: "lab_ab_experiments",
            description: "Create lab_ab_experiments (Director's Lab verdict→experiment registry)",
            already_applied: |conn| has_table(conn, "lab_ab_experiments"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS lab_ab_experiments (
                        id              TEXT PRIMARY KEY,
                        persona_id      TEXT NOT NULL,
                        review_id       TEXT,
                        hypothesis_json TEXT NOT NULL,
                        provenance_json TEXT,
                        status          TEXT NOT NULL DEFAULT 'awaiting_variant'
                                        CHECK(status IN ('awaiting_variant','variant_ready',
                                                         'declined_budget','running','concluded')),
                        status_detail   TEXT,
                        variant_prompt  TEXT,
                        variant_source  TEXT,
                        spend_usd       REAL NOT NULL DEFAULT 0,
                        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_lab_ab_experiments_persona
                        ON lab_ab_experiments(persona_id, created_at DESC);",
                )?;
                ddl_step(
                    conn,
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_ab_experiments_review
                        ON lab_ab_experiments(review_id) WHERE review_id IS NOT NULL;",
                )?;
                Ok(())
            },
        },
    )?;

    // -- policy_proposals: Self-Tuning Fabric review-each ledger -------------
    // One row per proposed policy change (routing-rule diff / budget ceiling)
    // with its typed payload+claim and the evidence-snapshot slice it was
    // derived from. Written by policy_tuning_generate; transitioned by the
    // apply/decline commands. Declined rows are kept as feedback — the
    // generator will not re-propose an answered question.
    run_step(
        conn,
        IncrementalMigration {
            id: "policy_proposals",
            description: "Create policy_proposals (Self-Tuning Fabric proposal ledger)",
            already_applied: |conn| has_table(conn, "policy_proposals"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS policy_proposals (
                        id                   TEXT PRIMARY KEY,
                        kind                 TEXT NOT NULL
                            CHECK(kind IN ('routing_rule', 'budget_ceiling', 'healing_strategy')),
                        category             TEXT,
                        payload_json         TEXT NOT NULL,
                        evidence_snapshot_id TEXT NOT NULL,
                        evidence_json        TEXT NOT NULL,
                        status               TEXT NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending', 'applied', 'declined')),
                        decline_reason       TEXT,
                        created_at           TEXT NOT NULL DEFAULT (datetime('now')),
                        decided_at           TEXT
                    );",
                )?;
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_policy_proposals_status
                        ON policy_proposals(status, created_at DESC);",
                )?;
                Ok(())
            },
        },
    )?;

    // -- Pattern fabric v2: the three-layer model ----------------------------
    // (docs/concepts/pattern-fabric.md v2) Principle → Manifestation →
    // Evidence. `layer` classifies a knowledge row's place in that hierarchy:
    //   'principle'     — universal, language-free direction; the only layer
    //                     the topic tree and the graph canvas carry.
    //   'manifestation' — a principle applied to one stack/seam (Tauri IPC,
    //                     browser fetch, tokio reads); parent = governing_id.
    //   NULL            — not yet reclassified (the pre-v2 corpus). NULL is
    //                     deliberate: guessing a layer at migration time would
    //                     fake the review the restructuring panels exist to
    //                     do, so legacy rows stay honestly unclassified until
    //                     a panel (or a human) rules on them.
    if !has_column(conn, "workspace_knowledge", "layer").unwrap_or(true) {
        let _ = ddl_step(
            conn,
            "ALTER TABLE workspace_knowledge ADD COLUMN layer TEXT
                 CHECK (layer IN ('principle','manifestation'));",
        );
    }
    // Evidence as first-class rows, not markdown fused into detail_md. This
    // is what lets MULTIPLE projects stack references under one manifestation
    // (cross-language improvement flow), lets the verify lane REFRESH proof
    // (verified_at) instead of only scoring adherence, and makes evidence
    // aging visible instead of fossilized prose. `project_id` has no FK on
    // purpose — deleting a project leaves provenance readable, same posture
    // as workspace_knowledge.origin_project_id.
    let _ = ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS workspace_knowledge_evidence (
            id           TEXT PRIMARY KEY,
            knowledge_id TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
            project_id   TEXT,
            refs         TEXT NOT NULL DEFAULT '[]',
            quote        TEXT,
            source       TEXT NOT NULL CHECK (source IN ('harvest','verify','manual')),
            recorded_at  TEXT NOT NULL,
            verified_at  TEXT
        );",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_wke_knowledge
            ON workspace_knowledge_evidence(knowledge_id);",
    );
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_wke_project
            ON workspace_knowledge_evidence(project_id);",
    );

    // `team_assignment_steps.execution_id` is the only one of seven children of
    // `persona_executions` whose FK column has no index, and it carries
    // ON DELETE SET NULL — so every delete of an execution row makes SQLite scan
    // the whole child table to find referents.
    //
    // Measured by ablation on a copy of the live database: the FK cascade was
    // 97% of a 31.8 s delete (FTS was 5%). Adding this index took the same
    // delete from 26,016 ms to 1,066 ms — 24x.
    //
    // This matters beyond general slowness: execution retention has never
    // actually deleted a row (see retention-and-pruning.md), so the day that is
    // fixed, the hourly cleanup tick suddenly deletes ~1,776 rows. Without this
    // index that is a ~26 s app-wide write stall on a local SQLite file. The
    // index must therefore land BEFORE any retention change, not with it.
    let _ = ddl_step(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_tas_execution
            ON team_assignment_steps(execution_id);",
    );

    Ok(())
}
