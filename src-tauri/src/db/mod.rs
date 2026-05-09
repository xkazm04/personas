#[macro_use]
pub mod macros;
mod builtin_connectors;
pub mod cdc;
#[allow(dead_code)] // Functions used by Tauri commands in Phase 3
pub mod migrations;
#[allow(dead_code)]
pub mod models;
pub mod perf;
pub mod query_builder;
#[allow(dead_code)]
pub mod repos;
pub mod settings_keys;

use r2d2::{CustomizeConnection, Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::error::AppError;

pub type DbPool = Pool<SqliteConnectionManager>;

/// Connection timeout for pool acquisitions. Past this, `pool.get()` fails
/// with a `r2d2::Error` instead of blocking the IPC worker indefinitely —
/// the user gets a recoverable error rather than a frozen UI.
const POOL_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(5);

/// Threshold above which a successful `acquire_logged` call emits a warning.
/// Tuned to catch the "vector_kb search holding a connection while concurrent
/// IPC reads pile up" scenario without spamming on the occasional WAL
/// checkpoint stall.
#[allow(dead_code)]
const POOL_STARVATION_WARN_MS: u128 = 250;

/// Acquire a pooled connection with wait-time instrumentation. Logs a warning
/// when the acquire takes longer than [`POOL_STARVATION_WARN_MS`] so we can
/// see pool starvation in production logs. `label` identifies the caller in
/// the warning event (e.g. `"vector_search"`, `"settings_load"`).
///
/// Functionally identical to `pool.get()`; safe to swap in at hot paths
/// without other changes. Cold paths can keep using `pool.get()` directly.
/// `dead_code` allow handles default-feature builds where the only caller
/// (vector_store) is gated behind `cfg(feature = "ml")`.
#[allow(dead_code)]
pub fn acquire_logged(
    pool: &DbPool,
    label: &'static str,
) -> Result<PooledConnection<SqliteConnectionManager>, r2d2::Error> {
    let started = Instant::now();
    let result = pool.get();
    let waited_ms = started.elapsed().as_millis();
    match &result {
        Ok(_) if waited_ms > POOL_STARVATION_WARN_MS => {
            tracing::warn!(
                label,
                waited_ms = waited_ms as u64,
                idle = pool.state().idle_connections,
                total = pool.state().connections,
                "DB pool acquire was slow — possible pool starvation"
            );
        }
        Err(e) => {
            tracing::error!(
                label,
                waited_ms = waited_ms as u64,
                error = %e,
                "DB pool acquire failed (likely timeout)"
            );
        }
        _ => {}
    }
    result
}

/// Cached filesystem path of the primary `personas.db` file, set once by
/// [`init_db`]. Engine subprocesses (MCP sidecar, test automation) read this
/// via [`primary_db_path`] when they need to point a child process at the
/// same SQLite file without re-deriving `app_data_dir`.
static PRIMARY_DB_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Return the path to `personas.db` if [`init_db`] has run, else `None`.
pub fn primary_db_path() -> Option<PathBuf> {
    PRIMARY_DB_PATH.get().cloned()
}

/// Separate connection pool for the user-facing database (`personas_data.db`).
/// This is completely isolated from the internal app database to prevent
/// user queries from corrupting app state.
pub type UserDbPool = Pool<SqliteConnectionManager>;

/// RAII guard that disables foreign-key checks on creation and **always** re-enables
/// them when dropped — even if the caller returns early or panics.  This prevents a
/// pooled connection from leaking back into the pool with FK checks turned off.
///
/// # Usage
/// ```ignore
/// let conn = pool.get()?;
/// let result = {
///     let _guard = FkDisabledGuard::new(&conn)?;
///     conn.execute("INSERT …", params![…])
/// };
/// // FK checks are restored here, before `result?` propagates any error
/// result?;
/// ```
pub struct FkDisabledGuard<'a> {
    conn: &'a rusqlite::Connection,
}

impl<'a> FkDisabledGuard<'a> {
    /// Disable foreign-key checks on `conn` and return a guard that will
    /// re-enable them on drop.
    pub fn new(conn: &'a rusqlite::Connection) -> Result<Self, rusqlite::Error> {
        conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
        Ok(Self { conn })
    }
}

impl<'a> Drop for FkDisabledGuard<'a> {
    fn drop(&mut self) {
        if let Err(e) = self.conn.execute_batch("PRAGMA foreign_keys = ON;") {
            tracing::error!("Failed to restore foreign_keys = ON: {e}");
        }
    }
}

/// Connection customizer that sets per-connection SQLite pragmas.
#[derive(Debug)]
struct SqlitePragmaCustomizer;

