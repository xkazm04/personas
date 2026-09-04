//! Agent-manifest rebase (spark `agent-manifest-rebase`, WP1): use cases and
//! parameters fold into `persona_responsibilities` (charters), and the
//! proposal + trigger tables learn to point at a charter.
//!
//! * `persona_responsibilities` gains `connectors` (JSON array of connector
//!   ids), `procedure` (how the charter is carried out) and `spec` (the
//!   runtime envelope, `ResponsibilitySpec` JSON), and its `source` CHECK
//!   widens to admit `agent-proposed`.
//! * `persona_memory_review_proposal.kind` CHECK widens to admit
//!   `responsibility_draft` (an agent proposing a charter, human-gated like
//!   every other proposal family).
//! * `persona_triggers.responsibility_id` — nullable, no FK (the same
//!   orphan-tolerance posture as `use_case_id`, which stays as the legacy
//!   column, untouched).
//! * A ONE-WAY data migration mints one `source = 'migration'` charter per
//!   design-context use case and remaps each trigger's `use_case_id` onto the
//!   minted charter. `design_context` itself is NOT rewritten here — the
//!   cutover WP owns the writer side; this step only reads it.
//!
//! Both CHECK widenings are table rebuilds: SQLite cannot alter a CHECK in
//! place, and both constraints live in the stored DDL (`e16` added `kind` via
//! `ADD COLUMN ... CHECK(...)`, which is still part of the table's `sql`). The
//! rebuild follows `support::rebuild_executions_table_with_incomplete_status`
//! — recreate from the table's OWN stored DDL with only the CHECK widened, so
//! the column set is byte-identical and `SELECT *` copies cleanly.
//!
//! Every step is guarded by `has_table` / `has_column` / a DDL-text probe:
//! `init_test_db` drops several tables in the TEST binary, and an unguarded
//! ALTER there is a crash, not a migration.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// `spec` key the minted charters carry their originating use-case id under
/// (camelCase because `ResponsibilitySpec` serializes `rename_all =
/// "camelCase"`). The migration's idempotency key AND the trigger remap's join.
const MIGRATED_FROM_KEY: &str = "migratedFromUseCaseId";

