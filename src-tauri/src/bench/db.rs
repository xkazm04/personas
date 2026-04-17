//! Bench DB pool + embedded schema.
//!
//! Standalone sqlite file, intentionally decoupled from `personas.db`.
//! Schema evolves independently; no cross-DB foreign keys (persona_id
//! references are by string only, resolved at query time).

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

/// Schema version — bump when adding columns or tables. Consumed by
/// `ensure_schema()` to decide whether to re-run the schema script.
pub const SCHEMA_VERSION: i32 = 1;

/// Full bench schema. Idempotent — safe to run on every open.
///
/// Tables:
///   bench_runs         — one row per `/persona-bench` invocation
///   bench_executions   — one row per (persona × model) matrix cell
///   bench_scores       — one row per (bench_execution × rubric dimension)
///   bench_patterns     — analyst verdict per (run × persona)
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS bench_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bench_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    persona_ids TEXT NOT NULL,
    models TEXT NOT NULL,
    rubric_version TEXT NOT NULL DEFAULT 'v1',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS bench_executions (
    id TEXT PRIMARY KEY,
    bench_run_id TEXT NOT NULL REFERENCES bench_runs(id) ON DELETE CASCADE,
    persona_id TEXT NOT NULL,
    persona_name TEXT NOT NULL,
    seed_execution_id TEXT,
    seed_input_data TEXT,

    model_label TEXT NOT NULL,
    model_profile TEXT NOT NULL,

    source_execution_id TEXT,
    status TEXT NOT NULL,
    error_message TEXT,

    duration_ms INTEGER,
    cost_usd REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,

    final_output_text TEXT,
    output_messages_json TEXT,
    output_events_json TEXT,
    output_memories_json TEXT,
    output_reviews_json TEXT,
    output_tool_steps_json TEXT,

    started_at TEXT NOT NULL,
    completed_at TEXT,

    UNIQUE(bench_run_id, persona_id, model_label)
);

CREATE TABLE IF NOT EXISTS bench_scores (
    id TEXT PRIMARY KEY,
    bench_execution_id TEXT NOT NULL REFERENCES bench_executions(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,
    score REAL,
    is_na INTEGER NOT NULL DEFAULT 0,
    rationale TEXT NOT NULL,
    judge_model TEXT NOT NULL,
    judge_label TEXT NOT NULL,
    scored_at TEXT NOT NULL,

    UNIQUE(bench_execution_id, dimension)
);

CREATE TABLE IF NOT EXISTS bench_patterns (
    id TEXT PRIMARY KEY,
    bench_run_id TEXT NOT NULL REFERENCES bench_runs(id) ON DELETE CASCADE,
    persona_id TEXT NOT NULL,
    persona_name TEXT NOT NULL,

    opus_score REAL,
    sonnet_score REAL,
    haiku_score REAL,
    gemma_score REAL,

    viable_tier TEXT,
    degradation_tier TEXT,
    degradation_dimension TEXT,

    design_gap_flagged INTEGER NOT NULL DEFAULT 0,
    design_gap_notes TEXT,
    analyst_notes TEXT,
    created_at TEXT NOT NULL,

    UNIQUE(bench_run_id, persona_id)
);

CREATE INDEX IF NOT EXISTS idx_bench_executions_run
    ON bench_executions(bench_run_id);
CREATE INDEX IF NOT EXISTS idx_bench_executions_persona
    ON bench_executions(persona_id);
CREATE INDEX IF NOT EXISTS idx_bench_scores_exec
    ON bench_scores(bench_execution_id);
CREATE INDEX IF NOT EXISTS idx_bench_patterns_run
    ON bench_patterns(bench_run_id);
"#;

/// Valid rubric dimensions. Judge output is validated against this set.
pub const RUBRIC_DIMENSIONS: &[&str] = &[
    "coverage",         // weight 2.0
    "recommendations",  // weight 2.0
    "review_content",   // weight 1.5 (N/A if persona did not produce review output)
    "value",            // weight 1.5
    "coherence",        // weight 1.0
    "tone",             // weight 0.5
];

/// Valid model labels for the matrix. Extend cautiously — schema uses
/// string columns so it's additive, but report + analyst prompts assume
/// this exact set.
pub const MODEL_LABELS: &[&str] = &["opus", "sonnet", "haiku", "gemma"];

pub struct BenchDbPool {
    conn: Mutex<Connection>,
}

impl BenchDbPool {
    pub fn get(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|e| format!("Bench DB lock error: {e}"))
    }
}

/// Open (creating if missing) the bench DB at `path`.
///
/// Creates the parent directory if it doesn't exist. Enables WAL for
/// concurrent reads by the Claude Code skill while bench is running.
pub fn open_pool(path: &Path) -> Result<BenchDbPool, String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
    }

    let conn = Connection::open(path)
        .map_err(|e| format!("Failed to open bench DB at {}: {e}", path.display()))?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("Bench DB PRAGMA error: {e}"))?;

    ensure_schema(&conn)?;

    Ok(BenchDbPool {
        conn: Mutex::new(conn),
    })
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("Bench schema init failed: {e}"))?;

    conn.execute(
        "INSERT INTO bench_meta (key, value) VALUES ('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![SCHEMA_VERSION.to_string()],
    )
    .map_err(|e| format!("Bench meta write failed: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_pool_creates_schema_and_is_idempotent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let db_path = tmp.path().join("sub/dir/bench.db");

        // First open creates parent dirs, schema, meta row.
        let pool = open_pool(&db_path).expect("first open");
        {
            let conn = pool.get().expect("lock");
            let version: String = conn
                .query_row(
                    "SELECT value FROM bench_meta WHERE key = 'schema_version'",
                    [],
                    |row| row.get(0),
                )
                .expect("schema_version row");
            assert_eq!(version, SCHEMA_VERSION.to_string());

            let tables: Vec<String> = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .and_then(|mut stmt| {
                    stmt.query_map([], |row| row.get::<_, String>(0))
                        .map(|rows| rows.filter_map(|r| r.ok()).collect())
                })
                .expect("tables query");
            for expected in [
                "bench_executions",
                "bench_meta",
                "bench_patterns",
                "bench_runs",
                "bench_scores",
            ] {
                assert!(tables.contains(&expected.to_string()), "missing {expected}");
            }
        }

        // Second open on the same path must not error.
        drop(pool);
        let _pool2 = open_pool(&db_path).expect("second open idempotent");
    }

    #[test]
    fn unique_matrix_cell_is_enforced() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pool = open_pool(&tmp.path().join("bench.db")).expect("open");
        let conn = pool.get().expect("lock");

        conn.execute(
            "INSERT INTO bench_runs (id, started_at, status, persona_ids, models)
             VALUES ('run1', '2026-04-17T00:00:00Z', 'running', '[]', '[]')",
            [],
        )
        .expect("run insert");

        let insert = |id: &str| {
            conn.execute(
                "INSERT INTO bench_executions
                    (id, bench_run_id, persona_id, persona_name, model_label, model_profile,
                     status, started_at)
                 VALUES (?1, 'run1', 'p1', 'P One', 'opus', '{}', 'completed',
                         '2026-04-17T00:00:00Z')",
                rusqlite::params![id],
            )
        };
        insert("e1").expect("first cell ok");
        let err = insert("e2").expect_err("dup cell must fail");
        assert!(
            err.to_string().contains("UNIQUE"),
            "expected UNIQUE violation, got: {err}"
        );
    }
}