impl CustomizeConnection<rusqlite::Connection, rusqlite::Error> for SqlitePragmaCustomizer {
    fn on_acquire(&self, conn: &mut rusqlite::Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA page_size = 4096;
             PRAGMA synchronous = NORMAL;
             PRAGMA mmap_size = 268435456;
             PRAGMA temp_store = 2;
             PRAGMA analysis_limit = 1000;
             PRAGMA cache_size = -2000;",
        )?;
        Ok(())
    }
}

pub fn spawn_idle_maintenance_task(primary_pool: DbPool, user_pool: UserDbPool) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        loop {
            if crate::ipc_auth::ipc_in_flight() == 0 {
                for (name, pool) in [
                    ("personas.db", &primary_pool),
                    ("personas_data.db", &user_pool),
                ] {
                    if let Ok(conn) = pool.get() {
                        match conn.execute_batch(
                            "PRAGMA optimize;
                             PRAGMA wal_checkpoint(TRUNCATE);",
                        ) {
                            Ok(_) => {
                                tracing::debug!(db = name, "SQLite idle maintenance completed")
                            }
                            Err(e) => tracing::warn!(
                                db = name,
                                error = %e,
                                "SQLite idle maintenance failed"
                            ),
                        }
                    }
                }
            } else {
                tracing::debug!(
                    in_flight = crate::ipc_auth::ipc_in_flight(),
                    "SQLite idle maintenance deferred while IPC is active"
                );
            }
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        }
    });
}

/// Initialize the database: create file, enable WAL + foreign keys, run migrations, seed data.
///
/// When `cdc_sender` is provided, every pooled connection will have a
/// `rusqlite::update_hook` registered that pushes change events through the
/// channel.  Pass `None` to disable CDC (e.g. in tests).
pub fn init_db(
    app_data_dir: &PathBuf,
    cdc_sender: Option<cdc::CdcSender>,
) -> Result<DbPool, AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    restrict_dir_permissions(app_data_dir);
    let db_path = app_data_dir.join("personas.db");
    let _ = PRIMARY_DB_PATH.set(db_path.clone());

    tracing::info!(path = %db_path.display(), "Initializing database");

    let manager = SqliteConnectionManager::file(&db_path);
    let customizer: Box<dyn CustomizeConnection<rusqlite::Connection, rusqlite::Error>> =
        match cdc_sender {
            Some(sender) => Box::new(cdc::CdcCustomizer::new(sender)),
            None => Box::new(SqlitePragmaCustomizer),
        };
    // Pool sized for concurrent IPC: settings + executions list + healing +
    // vector search (each can hold a connection for hundreds of ms). At
    // max_size(4) one vector_kb search would serialize every other read
    // behind it; bump to 12 so realistic concurrent IPC doesn't starve.
    // connection_timeout converts hangs into recoverable errors so the
    // IPC worker fails fast instead of locking the UI.
    let pool = Pool::builder()
        .max_size(12)
        .connection_timeout(POOL_ACQUIRE_TIMEOUT)
        .connection_customizer(customizer)
        .build(manager)?;

    // Set WAL journal mode (database-wide, only needs to run once)
    {
        let conn = pool.get()?;
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        tracing::debug!("SQLite pragmas configured (WAL, FK, busy_timeout)");
    }

    // Restrict file permissions on the database and WAL/SHM journal files
    restrict_db_file_permissions(&db_path);

    // Run migrations
    {
        let conn = pool.get()?;
        migrations::run(&conn)?;
        migrations::run_incremental(&conn)?;
    }

    {
        let conn = pool.get()?;
        ensure_executions_fts(&conn)?;
    }

    // Seed builtin data
    {
        let conn = pool.get()?;
        seed_builtin_tools(&conn)?;
        seed_builtin_connectors(&conn)?;
    }

    // Defense-in-depth: scrub orphan rows whose parent persona is gone.
    //
    // The personas table has `ON DELETE CASCADE` declared on `build_sessions`,
    // `persona_tools`, `persona_triggers`, etc. The pool's connection
    // customizer sets `PRAGMA foreign_keys = ON` on every acquire, so the
    // cascade SHOULD fire for any delete that goes through the pool. We've
    // still observed orphans accumulate in real installs — likely from runs
    // that errored mid-flight before reaching `delete_persona`, or from
    // code paths that bypassed the repo. A one-shot sweep on init cleans
    // up the pre-existing accumulation and guards against future drift.
    //
    // No-ops on a clean install (zero orphans → zero rows deleted).
    {
        let conn = pool.get()?;
        cleanup_orphan_rows(&conn);
    }

    tracing::info!("Database initialized successfully");
    Ok(pool)
}

