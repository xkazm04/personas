//! The companion's generic SQL write capability, held away from the runtime's
//! own records.
//!
//! The companion's `personas_database.execute_mutation` connector runs raw SQL
//! against the USER database, and that database is where the companion runtime
//! keeps the records of what the companion did — the per-turn cost and error
//! ledger, the approval row every proposed action leaves, the job table, the
//! night-shift event log — and the budgets that bound it. They were put there on
//! purpose, so the companion can READ its own history with no extra wiring.
//! A generic write capability over the same store makes every one of those
//! records answerable to the party it records: under autonomous mode a proposed
//! action fires without a click, so one `DELETE` or `UPDATE` rewrites the error
//! rate the health surface reports and the audit the daily rollup is composed
//! from, and one `CREATE TEMP TABLE` shadows a ledger for the life of a pooled
//! connection, so the recorder's own inserts land in a table that vanishes.
//!
//! So every statement the companion runs is authorized by SQLite itself, per
//! table it touches: a write of any kind — a row or the structure — to a table
//! the companion schema declares is refused. Reads stay granted, and tables the
//! companion created for its own work are untouched. The protected population
//! is derived from [`crate::COMPANION_SCHEMA`], so a ledger added there is
//! covered the day it is added, and the engine's authorizer is the classifier
//! rather than a parse of the SQL text, so spelling, quoting, schema
//! qualification and trigger bodies do not route around it.

use std::sync::{Arc, Mutex, OnceLock};

use personas_core::error::AppError;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::Connection;

/// Table names declared by the companion schema, lower-cased. Virtual tables
/// are kept apart because SQLite backs each with shadow tables named
/// `<virtual>_<suffix>`, which are runtime-owned too.
struct RuntimeTables {
    plain: Vec<String>,
    virtual_tables: Vec<String>,
}

fn parse_schema(schema: &str) -> RuntimeTables {
    let mut plain = Vec::new();
    let mut virtual_tables = Vec::new();
    for line in schema.lines() {
        let lower = line.trim_start().to_ascii_lowercase();
        let (rest, is_virtual) = if let Some(r) = lower.strip_prefix("create table if not exists ")
        {
            (r, false)
        } else if let Some(r) = lower.strip_prefix("create virtual table if not exists ") {
            (r, true)
        } else {
            continue;
        };
        let name: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if name.is_empty() {
            continue;
        }
        let list = if is_virtual {
            &mut virtual_tables
        } else {
            &mut plain
        };
        if !list.contains(&name) {
            list.push(name);
        }
    }
    RuntimeTables {
        plain,
        virtual_tables,
    }
}

fn runtime_tables() -> &'static RuntimeTables {
    static TABLES: OnceLock<RuntimeTables> = OnceLock::new();
    TABLES.get_or_init(|| parse_schema(crate::COMPANION_SCHEMA))
}

/// True when `name` is a table the companion runtime owns in the user database.
pub fn is_runtime_table(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let tables = runtime_tables();
    tables.plain.contains(&name)
        || tables.virtual_tables.iter().any(|v| {
            name == *v
                || name
                    .strip_prefix(v.as_str())
                    .is_some_and(|rest| rest.starts_with('_'))
        })
}

#[derive(Clone, Copy)]
enum Policy {
    /// No authorizer — the capability as it stood before this module.
    #[cfg(test)]
    Off,
    /// Refuse only the structural replacement of a runtime table.
    #[cfg(test)]
    StructureOnly,
    /// Refuse every write, row or structure, to a runtime table.
    Full,
}

/// The runtime table an action would write, if the policy refuses it.
fn refused_table<'a>(policy: Policy, action: &AuthAction<'a>) -> Option<&'a str> {
    // `is_row_write` separates the arms the tests measure; production refuses both.
    #[cfg_attr(not(test), allow(unused_variables))]
    let (table, is_row_write) = match *action {
        AuthAction::Insert { table_name } | AuthAction::Delete { table_name } => (table_name, true),
        AuthAction::Update { table_name, .. } => (table_name, true),
        AuthAction::CreateTable { table_name }
        | AuthAction::CreateTempTable { table_name }
        | AuthAction::DropTable { table_name }
        | AuthAction::DropTempTable { table_name }
        | AuthAction::AlterTable { table_name, .. }
        | AuthAction::CreateTrigger { table_name, .. }
        | AuthAction::CreateTempTrigger { table_name, .. }
        | AuthAction::DropTrigger { table_name, .. }
        | AuthAction::DropTempTrigger { table_name, .. }
        | AuthAction::CreateIndex { table_name, .. }
        | AuthAction::CreateTempIndex { table_name, .. }
        | AuthAction::DropIndex { table_name, .. }
        | AuthAction::DropTempIndex { table_name, .. }
        | AuthAction::CreateVtable { table_name, .. }
        | AuthAction::DropVtable { table_name, .. } => (table_name, false),
        // A view under a runtime table's name shadows it for every unqualified
        // read on that connection, exactly as a temp table does.
        AuthAction::CreateView { view_name } | AuthAction::CreateTempView { view_name } => {
            (view_name, false)
        }
        _ => return None,
    };
    if !is_runtime_table(table) {
        return None;
    }
    match policy {
        #[cfg(test)]
        Policy::Off => None,
        #[cfg(test)]
        Policy::StructureOnly => (!is_row_write).then_some(table),
        Policy::Full => Some(table),
    }
}