/// `persona_responsibilities` is absent in the TEST binary's dropped-table
/// set: a step over a missing table is vacuously applied.
fn responsibilities_column_applied(conn: &Connection, column: &str) -> Result<bool, AppError> {
    Ok(!has_table(conn, "persona_responsibilities")?
        || has_column(conn, "persona_responsibilities", column)?)
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.connectors",
            description: "Add connectors to persona_responsibilities (JSON array of connector ids)",
            already_applied: |conn| responsibilities_column_applied(conn, "connectors"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_responsibilities
                         ADD COLUMN connectors TEXT NOT NULL DEFAULT '[]';",
                )
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.procedure",
            description:
                "Add procedure to persona_responsibilities (how the charter is carried out)",
            already_applied: |conn| responsibilities_column_applied(conn, "procedure"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_responsibilities
                         ADD COLUMN procedure TEXT NOT NULL DEFAULT '';",
                )
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.spec",
            description: "Add spec to persona_responsibilities (ResponsibilitySpec JSON envelope)",
            already_applied: |conn| responsibilities_column_applied(conn, "spec"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_responsibilities
                         ADD COLUMN spec TEXT NOT NULL DEFAULT '{}';",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.source_check.agent_proposed",
            description: "Widen persona_responsibilities.source CHECK to admit 'agent-proposed'",
            already_applied: |conn| {
                Ok(!has_table(conn, "persona_responsibilities")?
                    || table_ddl_contains(conn, "persona_responsibilities", "'agent-proposed'")?)
            },
            apply: |conn| {
                rebuild_table_widening_check(
                    conn,
                    "persona_responsibilities",
                    "'migration'",
                    "'migration','agent-proposed'",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memory_review_proposal.kind_check.responsibility_draft",
            description:
                "Widen persona_memory_review_proposal.kind CHECK to admit 'responsibility_draft'",
            already_applied: |conn| {
                Ok(!has_table(conn, "persona_memory_review_proposal")?
                    || !has_column(conn, "persona_memory_review_proposal", "kind")?
                    || table_ddl_contains(
                        conn,
                        "persona_memory_review_proposal",
                        "'responsibility_draft'",
                    )?)
            },
            apply: |conn| {
                rebuild_table_widening_check(
                    conn,
                    "persona_memory_review_proposal",
                    "'self_model_diff'",
                    "'self_model_diff','responsibility_draft'",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_triggers.responsibility_id",
            description: "Add responsibility_id to persona_triggers (nullable, no FK; use_case_id stays legacy)",
            already_applied: |conn| {
                Ok(!has_table(conn, "persona_triggers")?
                    || has_column(conn, "persona_triggers", "responsibility_id")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_triggers ADD COLUMN responsibility_id TEXT;
                     CREATE INDEX IF NOT EXISTS idx_pt_responsibility
                         ON persona_triggers(responsibility_id);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.mint_from_use_cases",
            description: "Mint one 'migration' charter per design-context use case and remap trigger use_case_id -> responsibility_id",
            // The probe IS the idempotency check: nothing left to mint and
            // nothing left to remap. The mint is keyed per use-case id
            // (`spec.migratedFromUseCaseId`), so a crash mid-way re-runs as
            // a plain continuation, never a double-mint.
            already_applied: |conn| {
                if !mint_preconditions_hold(conn)? {
                    return Ok(true);
                }
                Ok(pending_use_cases(conn)?.is_empty() && remappable_trigger_count(conn)? == 0)
            },
            apply: |conn| {
                let minted = mint_pending_use_cases(conn)?;
                let remapped = remap_triggers(conn)?;
                tracing::info!(
                    minted,
                    remapped,
                    "e19: folded design-context use cases into persona_responsibilities"
                );
                Ok(())
            },
        },
    )?;

    Ok(())
}

// ── CHECK widening (table rebuild) ─────────────────────────────────────────

/// Whether the table's stored `CREATE TABLE` text contains `needle` — the
/// DDL-text probe for a CHECK list this chain has already widened.
fn table_ddl_contains(conn: &Connection, table: &str, needle: &str) -> Result<bool, AppError> {
    let ddl: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |r| r.get("sql"),
        )
        .ok();
    Ok(ddl.is_some_and(|d| d.contains(needle)))
}

/// Recreate `table` from its own stored DDL with exactly one substring of its
/// CHECK list replaced (`from` → `to`), copying every row across and replaying
/// the table's index/trigger DDL. Refuses (rather than silently keeping the
/// old constraint) when `from` is not found exactly once.
fn rebuild_table_widening_check(
    conn: &Connection,
    table: &str,
    from: &str,
    to: &str,
) -> Result<(), AppError> {
    let _fk_guard = crate::FkDisabledGuard::new(conn).map_err(AppError::Database)?;

    let create_sql: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |r| r.get("sql"),
    )?;
    if create_sql.matches(from).count() != 1 {
        return Err(AppError::Internal(format!(
            "e19: `{table}` DDL does not contain `{from}` exactly once; refusing to rebuild"
        )));
    }
    let aux_sql: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT sql FROM sqlite_master
             WHERE tbl_name = ?1 AND type IN ('index','trigger') AND sql IS NOT NULL",
        )?;
        let rows = stmt.query_map([table], |r| r.get::<_, String>("sql"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?
    };

    let staging = format!("{table}_new");
    let widened = create_sql.replacen(from, to, 1);
    // The table name appears once in its own CREATE (FK clauses reference
    // OTHER tables); both tables here reference only `personas`.
    let staged = widened.replacen(table, &staging, 1);

    let mut batch = String::new();
    batch.push_str(&format!("DROP TABLE IF EXISTS {staging};\n"));
    batch.push_str(&staged);
    batch.push_str(";\n");
    batch.push_str(&format!("INSERT INTO {staging} SELECT * FROM {table};\n"));
    batch.push_str(&format!("DROP TABLE {table};\n"));
    batch.push_str(&format!("ALTER TABLE {staging} RENAME TO {table};\n"));
    for s in &aux_sql {
        batch.push_str(s);
        batch.push_str(";\n");
    }
    ddl_step(conn, &batch)
}

// ── Use case → charter mint ────────────────────────────────────────────────

/// Every table the mint reads or writes must exist (the TEST binary drops
/// some of them); otherwise the step is vacuously applied.
fn mint_preconditions_hold(conn: &Connection) -> Result<bool, AppError> {
    Ok(has_table(conn, "personas")?
        && has_column(conn, "personas", "design_context")?
        && has_table(conn, "persona_responsibilities")?
        && has_column(conn, "persona_responsibilities", "spec")?)
}

/// A use case still waiting to be minted: `(persona_id, use_case JSON)`.
struct PendingUseCase {
    persona_id: String,
    use_case: serde_json::Value,
}

/// Dual-key lookup on a design-context object. Replicates
/// `personas_engine::design_context::pick_use_cases_array` minimally (the db
/// crate cannot depend on the engine crate): snake_case first, camelCase
/// second — both shapes have shipped in production.
fn pick<'a>(obj: &'a serde_json::Value, snake: &str, camel: &str) -> Option<&'a serde_json::Value> {
    obj.get(snake).or_else(|| obj.get(camel))
}

fn pick_str<'a>(obj: &'a serde_json::Value, snake: &str, camel: &str) -> Option<&'a str> {
    pick(obj, snake, camel)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Use-case ids already minted for a persona (`spec.migratedFromUseCaseId`).