fn ensure_executions_fts(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let execution_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM persona_executions", [], |r| r.get(0))
        .unwrap_or(0);
    let fts_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM executions_fts", [], |r| r.get(0))
        .unwrap_or(0);
    if execution_count > 0 && fts_count < execution_count {
        tracing::info!(
            executions = execution_count,
            fts_rows = fts_count,
            "Backfilling executions_fts"
        );
        conn.execute_batch("INSERT INTO executions_fts(executions_fts) VALUES('rebuild');")?;
    }
    Ok(())
}

/// Scrub rows whose parent persona no longer exists. Runs once on init
/// after migrations + seeds. Best-effort: a failure is logged but does not
/// block startup. Tables covered are the ones with `ON DELETE CASCADE`
/// declared on `personas.id` — see `db/migrations/schema.rs` and
/// `incremental.rs` for the full FK list.
fn cleanup_orphan_rows(conn: &rusqlite::Connection) {
    const ORPHAN_TABLES: &[&str] = &[
        "build_sessions",
        "persona_tools",
        "persona_triggers",
        "persona_event_subscriptions",
        "persona_executions",
        "persona_memories",
        "persona_messages",
        "persona_healing_issues",
        "persona_manual_reviews",
        "persona_metrics_snapshots",
        "persona_test_runs",
        "persona_versions",
    ];
    let mut total: i64 = 0;
    for table in ORPHAN_TABLES {
        let sql = format!(
            "DELETE FROM {table} WHERE persona_id IS NOT NULL \
             AND persona_id NOT IN (SELECT id FROM personas)"
        );
        match conn.execute(&sql, []) {
            Ok(rows) if rows > 0 => {
                tracing::info!(table, rows_deleted = rows, "Scrubbed orphan rows");
                total += rows as i64;
            }
            Ok(_) => {} // clean — no log spam
            Err(e) => {
                // Non-fatal — table may not exist yet on a fresh install
                // (rare; the migrations above should have created them all)
                // or the column name may differ. Log and skip.
                tracing::debug!(table, error = %e, "Orphan sweep skipped table");
            }
        }
    }
    if total > 0 {
        tracing::info!(
            total_orphans_deleted = total,
            "Startup orphan cleanup complete"
        );
    }
}

/// Initialize the user-facing database: a separate SQLite file (`personas_data.db`)
/// that agents and users can freely read/write without risk to the internal app database.
pub fn init_user_db(app_data_dir: &Path) -> Result<UserDbPool, AppError> {
    let db_path = app_data_dir.join("personas_data.db");

    tracing::info!(path = %db_path.display(), "Initializing user data database");

    // Register sqlite-vec as an auto-extension BEFORE the pool exists.
    // Pools opened before registration hold connections that lack vec0
    // (auto-extensions only apply to NEW connections). This bites the
    // companion's first-boot ingest because its small pool's connections
    // are all opened during migrations below — pre-registration would
    // mean "no such module: vec0" from any vec query on those connections.
    #[cfg(feature = "ml")]
    crate::engine::vector_store::ensure_vec_registered_pub();

    let manager = SqliteConnectionManager::file(&db_path);
    // User DB hosts the vector knowledge base; a single search holds a
    // connection for hundreds of ms. max_size(2) meant a search + any
    // companion brain read/write blocked each other. Bump to 8.
    let pool = Pool::builder()
        .max_size(8)
        .connection_timeout(POOL_ACQUIRE_TIMEOUT)
        .connection_customizer(Box::new(SqlitePragmaCustomizer))
        .build(manager)?;

    // Set WAL journal mode
    {
        let conn = pool.get()?;
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    }

    restrict_db_file_permissions(&db_path);

    // Run knowledge base schema migrations in the user database
    {
        let conn = pool.get()?;
        conn.execute_batch(KNOWLEDGE_BASE_SCHEMA)?;
        tracing::debug!("Knowledge base schema ensured in user database");
    }

    // Companion (Athena) schema — per-user brain index + runtime state.
    {
        let conn = pool.get()?;
        conn.execute_batch(COMPANION_SCHEMA)?;
        tracing::debug!("Companion schema ensured in user database");
    }

    // One-time backfill of kb_chunks_fts for installs that already have chunks
    // from before the FTS5 index existed. The triggers keep them in sync after
    // this. Skipped on fresh installs (chunk_count == 0) and idempotent (only
    // rebuilds when the FTS row count is short of kb_chunks).
    {
        let conn = pool.get()?;
        let chunk_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM kb_chunks", [], |r| r.get(0))
            .unwrap_or(0);
        let fts_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM kb_chunks_fts", [], |r| r.get(0))
            .unwrap_or(0);
        if chunk_count > 0 && fts_count < chunk_count {
            tracing::info!(
                chunks = chunk_count,
                fts_rows = fts_count,
                "Backfilling kb_chunks_fts (one-time)"
            );
            conn.execute_batch("INSERT INTO kb_chunks_fts(kb_chunks_fts) VALUES('rebuild');")?;
            tracing::info!("kb_chunks_fts backfill complete");
        }
    }

    tracing::info!("User data database initialized successfully");
    Ok(pool)
}