fn run_with(conn: &Connection, sql: &str, policy: Policy) -> Result<usize, AppError> {
    let refused: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let seen = Arc::clone(&refused);
    conn.authorizer(Some(move |ctx: AuthContext<'_>| {
        match refused_table(policy, &ctx.action) {
            Some(table) => {
                if let Ok(mut slot) = seen.lock() {
                    slot.get_or_insert_with(|| table.to_string());
                }
                Authorization::Deny
            }
            None => Authorization::Allow,
        }
    }))?;
    let result = conn.execute(sql, []);
    // The connection returns to a shared pool. An authorizer left on it would
    // refuse the runtime's OWN writes to these tables for as long as the
    // connection lives, so it comes off before anything else, error or not.
    conn.authorizer(None::<fn(AuthContext<'_>) -> Authorization>)?;
    match result {
        Ok(changed) => Ok(changed),
        Err(err) => match refused.lock().ok().and_then(|mut slot| slot.take()) {
            Some(table) => Err(AppError::Forbidden(format!(
                "`{table}` is one of the companion runtime's own records. It can be read \
                 (execute_select) but not written by the agent it records; write to a \
                 table of your own instead."
            ))),
            None => Err(err.into()),
        },
    }
}

/// Run one statement for the companion, refusing any write to a runtime table.
pub fn run_agent_mutation(conn: &Connection, sql: &str) -> Result<usize, AppError> {
    run_with(conn, sql, Policy::Full)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_conn() -> r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager> {
        let pool = crate::init_test_user_db().expect("test user db");
        // Keep the pool alive for the connection's lifetime.
        let pool: &'static crate::UserDbPool = Box::leak(Box::new(pool));
        pool.get().expect("conn")
    }

    fn seed_turn(conn: &Connection, id: &str, is_error: i64) {
        conn.execute(
            "INSERT INTO companion_turn (id, origin, is_error) VALUES (?1, 'chat', ?2)",
            rusqlite::params![id, is_error],
        )
        .expect("runtime insert into companion_turn");
    }

    fn main_turns(conn: &Connection) -> (i64, i64) {
        conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(is_error), 0) FROM main.companion_turn",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("count main.companion_turn")
    }

    fn table_exists(conn: &Connection, schema: &str, name: &str) -> bool {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM {schema}.sqlite_master WHERE name = ?1"),
            [name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
            > 0
    }

    /// The hostile statements of the declared target, T1-T10. Each returns
    /// true when the statement was refused AND the record came through intact.
    fn target_refused(policy: Policy, case: usize) -> bool {
        let conn = user_conn();
        seed_turn(&conn, "t-ok", 0);
        seed_turn(&conn, "t-err", 1);
        conn.execute(
            "INSERT INTO companion_approval (id, session_id, kind, payload, status) \
             VALUES ('a1', 's1', 'use_connector', '{}', 'executed')",
            [],
        )
        .expect("runtime insert into companion_approval");
        conn.execute(
            "INSERT INTO companion_proactive_budget (date, count) VALUES ('2026-09-25', 5)",
            [],
        )
        .expect("runtime insert into companion_proactive_budget");
        let approvals_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM companion_approval", [], |r| r.get(0))
            .unwrap_or(-1);
        let budget_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM companion_proactive_budget", [], |r| {
                r.get(0)
            })
            .unwrap_or(-1);
        let sql = match case {
            1 => "DELETE FROM companion_turn",
            2 => "UPDATE companion_turn SET is_error = 0",
            3 => "INSERT INTO companion_turn (id, origin, is_error) VALUES ('forged', 'chat', 0)",
            4 => "DROP TABLE companion_turn",
            5 => "ALTER TABLE companion_turn RENAME TO companion_turn_gone",
            6 => {
                "CREATE TRIGGER erase_turns AFTER INSERT ON companion_turn \
                 BEGIN DELETE FROM companion_turn WHERE id = NEW.id; END"
            }
            7 => "CREATE TEMP TABLE companion_turn (id TEXT, origin TEXT, is_error INTEGER)",
            8 => "DELETE FROM companion_approval",
            9 => "DELETE FROM companion_proactive_budget",
            10 => "delete from MAIN.\"Companion_Turn\"",
            _ => unreachable!(),
        };
        let refused = run_with(&conn, sql, policy).is_err();
        // The runtime keeps recording on the same connection afterwards.
        let _ = conn.execute(
            "INSERT INTO companion_turn (id, origin, is_error) VALUES ('t-after', 'chat', 1)",
            [],
        );
        let intact = table_exists(&conn, "main", "companion_turn")
            && !table_exists(&conn, "temp", "companion_turn")
            && main_turns(&conn) == (3, 2)
            && conn
                .query_row("SELECT COUNT(*) FROM companion_approval", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap_or(-2)
                == approvals_before
            && conn
                .query_row("SELECT COUNT(*) FROM companion_proactive_budget", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap_or(-2)
                == budget_before;
        refused && intact
    }

    /// F1: the agent's own working table takes every verb.
    fn agent_table_writable(policy: Policy) -> usize {
        let conn = user_conn();
        [
            "CREATE TABLE agent_notes (id INTEGER PRIMARY KEY, body TEXT)",
            "INSERT INTO agent_notes (body) VALUES ('first')",
            "UPDATE agent_notes SET body = 'second' WHERE id = 1",
            "DELETE FROM agent_notes WHERE id = 1",
            "DROP TABLE agent_notes",
        ]
        .iter()
        .filter(|sql| run_with(&conn, sql, policy).is_ok())
        .count()
    }

    /// F2: the record stays readable.
    fn record_readable(policy: Policy) -> bool {
        let conn = user_conn();
        seed_turn(&conn, "r1", 1);
        // A statement through the guard first, so a leaked authorizer would show.
        let _ = run_with(&conn, "CREATE TABLE scratch (x)", policy);
        main_turns(&conn) == (1, 1)
    }

    /// F3: the runtime's own write succeeds on the same connection after a
    /// refused agent statement.
    fn runtime_write_after_refusal(policy: Policy) -> bool {
        let conn = user_conn();
        let _ = run_with(&conn, "DELETE FROM companion_turn", policy);
        conn.execute(
            "INSERT INTO companion_turn (id, origin, is_error) VALUES ('rt', 'chat', 0)",
            [],
        )
        .is_ok()
    }

    #[test]
    fn schema_population_is_derived_and_covers_the_records() {
        let t = runtime_tables();
        assert!(
            t.plain.len() >= 30,
            "derived population too small: {}",
            t.plain.len()
        );
        for ledger in [
            "companion_turn",
            "companion_approval",
            "companion_background_job",
            "companion_night_event",
            "companion_proactive_budget",
            "companion_attention_budget",
        ] {
            assert!(is_runtime_table(ledger), "{ledger} not derived");
        }
        assert!(is_runtime_table("COMPANION_TURN"));
        assert!(is_runtime_table("companion_fts_data"), "fts shadow table");
        assert!(!is_runtime_table("agent_notes"));
        assert!(!is_runtime_table("companion_turnover"));
    }

    #[test]
    fn every_hostile_statement_is_refused_and_the_record_survives() {
        let failed: Vec<usize> = (1..=10)
            .filter(|&c| !target_refused(Policy::Full, c))
            .collect();
        assert!(failed.is_empty(), "targets not refused: {failed:?}");
    }

    #[test]
    fn the_agents_own_tables_take_every_verb() {
        assert_eq!(agent_table_writable(Policy::Full), 5);
    }

    #[test]
    fn the_record_stays_readable() {
        assert!(record_readable(Policy::Full));
    }

    #[test]
    fn the_guard_does_not_outlive_the_call() {
        assert!(runtime_write_after_refusal(Policy::Full));
    }

    #[test]
    fn the_refusal_names_the_table_and_the_way_forward() {
        let conn = user_conn();
        let err = run_agent_mutation(&conn, "UPDATE companion_turn SET is_error = 0")
            .expect_err("refused");
        let msg = err.to_string();
        assert!(msg.contains("companion_turn"), "{msg}");
        assert!(msg.contains("execute_select"), "{msg}");
    }

    /// The A/B instrument: one row per arm, same assertions. Run with
    /// `-- --ignored --nocapture arm_table`.
    #[test]
    #[ignore]
    fn arm_table() {
        for (name, policy) in [
            ("A  (off)", Policy::Off),
            ("B1 (structure)", Policy::StructureOnly),
            ("B2 (full)", Policy::Full),
        ] {
            let per_case: Vec<bool> = (1..=10).map(|c| target_refused(policy, c)).collect();
            let target = per_case.iter().filter(|b| **b).count();
            println!(
                "ARM {name}: target {target}/10 {:?} | F1 {}/5 | F2 {} | F3 {}",
                per_case
                    .iter()
                    .enumerate()
                    .map(|(i, b)| format!("T{}={}", i + 1, if *b { "R" } else { "-" }))
                    .collect::<Vec<_>>(),
                agent_table_writable(policy),
                record_readable(policy),
                runtime_write_after_refusal(policy),
            );
        }
    }
}