fn minted_ids(conn: &Connection, persona_id: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT json_extract(spec, '$.{MIGRATED_FROM_KEY}') AS uc
         FROM persona_responsibilities
         WHERE persona_id = ?1 AND source = 'migration'
           AND json_extract(spec, '$.{MIGRATED_FROM_KEY}') IS NOT NULL"
    ))?;
    let rows = stmt.query_map([persona_id], |r| r.get::<_, String>("uc"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

/// Every `(persona, use case)` pair with an id that has no minted charter yet.
/// Use cases without an id are skipped (and warned): with no key there is no
/// way to make minting them idempotent.
fn pending_use_cases(conn: &Connection) -> Result<Vec<PendingUseCase>, AppError> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, design_context FROM personas
         WHERE design_context IS NOT NULL AND design_context != ''",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>("id")?,
            r.get::<_, String>("design_context")?,
        ))
    })?;
    let personas: Vec<(String, String)> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)?;

    let mut pending = Vec::new();
    for (persona_id, raw) in personas {
        let dc: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(
                    persona_id,
                    error = %e,
                    "e19: design_context does not parse; no charters minted for this persona"
                );
                continue;
            }
        };
        let Some(use_cases) = pick(&dc, "use_cases", "useCases").and_then(|v| v.as_array()) else {
            continue;
        };
        let already = minted_ids(conn, &persona_id)?;
        for uc in use_cases {
            let Some(id) = uc
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
            else {
                tracing::warn!(
                    persona_id,
                    "e19: design_context use case carries no id; skipped (cannot be minted idempotently)"
                );
                continue;
            };
            if already.iter().any(|m| m == id) {
                continue;
            }
            pending.push(PendingUseCase {
                persona_id: persona_id.clone(),
                use_case: uc.clone(),
            });
        }
    }
    Ok(pending)
}

/// The charter row a use case becomes: `(title, domain, procedure,
/// connectors JSON, spec JSON, status)`.
struct MintedCharter {
    title: String,
    domain: String,
    procedure: String,
    connectors_json: String,
    spec_json: String,
    status: &'static str,
}