/// Schema for vector knowledge base tables (lives in the user database).
const KNOWLEDGE_BASE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS knowledge_bases (
    id              TEXT PRIMARY KEY,
    credential_id   TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    embedding_model TEXT NOT NULL DEFAULT 'AllMiniLML6V2Q',
    embedding_dims  INTEGER NOT NULL DEFAULT 384,
    chunk_size      INTEGER NOT NULL DEFAULT 512,
    chunk_overlap   INTEGER NOT NULL DEFAULT 50,
    document_count  INTEGER NOT NULL DEFAULT 0,
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'ready',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kb_documents (
    id              TEXT PRIMARY KEY,
    kb_id           TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    source_type     TEXT NOT NULL,
    source_path     TEXT,
    title           TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    byte_size       INTEGER NOT NULL DEFAULT 0,
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    metadata_json   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    indexed_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_documents_kb ON kb_documents(kb_id);
CREATE INDEX IF NOT EXISTS idx_kb_documents_hash ON kb_documents(content_hash);

CREATE TABLE IF NOT EXISTS kb_chunks (
    id              TEXT PRIMARY KEY,
    kb_id           TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id     TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    token_count     INTEGER NOT NULL DEFAULT 0,
    metadata_json   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb ON kb_chunks(kb_id);

-- FTS5 keyword index over chunk content. External-content mode references
-- kb_chunks(content) by rowid so chunk text is not duplicated. Used by the
-- BM25 re-ranker in kb_search; vector ranking remains the canonical score.
CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
    content,
    content='kb_chunks',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS kb_chunks_fts_ai AFTER INSERT ON kb_chunks BEGIN
    INSERT INTO kb_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunks_fts_ad AFTER DELETE ON kb_chunks BEGIN
    INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunks_fts_au AFTER UPDATE ON kb_chunks BEGIN
    INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO kb_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
"#;

/// Schema for the Companion (Athena) plugin. Lives in the user database
/// alongside knowledge bases — companion data is per-user and includes
/// conversation history, brain index, approvals, and the persistent
/// claude_session_id pointer.
///
/// Source of truth for memory is markdown on disk at
/// `~/.personas/companion-brain/`. These tables are an index/cache plus
/// runtime state; recoverable from disk if they ever drift.
///
/// The 384-dim vec0 virtual table (companion_embedding) is created at
/// runtime by the companion module after sqlite-vec registration, mirroring
/// how knowledge bases provision their per-KB vec0 tables.
const COMPANION_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS companion_node (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    importance      INTEGER NOT NULL DEFAULT 3,
    embedding_model TEXT,
    embedding_dims  INTEGER,
    body_excerpt    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_node_kind ON companion_node(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_companion_node_importance ON companion_node(importance DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS companion_edge (
    source_id  TEXT NOT NULL,
    target_id  TEXT NOT NULL,
    rel        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source_id, target_id, rel)
);
CREATE INDEX IF NOT EXISTS idx_companion_edge_target ON companion_edge(target_id, rel);

CREATE TABLE IF NOT EXISTS companion_provenance (
    fact_id    TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    PRIMARY KEY (fact_id, episode_id)
);
CREATE INDEX IF NOT EXISTS idx_companion_provenance_episode ON companion_provenance(episode_id);

-- Semantic-fact sidecar. The fact's display body and full provenance
-- live in the corresponding `companion_node` row (kind='fact') and the
-- markdown file under `semantic/<scope>/`. This sidecar holds the typed
-- metadata that's awkward to encode in markdown frontmatter and that we
-- want to query/sort on (importance decay, scope grouping, supersedes).
--
-- Provenance enforcement (≥1 source per fact) is upheld at the
-- application layer in `semantic::write_fact` — the schema doesn't try
-- to FK into companion_node because facts can outlive deleted episodes
-- (the markdown source still records who-said-what).
CREATE TABLE IF NOT EXISTS companion_fact (
    id              TEXT PRIMARY KEY,
    scope           TEXT NOT NULL,            -- 'user' | 'project' | 'world'
    fact_key        TEXT NOT NULL,            -- short slug, e.g. "preferred_editor"
    confidence      REAL NOT NULL DEFAULT 0.8,-- 0..1
    supersedes_id   TEXT,                      -- prior fact this replaces
    contradicts_id  TEXT,                      -- fact this contradicts (if any)
    last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_decayed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_fact_scope ON companion_fact(scope, fact_key);
CREATE INDEX IF NOT EXISTS idx_companion_fact_super ON companion_fact(supersedes_id);

CREATE VIRTUAL TABLE IF NOT EXISTS companion_fts USING fts5(node_id UNINDEXED, body, tags);

CREATE TABLE IF NOT EXISTS companion_approval (
    id               TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL,
    kind             TEXT NOT NULL,
    payload          TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
    human_review_id  TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_approval_status ON companion_approval(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_companion_approval_session ON companion_approval(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS companion_dev_feedback (
    id                    TEXT PRIMARY KEY,
    parent_session_id     TEXT NOT NULL,
    dev_session_id        TEXT,
    triggering_message_id TEXT,
    feedback_text         TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'queued',
    diff_path             TEXT,
    pr_url                TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_dev_feedback_status ON companion_dev_feedback(status, created_at DESC);

CREATE TABLE IF NOT EXISTS companion_session (
    id                   TEXT PRIMARY KEY,
    claude_session_id    TEXT,
    constitution_version INTEGER NOT NULL DEFAULT 1,
    last_active_at       TEXT NOT NULL DEFAULT (datetime('now')),
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Consolidation runs: one row per "review my recent conversations and
-- propose semantic-fact updates" pass. The actual proposals are children
-- in companion_consolidation_item — each one is a single fact diff the
-- user reviews independently. We persist rather than streaming because
-- the user often wants to come back to a half-reviewed batch later.
CREATE TABLE IF NOT EXISTS companion_consolidation (
    id              TEXT PRIMARY KEY,
    triggered_at    TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT,
    status          TEXT NOT NULL DEFAULT 'running',  -- running | review | applied | failed
    episodes_count  INTEGER NOT NULL DEFAULT 0,
    summary         TEXT,
    error_text      TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_consolidation_status
    ON companion_consolidation(status, triggered_at DESC);

CREATE TABLE IF NOT EXISTS companion_consolidation_item (
    id                TEXT PRIMARY KEY,
    consolidation_id  TEXT NOT NULL,
    kind              TEXT NOT NULL,               -- 'add' | 'update' | 'contradict'
    scope             TEXT NOT NULL,
    fact_key          TEXT NOT NULL,
    proposed_value    TEXT NOT NULL,
    sources_json      TEXT NOT NULL,               -- JSON array of episode IDs
    importance        INTEGER NOT NULL DEFAULT 3,
    confidence        REAL NOT NULL DEFAULT 0.7,
    supersedes_id     TEXT,                         -- existing fact this replaces (for 'update'/'contradict')
    rationale         TEXT,
    status            TEXT NOT NULL DEFAULT 'pending', -- pending | applied | rejected
    fact_id           TEXT,                         -- populated after apply
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_consolidation_item_run
    ON companion_consolidation_item(consolidation_id, status);

-- Phase D: procedural rules — durable how-to behaviors Athena follows
-- ("when X, do Y"). Same provenance contract as facts: every rule cites
-- ≥1 source episode where the behavior was confirmed/discussed. Body
-- markdown lives under `procedurals/<scope>/<id>.md`.
CREATE TABLE IF NOT EXISTS companion_procedural (
    id              TEXT PRIMARY KEY,
    scope           TEXT NOT NULL,            -- 'chat' | 'action' | 'memory' | 'build'
    trigger_pattern TEXT NOT NULL,            -- short summary of the situation
    confidence      REAL NOT NULL DEFAULT 0.8,
    supersedes_id   TEXT,
    last_used_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_decayed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_procedural_scope ON companion_procedural(scope);
CREATE INDEX IF NOT EXISTS idx_companion_procedural_super ON companion_procedural(supersedes_id);

-- Phase D: goals — user-stated objectives with status. No provenance
-- requirement (the user *is* the source). Body markdown holds the goal
-- description + any sub-bullets the user added.
CREATE TABLE IF NOT EXISTS companion_goal (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active', -- active | paused | completed | abandoned
    priority      INTEGER NOT NULL DEFAULT 3,     -- 1..5
    target_date   TEXT,                            -- ISO8601 or null
    sources_json  TEXT NOT NULL DEFAULT '[]',     -- supportive episodes (optional)
    completed_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_goal_status ON companion_goal(status, priority DESC);

-- Phase D: rituals — recurring patterns Athena should respect (quiet
-- hours, weekly review, sprint cadence). `schedule_json` is a small
-- DSL the proactive engine reads (Phase E). Not surfaced in retrieval —
-- they're behavioral guardrails, not memory.
CREATE TABLE IF NOT EXISTS companion_ritual (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,                  -- 'quiet_hours' | 'cadence' | 'focus_window'
    description   TEXT NOT NULL,
    schedule_json TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,     -- 0/1
    sources_json  TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_ritual_active ON companion_ritual(active, kind);

-- Phase D: backlog — Athena's self-promises and capability gaps. When
-- she says "I'll check on the deploy after lunch" or "I can't do X yet
-- but I could propose it", a row lands here. The user (or Athena's own
-- next turn) resolves them. Append-only: `dropped` is a state, not a
-- delete.
CREATE TABLE IF NOT EXISTS companion_backlog_item (
    id                TEXT PRIMARY KEY,
    summary           TEXT NOT NULL,
    kind              TEXT NOT NULL,             -- 'self_promise' | 'capability_gap'
    status            TEXT NOT NULL DEFAULT 'pending', -- pending | done | dropped
    source_episode_id TEXT,                       -- where she committed to it
    reminded_count    INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_backlog_status ON companion_backlog_item(status, created_at DESC);

-- Phase E: proactive messages — nudges Athena drafted on her own initiative.
-- Status flow: queued → delivered (pushed to UI) → engaged (user replied)
-- | dismissed (user said no) | expired (sat too long).
CREATE TABLE IF NOT EXISTS companion_proactive_message (
    id            TEXT PRIMARY KEY,
    trigger_kind  TEXT NOT NULL,                 -- 'goal_target_approaching' | 'backlog_aging' | 'cadence_due'
    trigger_ref   TEXT,                           -- id of the goal/backlog/ritual that fired
    message       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at  TEXT,
    resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_proactive_status
    ON companion_proactive_message(status, created_at DESC);
-- Per-trigger dedupe: don't fire the same trigger for the same target
-- multiple times in a row. The query checks for an unresolved message
-- with matching (trigger_kind, trigger_ref) before inserting.
CREATE INDEX IF NOT EXISTS idx_companion_proactive_dedupe
    ON companion_proactive_message(trigger_kind, trigger_ref, status);

-- Daily budget for proactive nudges. The scheduler increments on each
-- delivery; a fresh row is created on the first nudge of any UTC date.
CREATE TABLE IF NOT EXISTS companion_proactive_budget (
    date    TEXT PRIMARY KEY,                    -- 'YYYY-MM-DD' UTC
    count   INTEGER NOT NULL DEFAULT 0
);

-- Phase F: connectors the user has attached to Athena's chat surface.
-- `connector_name` is the canonical service-type id (matches
-- `vault_credential.service_type` and the connector definitions). When
-- `enabled` is 1, the prompt builder appends an "Available connectors"
-- block to every turn so Athena is aware. When 0, the connector is
-- still pinned in the sidebar (greyed out) but invisible to Athena —
-- this models the user's "toggle off, keep around" workflow.
CREATE TABLE IF NOT EXISTS companion_active_connector (
    connector_name TEXT PRIMARY KEY,
    enabled        INTEGER NOT NULL DEFAULT 1,    -- 0/1
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase F: companion plugin toggles. Each row = one plugin Athena
-- can be made aware of. Rows with `enabled=1` get a contextual block
-- appended to the system prompt teaching her what's available. v1
-- ships `dev_tools` (codebase scan / idea generation / task batching
-- / projects state). Future plugins land as additional rows without
-- a schema change.
CREATE TABLE IF NOT EXISTS companion_plugin_toggle (
    plugin_name  TEXT PRIMARY KEY,                -- 'dev_tools' | future plugins
    enabled      INTEGER NOT NULL DEFAULT 0,      -- 0/1, default off
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase G: project registry — repos/projects Athena's Dev Tools knows
-- about. Seeded on first init with the Personas repo so "list projects"
-- and "scan project" have something concrete to operate on. Users can
-- register more via `register_project`.
CREATE TABLE IF NOT EXISTS companion_known_project (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    path                TEXT NOT NULL UNIQUE,
    description         TEXT,
    last_scan_at        TEXT,
    last_scan_summary   TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase G: background jobs — long-running ops Athena can enqueue and
-- have run while she keeps chatting. Status: queued → running →
-- completed | failed. A worker tokio task picks queued rows,
-- dispatches to per-kind handlers, and on completion appends a system
-- episode to the chat so Athena sees the result on her next turn.
CREATE TABLE IF NOT EXISTS companion_background_job (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued',
    params_json   TEXT NOT NULL DEFAULT '{}',
    result_text   TEXT,
    error_text    TEXT,
    project_id    TEXT,                              -- nullable: links scan jobs to known_project
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    started_at    TEXT,
    completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_background_job_status
    ON companion_background_job(status, created_at);
CREATE INDEX IF NOT EXISTS idx_companion_job_status_created
    ON companion_background_job(status, created_at);
"#;

/// Seed all built-in local credentials if they don't already exist.
/// This ensures the three local services (database, vector KB, messaging)
/// appear in the credential manager immediately on first app launch.
pub fn seed_builtin_credentials(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();

    let builtins: &[(&str, &str, &str, &str)] = &[
        (
            "builtin-personas-database",
            "Local Database",
            "personas_database",
            r#"{"is_builtin":true,"description":"Local SQLite database managed by Personas. Safe for agent read/write operations."}"#,
        ),
        (
            "builtin-personas-vector-db",
            "Local Vector DB",
            "personas_vector_db",
            r#"{"is_builtin":true,"description":"Local vector knowledge base powered by sqlite-vec. Entirely offline, no API keys needed."}"#,
        ),
        (
            "builtin-personas-messaging",
            "Local Messaging",
            "personas_messages",
            r#"{"is_builtin":true,"description":"Built-in in-app messaging channel. Agents can send notifications and messages without external services."}"#,
        ),
        (
            "builtin-personas-drive",
            "Local Drive",
            "local_drive",
            r#"{"is_builtin":true,"always_active":true,"description":"Managed local filesystem for agent exports. Drive root is resolved at runtime and browsable via the Drive plugin — no credentials required."}"#,
        ),
    ];

    for (id, name, service_type, metadata) in builtins {
        let exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM persona_credentials WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        if exists {
            // Rename legacy "Built-in Database" → "Local Database"
            if *id == "builtin-personas-database" {
                conn.execute(
                    "UPDATE persona_credentials SET name = ?1 WHERE id = ?2 AND name = 'Built-in Database'",
                    params![name, id],
                )?;
            }
            continue;
        }

        conn.execute(
            "INSERT INTO persona_credentials
             (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, name, service_type, "{}", "", metadata, now],
        )?;

        tracing::info!("Seeded built-in credential: {name}");
    }

    Ok(())
}

/// Set owner-only permissions on the database file and its WAL/SHM journal files.
///
/// On Unix: chmod 0600 (owner read/write only).
/// On Windows: icacls to remove inherited permissions and grant owner-only access.
fn restrict_db_file_permissions(db_path: &Path) {
    let wal_path = db_path.with_extension("db-wal");
    let shm_path = db_path.with_extension("db-shm");

    for path in [db_path, wal_path.as_path(), shm_path.as_path()] {
        if path.exists() {
            restrict_file_permissions_impl(path);
        }
    }
}

/// Set owner-only permissions on the app data directory itself.
///
/// On Unix: chmod 0700 (owner rwx only).
/// On Windows: icacls to remove inherited permissions and grant owner-only access.
fn restrict_dir_permissions(dir_path: &Path) {
    restrict_dir_permissions_impl(dir_path);
}

#[cfg(unix)]
fn restrict_file_permissions_impl(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o600);
    if let Err(e) = std::fs::set_permissions(path, perms) {
        tracing::warn!(path = %path.display(), error = %e, "Failed to set restrictive file permissions");
    } else {
        tracing::debug!(path = %path.display(), "Set file permissions to 0600");
    }
}

#[cfg(unix)]
fn restrict_dir_permissions_impl(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o700);
    if let Err(e) = std::fs::set_permissions(path, perms) {
        tracing::warn!(path = %path.display(), error = %e, "Failed to set restrictive directory permissions");
    } else {
        tracing::debug!(path = %path.display(), "Set directory permissions to 0700");
    }
}

#[cfg(windows)]
fn restrict_file_permissions_impl(path: &Path) {
    restrict_windows_permissions(path);
}

#[cfg(windows)]
fn restrict_dir_permissions_impl(path: &Path) {
    restrict_windows_permissions(path);
}

/// On Windows, use icacls to:
/// 1. Disable permission inheritance (replacing with explicit entries).
/// 2. Remove all existing access entries.
/// 3. Grant the current user full control.
#[cfg(windows)]
fn restrict_windows_permissions(path: &Path) {
    let path_str = path.to_string_lossy();
    let username = whoami::username();

    // Grant owner full control BEFORE removing inheritance to ensure
    // the user retains access. If we remove inheritance first and the
    // grant step fails, the file becomes inaccessible.
    // Use (OI)(CI)(F) for directories so subdirectories (logs/, crash_logs/)
    // inherit the permission; plain (F) for files.
    let grant_arg = if path.is_dir() {
        format!("{}:(OI)(CI)(F)", username)
    } else {
        format!("{}:(F)", username)
    };
    let grant_result = std::process::Command::new("icacls")
        .args([path_str.as_ref(), "/grant", &grant_arg])
        .output();

    let grant_ok = match &grant_result {
        Ok(output) if output.status.success() => true,
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!(path = %path.display(), stderr = %stderr, "icacls /grant returned non-zero exit");
            false
        }
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "Failed to run icacls /grant");
            false
        }
    };

    if !grant_ok {
        tracing::warn!(path = %path.display(), "Skipping inheritance removal -- grant failed, removing inheritance would lock out the file");
        return;
    }

    // Now safe to disable inheritance and remove inherited ACEs
    let inheritance_result = std::process::Command::new("icacls")
        .args([path_str.as_ref(), "/inheritance:r"])
        .output();

    if let Err(e) = &inheritance_result {
        tracing::warn!(path = %path.display(), error = %e, "Failed to run icacls /inheritance:r");
        return;
    }

    tracing::debug!(path = %path.display(), "Set restrictive Windows permissions (owner-only)");
}

/// Seed the 7 builtin tool definitions.
fn seed_builtin_tools(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let tools = [
        (
            "builtin-http-request",
            "http_request",
            "network",
            "Make HTTP requests to external APIs",
            "builtin://http_request",
            None,
        ),
        (
            "builtin-gmail-read",
            "gmail_read",
            "email",
            "Read emails from Gmail",
            "builtin://gmail_read",
            Some("gmail"),
        ),
        (
            "builtin-gmail-send",
            "gmail_send",
            "email",
            "Send emails via Gmail",
            "builtin://gmail_send",
            Some("gmail"),
        ),
        (
            "builtin-gmail-search",
            "gmail_search",
            "email",
            "Search Gmail messages",
            "builtin://gmail_search",
            Some("gmail"),
        ),
        (
            "builtin-gmail-mark-read",
            "gmail_mark_read",
            "email",
            "Mark Gmail messages as read",
            "builtin://gmail_mark_read",
            Some("gmail"),
        ),
        (
            "builtin-file-read",
            "file_read",
            "filesystem",
            "Read file contents from disk",
            "builtin://file_read",
            None,
        ),
        (
            "builtin-file-write",
            "file_write",
            "filesystem",
            "Write content to files on disk",
            "builtin://file_write",
            None,
        ),
    ];

    for (id, name, category, description, script_path, cred_type) in &tools {
        conn.execute(
            "INSERT OR IGNORE INTO persona_tool_definitions
             (id, name, category, description, script_path, requires_credential_type, is_builtin, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            params![id, name, category, description, script_path, cred_type, now],
        )?;
    }

    tracing::debug!("Builtin tool definitions seeded");
    Ok(())
}

/// Seed built-in connector templates that should be available to all users.
/// Definitions are auto-generated from `scripts/connectors/builtin/*.json`
/// into `db/builtin_connectors.rs`. Regenerate with:
///   node scripts/generate-connector-seed.mjs
fn seed_builtin_connectors(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();

    let connectors = builtin_connectors::BUILTIN_CONNECTORS;

    // === REMOVED: ~900 lines of hardcoded BuiltinConnector structs ===
    // The connector definitions previously lived inline here as a massive
    // &[BuiltinConnector] array literal.  They are now auto-generated into
    // db/builtin_connectors.rs from the JSON source-of-truth files in
    // scripts/connectors/builtin/*.json.
    //
    // To add/edit a connector: edit the JSON file, then run:
    //   node scripts/generate-connector-seed.mjs
    for c in connectors {
        conn.execute(
            "INSERT OR IGNORE INTO connector_definitions
             (id, name, label, icon_url, color, category, fields,
              healthcheck_config, services, events, metadata, resources, is_builtin,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?13)",
            params![
                c.id,
                c.name,
                c.label,
                c.icon_url,
                c.color,
                c.category,
                c.fields,
                c.healthcheck_config,
                c.services,
                c.events,
                c.metadata,
                c.resources,
                now
            ],
        )?;

        // Update existing rows to refresh fields/metadata/category/services/events/resources on app upgrade
        conn.execute(
            "UPDATE connector_definitions
             SET label = ?1, icon_url = ?2, fields = ?3, healthcheck_config = ?4, metadata = ?5, category = ?6, services = ?7, events = ?8, resources = ?9, updated_at = ?10
             WHERE name = ?11 AND is_builtin = 1",
            params![c.label, c.icon_url, c.fields, c.healthcheck_config, c.metadata, c.category, c.services, c.events, c.resources, now, c.name],
        )?;
    }

    tracing::debug!("Seeded {} builtin connector definitions", connectors.len());
    Ok(())
}

#[cfg(test)]
pub fn init_test_db() -> Result<DbPool, AppError> {
    use std::time::Duration;

    // Use a unique temp file for each test to avoid in-memory connection issues with r2d2.
    let tmp = std::env::temp_dir().join(format!("personas_test_{}.db", uuid::Uuid::new_v4()));
    let manager = SqliteConnectionManager::file(&tmp);
    let pool = Pool::builder()
        .max_size(2)
        .connection_timeout(Duration::from_secs(5))
        .connection_customizer(Box::new(SqlitePragmaCustomizer))
        .build(manager)?;

    let conn = pool.get()?;
    migrations::run(&conn)?;
    migrations::run_incremental(&conn)?;
    seed_builtin_tools(&conn)?;
    seed_builtin_connectors(&conn)?;
    drop(conn);
    Ok(pool)
}