/// Pure: map one use-case object onto its charter fields. The `spec` keys are
/// the camelCase wire names of `ResponsibilitySpec`; the legacy use case's
/// `review_policy` maps to `approval_gates = []` (nothing in the old policy
/// named a gate) and is otherwise not carried.
fn charter_from_use_case(uc: &serde_json::Value) -> MintedCharter {
    let id = uc.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let title = pick_str(uc, "title", "title")
        .or_else(|| pick_str(uc, "name", "name"))
        .map(str::to_string)
        .unwrap_or_else(|| format!("Use case {id}"));
    let domain = pick_str(uc, "category", "category")
        .unwrap_or("general")
        .to_string();

    let summary_first_line = pick_str(uc, "capability_summary", "capabilitySummary")
        .and_then(|s| s.lines().next())
        .map(str::trim)
        .unwrap_or("");
    let description = pick_str(uc, "description", "description").unwrap_or("");
    let procedure = match (summary_first_line.is_empty(), description.is_empty()) {
        (true, _) => description.to_string(),
        (false, true) => summary_first_line.to_string(),
        (false, false) if summary_first_line == description => description.to_string(),
        (false, false) => format!("{summary_first_line}\n\n{description}"),
    };

    let connectors: Vec<String> = pick(uc, "connectors", "connectors")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    c.as_str()
                        .or_else(|| c.get("id").and_then(|v| v.as_str()))
                        .or_else(|| c.get("name").and_then(|v| v.as_str()))
                })
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let mut spec = serde_json::Map::new();
    let mut put = |key: &str, value: Option<serde_json::Value>| {
        if let Some(v) = value.filter(|v| !v.is_null()) {
            spec.insert(key.to_string(), v);
        }
    };
    put(
        "inputSchema",
        pick(uc, "input_schema", "inputSchema").cloned(),
    );
    put(
        "sampleInput",
        pick(uc, "sample_input", "sampleInput").cloned(),
    );
    // `model_override` is a string on the wire; a structured legacy value
    // is kept as its JSON text rather than dropped.
    put(
        "modelOverride",
        pick(uc, "model_override", "modelOverride").map(|v| match v {
            serde_json::Value::String(s) => serde_json::Value::String(s.clone()),
            other => serde_json::Value::String(other.to_string()),
        }),
    );
    put(
        "engineMode",
        pick(uc, "execution_mode", "executionMode")
            .or_else(|| pick(uc, "engine_mode", "engineMode"))
            .filter(|v| v.is_string())
            .cloned(),
    );
    // Notification channels: a list of strings, or of objects carrying a
    // `type` — reduced to the type names the spec can hold.
    put(
        "notificationChannels",
        pick(uc, "notification_channels", "notificationChannels")
            .and_then(|v| v.as_array())
            .map(|arr| {
                serde_json::Value::Array(
                    arr.iter()
                        .filter_map(|c| {
                            c.as_str()
                                .or_else(|| c.get("type").and_then(|t| t.as_str()))
                                .map(|s| serde_json::Value::String(s.to_string()))
                        })
                        .collect(),
                )
            }),
    );
    put(
        "eventSubscriptions",
        pick(uc, "event_subscriptions", "eventSubscriptions").cloned(),
    );
    put(
        "errorPolicy",
        pick(uc, "error_policy", "errorPolicy")
            .or_else(|| pick(uc, "error_handling", "errorHandling"))
            .and_then(|v| v.as_object())
            .map(|o| {
                let mut ep = serde_json::Map::new();
                if let Some(b) = o.get("incident").and_then(|v| v.as_bool()) {
                    ep.insert("incident".into(), serde_json::Value::Bool(b));
                }
                if let Some(b) = o.get("lab").and_then(|v| v.as_bool()) {
                    ep.insert("lab".into(), serde_json::Value::Bool(b));
                }
                if let Some(n) = o
                    .get("escalate_after")
                    .or_else(|| o.get("escalateAfter"))
                    .and_then(|v| v.as_i64())
                {
                    ep.insert("escalateAfter".into(), serde_json::Value::from(n));
                }
                serde_json::Value::Object(ep)
            }),
    );
    put("timeFilter", pick(uc, "time_filter", "timeFilter").cloned());
    put(
        "testFixtures",
        pick(uc, "test_fixtures", "testFixtures").cloned(),
    );
    put(
        "sourceRecipeId",
        pick(uc, "source_recipe_id", "sourceRecipeId")
            .filter(|v| v.is_string())
            .cloned(),
    );
    put(
        "sourceRecipeVersion",
        pick(uc, "source_recipe_version", "sourceRecipeVersion")
            .filter(|v| v.is_string())
            .cloned(),
    );
    put(
        "memoryPolicy",
        pick(uc, "memory_policy", "memoryPolicy").cloned(),
    );
    put(
        "suggestedTrigger",
        pick(uc, "suggested_trigger", "suggestedTrigger").cloned(),
    );
    put(
        MIGRATED_FROM_KEY,
        Some(serde_json::Value::String(id.to_string())),
    );

    let status = match uc.get("enabled").and_then(|v| v.as_bool()) {
        Some(false) => "suspended",
        _ => "active",
    };

    MintedCharter {
        title,
        domain,
        procedure,
        connectors_json: serde_json::Value::Array(
            connectors
                .into_iter()
                .map(serde_json::Value::String)
                .collect(),
        )
        .to_string(),
        spec_json: serde_json::Value::Object(spec).to_string(),
        status,
    }
}

fn mint_pending_use_cases(conn: &Connection) -> Result<usize, AppError> {
    let pending = pending_use_cases(conn)?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut minted = 0usize;
    for p in pending {
        let c = charter_from_use_case(&p.use_case);
        let id = format!("resp_{}", uuid::Uuid::new_v4().simple());
        conn.execute(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, status, source,
                 connectors, procedure, spec, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'migration', ?6, ?7, ?8, ?9, ?9)",
            rusqlite::params![
                id,
                p.persona_id,
                c.title,
                c.domain,
                c.status,
                c.connectors_json,
                c.procedure,
                c.spec_json,
                now,
            ],
        )?;
        minted += 1;
    }
    Ok(minted)
}

// ── Trigger remap ──────────────────────────────────────────────────────────

fn remappable_trigger_count(conn: &Connection) -> Result<i64, AppError> {
    if !has_table(conn, "persona_triggers")?
        || !has_column(conn, "persona_triggers", "use_case_id")?
        || !has_column(conn, "persona_triggers", "responsibility_id")?
    {
        return Ok(0);
    }
    let n: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) AS n FROM persona_triggers t
             WHERE t.responsibility_id IS NULL AND t.use_case_id IS NOT NULL
               AND EXISTS (
                   SELECT 1 FROM persona_responsibilities r
                   WHERE r.persona_id = t.persona_id
                     AND json_extract(r.spec, '$.{MIGRATED_FROM_KEY}') = t.use_case_id)"
        ),
        [],
        |r| r.get("n"),
    )?;
    Ok(n)
}

/// Point every trigger that still names a use case at the charter minted
/// from it. `use_case_id` is left exactly as it was (legacy column).
fn remap_triggers(conn: &Connection) -> Result<usize, AppError> {
    if remappable_trigger_count(conn)? == 0 {
        return Ok(0);
    }
    let n = conn.execute(
        &format!(
            "UPDATE persona_triggers
             SET responsibility_id = (
                 SELECT r.id FROM persona_responsibilities r
                 WHERE r.persona_id = persona_triggers.persona_id
                   AND json_extract(r.spec, '$.{MIGRATED_FROM_KEY}') = persona_triggers.use_case_id
                 ORDER BY r.created_at ASC, r.id ASC
                 LIMIT 1)
             WHERE responsibility_id IS NULL AND use_case_id IS NOT NULL
               AND EXISTS (
                   SELECT 1 FROM persona_responsibilities r
                   WHERE r.persona_id = persona_triggers.persona_id
                     AND json_extract(r.spec, '$.{MIGRATED_FROM_KEY}') = persona_triggers.use_case_id)"
        ),
        [],
    )?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use personas_core::error::AppError;

    use super::*;

    fn seed_persona(conn: &Connection, id: &str, design_context: Option<&str>) {
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, design_context, created_at, updated_at)
             VALUES (?1, ?1, 'sp', ?2, datetime('now'), datetime('now'))",
            rusqlite::params![id, design_context],
        )
        .expect("seed persona");
    }

    #[test]
    fn e19_columns_and_widened_checks_are_in_place_and_idempotent() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        seed_persona(&conn, "p1", None);

        // The widened CHECKs admit the new values (and still refuse others).
        conn.execute(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, source, created_at, updated_at)
             VALUES ('r1', 'p1', 'Proposed', 'agent-proposed', datetime('now'), datetime('now'))",
            [],
        )?;
        assert!(conn
            .execute(
                "INSERT INTO persona_responsibilities
                    (id, persona_id, title, source, created_at, updated_at)
                 VALUES ('r-bad', 'p1', 't', 'martian', datetime('now'), datetime('now'))",
                [],
            )
            .is_err());
        conn.execute(
            "INSERT INTO persona_memory_review_proposal
                (id, persona_id, threshold, proposal_json, kind)
             VALUES ('mp1', 'p1', 0, '{}', 'responsibility_draft')",
            [],
        )?;
        assert!(conn
            .execute(
                "INSERT INTO persona_memory_review_proposal
                    (id, persona_id, threshold, proposal_json, kind)
                 VALUES ('mp-bad', 'p1', 0, '{}', 'daydream')",
                [],
            )
            .is_err());
        // Old kinds and the column default survive the rebuild.
        conn.execute(
            "INSERT INTO persona_memory_review_proposal
                (id, persona_id, threshold, proposal_json)
             VALUES ('mp2', 'p1', 0, '{}')",
            [],
        )?;
        let kind: String = conn.query_row(
            "SELECT kind FROM persona_memory_review_proposal WHERE id = 'mp2'",
            [],
            |r| r.get("kind"),
        )?;
        assert_eq!(kind, "memory_curation");

        // The new columns carry their defaults, and the trigger column exists.
        let (connectors, procedure, spec): (String, String, String) = conn.query_row(
            "SELECT connectors, procedure, spec FROM persona_responsibilities WHERE id = 'r1'",
            [],
            |r| Ok((r.get("connectors")?, r.get("procedure")?, r.get("spec")?)),
        )?;
        assert_eq!(
            (connectors.as_str(), procedure.as_str(), spec.as_str()),
            ("[]", "", "{}")
        );
        assert!(has_column(&conn, "persona_triggers", "responsibility_id")?);

        // Replaying the era is a no-op: rows survive, nothing errors.
        super::run(&conn).expect("e19 second run");
        super::run(&conn).expect("e19 third run");
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) AS n FROM persona_responsibilities",
            [],
            |r| r.get("n"),
        )?;
        assert_eq!(n, 1);
        let idx: i64 = conn.query_row(
            "SELECT COUNT(*) AS n FROM sqlite_master
             WHERE type = 'index' AND tbl_name = 'persona_memory_review_proposal'",
            [],
            |r| r.get("n"),
        )?;
        assert!(
            idx >= 2,
            "the table's indexes are replayed after the rebuild"
        );
        Ok(())
    }

    #[test]
    fn e19_mints_charters_from_use_cases_once_and_remaps_triggers() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        // camelCase envelope (matrix-builder shape) with the whole field set.
        seed_persona(
            &conn,
            "p-camel",
            Some(
                r##"{"useCases":[
                    {"id":"uc_a","title":"Watch Slack","description":"Summarize the channel.",
                     "capabilitySummary":"Daily Slack digest\nsecond line ignored",
                     "category":"support","connectors":["slack",{"id":"github"}],
                     "executionMode":"agentic","inputSchema":[{"key":"channel"}],
                     "sampleInput":{"channel":"#ops"},"modelOverride":"claude-sonnet",
                     "notificationChannels":[{"type":"slack"},"email"],
                     "errorPolicy":{"incident":true,"escalateAfter":2},
                     "sourceRecipeId":"rcp_1","sourceRecipeVersion":"3",
                     "suggestedTrigger":{"type":"schedule","cron":"0 9 * * *"}},
                    {"id":"uc_b","title":"Disabled one","enabled":false},
                    {"title":"No id, never minted"}
                ]}"##,
            ),
        );
        // snake_case envelope (dry-run snapshot shape).
        seed_persona(
            &conn,
            "p-snake",
            Some(
                r#"{"use_cases":[{"id":"uc_s","name":"Snake case","error_handling":{"lab":true}}]}"#,
            ),
        );
        seed_persona(&conn, "p-none", Some(r#"{"summary":"nothing"}"#));
        seed_persona(&conn, "p-broken", Some("{not json"));
        conn.execute(
            "INSERT INTO persona_triggers
                (id, persona_id, trigger_type, use_case_id, created_at, updated_at)
             VALUES ('t1', 'p-camel', 'manual', 'uc_a', datetime('now'), datetime('now')),
                    ('t2', 'p-camel', 'manual', 'uc_zzz', datetime('now'), datetime('now')),
                    ('t3', 'p-snake', 'manual', 'uc_a', datetime('now'), datetime('now'))",
            [],
        )?;

        // init_test_db already ran the chain over an empty table; this is the
        // first pass that sees data.
        super::run(&conn).expect("e19 with data");

        let rows: Vec<(String, String, String, String, String, String, String)> = {
            let mut stmt = conn.prepare(
                "SELECT persona_id, title, domain, status, connectors, procedure, spec
                 FROM persona_responsibilities WHERE source = 'migration'
                 ORDER BY persona_id, title",
            )?;
            let it = stmt.query_map([], |r| {
                Ok((
                    r.get("persona_id")?,
                    r.get("title")?,
                    r.get("domain")?,
                    r.get("status")?,
                    r.get("connectors")?,
                    r.get("procedure")?,
                    r.get("spec")?,
                ))
            })?;
            it.collect::<Result<Vec<_>, _>>()?
        };
        assert_eq!(
            rows.len(),
            3,
            "uc_a, uc_b, uc_s — the id-less one is skipped"
        );

        // Ordered by (persona_id, title): p-camel's "Disabled one" first.
        let a = &rows[1];
        assert_eq!(
            (a.1.as_str(), a.2.as_str(), a.3.as_str()),
            ("Watch Slack", "support", "active")
        );
        assert_eq!(a.4, r#"["slack","github"]"#);
        assert_eq!(a.5, "Daily Slack digest\n\nSummarize the channel.");
        let spec: serde_json::Value = serde_json::from_str(&a.6).unwrap();
        assert_eq!(spec["engineMode"], "agentic");
        assert_eq!(spec["modelOverride"], "claude-sonnet");
        assert_eq!(
            spec["notificationChannels"],
            serde_json::json!(["slack", "email"])
        );
        assert_eq!(
            spec["errorPolicy"],
            serde_json::json!({"incident": true, "escalateAfter": 2})
        );
        assert_eq!(spec["sourceRecipeId"], "rcp_1");
        assert_eq!(spec["sourceRecipeVersion"], "3");
        assert_eq!(spec["suggestedTrigger"]["cron"], "0 9 * * *");
        assert_eq!(spec["sampleInput"]["channel"], "#ops");
        assert_eq!(spec[MIGRATED_FROM_KEY], "uc_a");
        assert!(spec.get("timeFilter").is_none(), "absent stays absent");

        let b = &rows[0];
        assert_eq!(
            (b.1.as_str(), b.2.as_str(), b.3.as_str()),
            ("Disabled one", "general", "suspended")
        );

        let s = &rows[2];
        assert_eq!(s.0, "p-snake");
        assert_eq!(s.1, "Snake case");
        let spec_s: serde_json::Value = serde_json::from_str(&s.6).unwrap();
        assert_eq!(spec_s["errorPolicy"], serde_json::json!({"lab": true}));

        // The spec parses back into the typed shape the repo reads.
        let typed: crate::models::ResponsibilitySpec = serde_json::from_str(&a.6).unwrap();
        assert_eq!(typed.migrated_from_use_case_id.as_deref(), Some("uc_a"));
        assert_eq!(typed.error_policy.unwrap().escalate_after, Some(2));

        // Triggers: t1 remapped to uc_a's charter, t2 (unknown use case) and
        // t3 (another persona's use-case id) untouched; use_case_id kept.
        let t1: (Option<String>, Option<String>) = conn.query_row(
            "SELECT responsibility_id, use_case_id FROM persona_triggers WHERE id = 't1'",
            [],
            |r| Ok((r.get("responsibility_id")?, r.get("use_case_id")?)),
        )?;
        let a_id: String = conn.query_row(
            "SELECT id FROM persona_responsibilities WHERE title = 'Watch Slack'",
            [],
            |r| r.get("id"),
        )?;
        assert_eq!(t1.0.as_deref(), Some(a_id.as_str()));
        assert_eq!(t1.1.as_deref(), Some("uc_a"));
        for t in ["t2", "t3"] {
            let rid: Option<String> = conn.query_row(
                "SELECT responsibility_id FROM persona_triggers WHERE id = ?1",
                [t],
                |r| r.get("responsibility_id"),
            )?;
            assert!(rid.is_none(), "{t} must stay unmapped");
        }

        // design_context is read, never rewritten.
        let dc: String = conn.query_row(
            "SELECT design_context FROM personas WHERE id = 'p-camel'",
            [],
            |r| r.get("design_context"),
        )?;
        assert!(dc.contains("\"useCases\""));

        // Idempotent: a replay mints nothing new; a NEW use case added later
        // is minted on the next boot without touching the existing rows.
        super::run(&conn).expect("e19 replay");
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) AS n FROM persona_responsibilities WHERE source = 'migration'",
            [],
            |r| r.get("n"),
        )?;
        assert_eq!(n, 3);
        conn.execute(
            r#"UPDATE personas SET design_context =
               '{"useCases":[{"id":"uc_a","title":"Renamed later"},{"id":"uc_new","title":"Fresh"}]}'
               WHERE id = 'p-camel'"#,
            [],
        )?;
        super::run(&conn).expect("e19 with a new use case");
        let titles: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT title FROM persona_responsibilities
                 WHERE persona_id = 'p-camel' AND source = 'migration' ORDER BY title",
            )?;
            let it = stmt.query_map([], |r| r.get::<_, String>("title"))?;
            it.collect::<Result<Vec<_>, _>>()?
        };
        assert_eq!(titles, vec!["Disabled one", "Fresh", "Watch Slack"]);
        Ok(())
    }
}
