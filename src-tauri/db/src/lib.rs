//! `personas-db` — the SQLite data layer: schema, migrations, repositories.
//!
//! Split out of `app_lib` in crate-split step 4e. `app_lib` was a single
//! 431k-LOC crate, which meant one rustc process and one memory ceiling
//! (8.9 GB on a test build, measured 2026-07-26). This crate takes ~84k LOC of
//! that out of the largest compilation unit.
//!
//! It depends on `personas-core` and nothing else of ours. Everything the data
//! layer used to reach upward for — audit promotion, channel parsing, event
//! names, the IPC in-flight gauge — was moved down or inverted in steps 4a-4d;
//! `db::cdc`'s two genuinely upward calls are injected as `CdcHooks`.
//!
//! `app_lib` re-exports this crate as `crate::db`, so the ~540 existing
//! `crate::db::…` paths across commands, engine and companion are unchanged.

// Lint posture for code that arrived here by `git mv`.
//
// This crate is 84k LOC lifted verbatim out of `app_lib` — only module paths
// were rewritten, no logic touched. Extracting it exposed the code to a clippy
// pass `app_lib` was never getting (its own `--all-targets -D warnings` run
// still reports 434 errors), so these fire on code that has been in the tree
// for months. Allowed rather than fixed because a code-motion commit must not
// change behaviour or public API. Do NOT extend this list for new code.
#![allow(clippy::doc_lazy_continuation)]
#![allow(clippy::doc_overindented_list_items)]
#![allow(clippy::drop_non_drop)]
#![allow(clippy::incompatible_msrv)]
#![allow(clippy::manual_range_contains)]
#![allow(clippy::new_without_default)]
#![allow(clippy::nonminimal_bool)]
#![allow(clippy::redundant_closure)]
#![allow(clippy::too_many_arguments)]
#![allow(clippy::type_complexity)]
#![allow(clippy::unnecessary_cast)]

// Re-exported so the `crud_*` / `row_mapper!` macros can name core types
// through `$crate::personas_core::…` and stay hygienic wherever they expand.
pub use personas_core;

#[macro_use]
pub mod macros;
pub mod attribution;
mod backup;
pub mod builtin_connectors;
pub(crate) mod builtin_shared_events;
pub mod cdc;
pub mod journal;
// Relocated from `engine/` in crate-split step 4c. Each of these six is
// data-layer code that happened to live in the engine directory: they depend
// only on `db`, `db::repos` and `personas-core`, while `db::repos` calls INTO
// them — an inversion that made the data layer impossible to extract. `engine`
// re-exports all six, so `crate::chain::…` etc. resolve unchanged.
pub mod audit_incidents_promoter;
pub mod byom;
pub mod chain;
pub mod credential_fields;
#[cfg(feature = "ml")]
pub mod embedder;
pub mod memory_recall;
#[allow(dead_code)] // Functions used by Tauri commands in Phase 3
pub mod migrations;
pub mod model_routing;
pub mod policy_tuning;
pub mod project_identity;
pub mod project_team;
pub mod quality_gate;
#[cfg(feature = "ml")]
pub mod vector_store;
// Moved to `personas-core` (crate-split step 3): 14k LOC of pure data structs
// that `engine::types` / `validation` also need. Re-exported so every
// `crate::models::…` path resolves unchanged.
pub use personas_core::models;
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

use personas_core::error::AppError;

// Defined in `personas-core` (`core/src/pool.rs`) — `crypto`'s credential
// migrations take a `&DbPool` and sit below this module. Pool construction and
// instrumentation stay here.
pub use personas_core::pool::DbPool;

/// Connection timeout for pool acquisitions. Past this, `pool.get()` fails
/// with a `r2d2::Error` instead of blocking the IPC worker indefinitely —
/// the user gets a recoverable error rather than a frozen UI.
const POOL_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(5);

/// Threshold above which a successful `acquire_logged` call emits a warning.
/// Tuned to catch the "vector_kb search holding a connection while concurrent
/// IPC reads pile up" scenario without spamming on the occasional WAL
/// checkpoint stall.
const POOL_STARVATION_WARN_MS: u128 = 250;

/// Acquire a pooled connection with wait-time instrumentation. Logs a warning
/// when the acquire takes longer than [`POOL_STARVATION_WARN_MS`] so we can
/// see pool starvation in production logs. `label` identifies the caller in
/// the warning event (e.g. `"vector_search"`, `"settings_load"`).
///
/// Functionally identical to `pool.get()`; safe to swap in at hot paths
/// without other changes. Cold paths can keep using `pool.get()` directly.
///
/// Prefer the [`PoolExt::conn`] extension method at call sites — it is the
/// same function with a shorter spelling, which is what makes adopting it a
/// one-token change rather than a wrapping rewrite.
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

/// Extension trait that puts [`acquire_logged`] one token away from a bare
/// `pool.get()`.
///
/// `acquire_logged` has existed since the pool was built and had exactly one
/// caller — behind `cfg(feature = "ml")`, so dead in a default build — while
/// ~1,350 sites called `pool.get()` directly. The instrumentation was not
/// rejected; it was never reachable cheaply. `pool.conn("label")?` is the same
/// edit distance as `pool.get()?`, so adoption costs a call site nothing.
///
/// The `label` is the whole point and must name the caller (`"executions::
/// insert"`, `"events::list"`). A blank or generic label produces a warning
/// line nobody can act on, which is worse than the bare `get()` it replaced.
pub trait PoolExt {
    /// Check out a connection, logging a warning when the acquire exceeds
    /// [`POOL_STARVATION_WARN_MS`] and an error when it fails outright.
    ///
    /// Identical in type and behaviour to `Pool::get`, so `?` propagates the
    /// same `r2d2::Error` (which [`AppError`] converts via `#[from]`).
    fn conn(
        &self,
        label: &'static str,
    ) -> Result<PooledConnection<SqliteConnectionManager>, r2d2::Error>;
}

impl PoolExt for DbPool {
    fn conn(
        &self,
        label: &'static str,
    ) -> Result<PooledConnection<SqliteConnectionManager>, r2d2::Error> {
        acquire_logged(self, label)
    }
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

/// The standard per-connection SQLite pragma batch applied to every pooled
/// connection, regardless of which [`CustomizeConnection`] wraps it.
///
/// Single source of truth for these settings — [`SqlitePragmaCustomizer`] and
/// [`crate::cdc::CdcCustomizer`] both delegate to [`apply_standard_pragmas`]
/// instead of hand-copying this batch, so the two customizers can never drift
/// out of sync again (see refactor-bughunt-2026-07-10/tauri-db.md #3).
pub(crate) const STANDARD_PRAGMAS: &str = "PRAGMA foreign_keys = ON;
     PRAGMA busy_timeout = 5000;
     PRAGMA page_size = 4096;
     PRAGMA synchronous = NORMAL;
     PRAGMA mmap_size = 268435456;
     PRAGMA temp_store = 2;
     PRAGMA analysis_limit = 1000;
     PRAGMA cache_size = -2000;";

/// Apply [`STANDARD_PRAGMAS`] to `conn`. Shared by every connection customizer
/// so the pragma set is maintained in exactly one place.
pub(crate) fn apply_standard_pragmas(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(STANDARD_PRAGMAS)
}

/// Connection customizer that sets per-connection SQLite pragmas.
#[derive(Debug)]
struct SqlitePragmaCustomizer;

impl CustomizeConnection<rusqlite::Connection, rusqlite::Error> for SqlitePragmaCustomizer {
    fn on_acquire(&self, conn: &mut rusqlite::Connection) -> Result<(), rusqlite::Error> {
        apply_standard_pragmas(conn)
    }
}

pub fn spawn_idle_maintenance_task(primary_pool: DbPool, user_pool: UserDbPool) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        loop {
            if personas_core::ipc_gauge::ipc_in_flight() == 0 {
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
                    in_flight = personas_core::ipc_gauge::ipc_in_flight(),
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
    init_db_with_journal(app_data_dir, cdc_sender, None)
}

/// [`init_db`] plus the Reversible Agent's durable change-journal capture:
/// when `journal_sender` is provided (and CDC is enabled), every pooled
/// connection additionally registers a `preupdate_hook` that captures
/// allowlisted writes — with before-images for UPDATE/DELETE — into the
/// channel drained by [`journal::spawn_journal_writer`].
pub fn init_db_with_journal(
    app_data_dir: &PathBuf,
    cdc_sender: Option<cdc::CdcSender>,
    journal_sender: Option<journal::JournalSender>,
) -> Result<DbPool, AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    restrict_dir_permissions(app_data_dir);
    let db_path = app_data_dir.join("personas.db");
    let _ = PRIMARY_DB_PATH.set(db_path.clone());

    tracing::info!(path = %db_path.display(), "Initializing database");

    // Safety net for the migration chain below: snapshot an existing DB
    // before ANY connection opens it, so a bad boot migration can't strand
    // the user's data inside a half-migrated file. Best-effort — never
    // blocks boot. Fresh installs are skipped inside the helper. Policy
    // (every-boot backup, keep newest 3 sets) is documented in db/backup.rs.
    backup::backup_before_migrations(app_data_dir, &db_path);

    let manager = SqliteConnectionManager::file(&db_path);
    let customizer: Box<dyn CustomizeConnection<rusqlite::Connection, rusqlite::Error>> =
        match (cdc_sender, journal_sender) {
            (Some(sender), Some(journal)) => {
                Box::new(cdc::CdcCustomizer::with_journal(sender, journal))
            }
            (Some(sender), None) => Box::new(cdc::CdcCustomizer::new(sender)),
            (None, _) => Box::new(SqlitePragmaCustomizer),
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
        seed_builtin_shared_events(&conn)?;
        #[cfg(feature = "scraper")]
        seed_example_scrape_config(&conn)?;
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

/// Open a pooled connection to an **already-initialized** database file, WITHOUT
/// running migrations or seeds. This is for out-of-process companions (e.g. the
/// `personas-mcp` stdio binary) that attach to the DB the windowed app created —
/// they must not migrate or seed, only read/write through the same repo layer.
///
/// Uses the shared [`SqlitePragmaCustomizer`] so every pooled connection gets the
/// same `foreign_keys`/`busy_timeout` posture as the main app pool — important
/// for cross-process WAL contention. The caller is expected to have verified the
/// schema already exists (the windowed app has been launched at least once).
pub fn open_pool_at(db_path: &Path) -> Result<DbPool, AppError> {
    let manager = SqliteConnectionManager::file(db_path);
    let pool = Pool::builder()
        .max_size(4)
        .connection_timeout(POOL_ACQUIRE_TIMEOUT)
        .connection_customizer(Box::new(SqlitePragmaCustomizer))
        .build(manager)?;
    Ok(pool)
}

/// `(executions, indexed)` when the FTS index and `persona_executions` disagree
/// and the index needs rebuilding; `None` when they agree — or when the index
/// size cannot be read, in which case we log and leave the index alone rather
/// than rebuild blindly on every launch.
///
/// The document count comes from the `%_docsize` shadow table, NOT from
/// `SELECT COUNT(*) FROM executions_fts`. `executions_fts` is an
/// **external-content** FTS5 table (`content='persona_executions'`), so a full
/// scan of it is answered from the content table and reports the execution
/// count no matter what the index actually holds. The original guard compared
/// that number against the execution count — it could never differ, so the
/// backfill below had never run on any launch since it was written, and any
/// execution the sync triggers missed stayed permanently unsearchable. Covered
/// by `executions_fts_tests::ensure_executions_fts_backfills_rows_the_index_never_saw`.
///
/// The comparison is `!=`, not `<`: an index carrying entries for executions
/// that no longer exist returns phantom search hits, which is the same bug
/// wearing the other sign.
fn executions_fts_drift(conn: &rusqlite::Connection) -> Option<(i64, i64)> {
    let execution_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM persona_executions", [], |r| r.get(0))
        .unwrap_or(0);
    let indexed_count: i64 =
        match conn.query_row("SELECT COUNT(*) FROM executions_fts_docsize", [], |r| {
            r.get(0)
        }) {
            Ok(count) => count,
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "executions_fts index size is unreadable — skipping the FTS drift check",
                );
                return None;
            }
        };
    (indexed_count != execution_count).then_some((execution_count, indexed_count))
}

fn ensure_executions_fts(conn: &rusqlite::Connection) -> Result<(), AppError> {
    if let Some((execution_count, indexed_count)) = executions_fts_drift(conn) {
        tracing::info!(
            executions = execution_count,
            indexed = indexed_count,
            "Rebuilding executions_fts — the search index and persona_executions disagree",
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
        "persona_reports",
        "persona_healing_issues",
        "persona_manual_reviews",
        "persona_metrics_snapshots",
        "persona_test_runs",
        "persona_versions",
    ];
    let mut total: i64 = 0;
    for table in ORPHAN_TABLES {
        // This scrub is itself a delete door for memories: record the owed
        // vector cleanup in the reaper ledger BEFORE the rows (and the only
        // handle to their vectors) vanish. Record-only here — the recall
        // runtime does not exist yet at init; the ledger drain / sweep pays
        // the debt later (deferred-fixes #108).
        if *table == "persona_memories" {
            let victims: Vec<(String, Option<String>)> = (|| -> Result<_, rusqlite::Error> {
                let mut stmt = conn.prepare(
                    "SELECT id, title FROM persona_memories WHERE persona_id IS NOT NULL \
                     AND persona_id NOT IN (SELECT id FROM personas)",
                )?;
                let rows = stmt.query_map([], |r| {
                    Ok((
                        r.get::<_, String>("id")?,
                        r.get::<_, Option<String>>("title")?,
                    ))
                })?;
                rows.collect()
            })()
            .unwrap_or_default();
            if !victims.is_empty() {
                if let Err(e) = repos::core::memory_reaper::record_owed(conn, &victims) {
                    tracing::warn!(
                        count = victims.len(),
                        error = %e,
                        "boot scrub could not record owed memory reapers (sweep is the backstop)"
                    );
                }
            }
        }
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
    crate::vector_store::ensure_vec_registered_pub();

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

        // Defensive incremental ALTERs for columns added after the initial
        // KNOWLEDGE_BASE_SCHEMA. Same contract as the companion block below:
        // SQLite reports "duplicate column name" on every run after the first,
        // and that is the success path, not an error. (The system-database
        // migration runner in db::migrations::incremental does not cover the
        // user database.)
        //
        // Chunk provenance + extraction confidence, added with PDF ingestion:
        // pre-existing chunks came from verbatim text files, so the 1.0 default
        // is not merely a filler value — it is correct for every backfilled row.
        for stmt in &[
            "ALTER TABLE kb_chunks ADD COLUMN source_page INTEGER;",
            "ALTER TABLE kb_chunks ADD COLUMN extraction_confidence REAL NOT NULL DEFAULT 1.0;",
            "ALTER TABLE kb_documents ADD COLUMN page_count INTEGER;",
            "ALTER TABLE kb_documents ADD COLUMN empty_pages INTEGER NOT NULL DEFAULT 0;",
        ] {
            let _ = conn.execute_batch(stmt);
        }

        tracing::debug!("Knowledge base schema ensured in user database");
    }

    // Companion (Athena) schema — per-user brain index + runtime state.
    {
        let conn = pool.get()?;
        conn.execute_batch(COMPANION_SCHEMA)?;
        tracing::debug!("Companion schema ensured in user database");

        // Defensive incremental ALTERs for columns added after the
        // initial COMPANION_SCHEMA. Each statement is wrapped in a
        // failure-ignoring closure because SQLite returns "duplicate
        // column name" on the second run — that's the success path,
        // not an error. (User-database migrations don't share the
        // system-database runner in db::migrations::incremental.)
        for stmt in &[
            "ALTER TABLE companion_proactive_message ADD COLUMN scheduled_for TEXT;",
            // Athena async-UX milestone — Task model fields on background jobs.
            "ALTER TABLE companion_background_job ADD COLUMN short_title TEXT;",
            "ALTER TABLE companion_background_job ADD COLUMN parent_turn_id TEXT;",
            // Multiconv P1 — which thread spawned the task (orb/tray stay global).
            "ALTER TABLE companion_background_job ADD COLUMN conversation_id TEXT;",
            // Athena multi-conversation — see docs/features/companion/athena-multiconversation.md.
            // companion_session generalizes from the single 'default' row into the
            // conversation table (one row per user thread). Additive columns:
            "ALTER TABLE companion_session ADD COLUMN title TEXT;",
            "ALTER TABLE companion_session ADD COLUMN status TEXT NOT NULL DEFAULT 'active';",
            "ALTER TABLE companion_session ADD COLUMN last_read_at TEXT;",
            "ALTER TABLE companion_session ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
            "ALTER TABLE companion_session ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';",
            // Scope episodes by conversation. Only kind='episode' rows use it; all
            // other brain tiers (fact/goal/procedural/doctrine/…) leave it NULL and
            // stay GLOBAL — that is the singular-Athena property, keep it.
            "ALTER TABLE companion_node ADD COLUMN session_id TEXT;",
            // Per-block prompt size ledger — what each named system-prompt
            // block cost this turn, so silent growth (the dev-mode context
            // index reached ~30.6KB per turn unnoticed) is queryable rather
            // than accidental. See companion::prompt::PromptBlockSizes.
            "ALTER TABLE companion_turn ADD COLUMN prompt_blocks_json TEXT;",
            "ALTER TABLE companion_turn ADD COLUMN total_prompt_chars INTEGER;",
            // Per-block CONTENT hash — the churn half of the same
            // instrument. Sizes say how big a block is; only the hash says
            // whether it changed since the previous turn, which is what
            // drives `cache_creation_tokens`. `{"constitution":"8f3a…"}`,
            // FNV-1a-64 hex. See companion::prompt::PromptBlockSizes::
            // hashes_json and companion_get_prompt_churn.
            "ALTER TABLE companion_turn ADD COLUMN prompt_block_hashes_json TEXT;",
            // Why a turn failed, as a low-cardinality token (`timeout`,
            // `spawn_failed`, `cli_nonzero_exit`, …). NULL on a turn that ran.
            // Pairs with `is_error`, which was 0 on every row ever written
            // until failed turns started being recorded at all — see
            // companion::session::FailedTurnCtx.
            "ALTER TABLE companion_turn ADD COLUMN error_reason TEXT;",
            // Classification tags applied to a memory row by the sleep cycle,
            // as a JSON array of `companion_taxonomy.tag` values
            // (`["preference","style"]`). NULL on every row written before L1b
            // and on every row no cycle has classified — an untagged memory is
            // the norm, not a defect.
            //
            // An ALTER rather than a column in COMPANION_SCHEMA because
            // `companion_node` is an EXISTING table: `CREATE TABLE IF NOT
            // EXISTS` would silently skip the new column on every install that
            // already has the table, which is all of them. Same additive
            // precedent as `prompt_block_hashes_json` above.
            //
            // The tags are ALSO mirrored into `companion_fts.tags` as `tag:<t>`
            // tokens by `brain::sleep_cycle::apply_tags`, because the keyword
            // lane is the only retrieval lane the shipping build has — a tag
            // that lives solely in this column classifies nothing findable.
            "ALTER TABLE companion_node ADD COLUMN tags_json TEXT;",
        ] {
            let _ = conn.execute_batch(stmt);
        }

        // Per-conversation episode-recency lane: index episodes by (kind, session,
        // recency) so list_recent(session_id) is a scan of one thread, not the whole
        // brain. IF NOT EXISTS + runs after the session_id ALTER above.
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_companion_node_session \
             ON companion_node(kind, session_id, created_at DESC);",
        );
        // Backfill: every pre-existing episode belongs to the migrated 'default'
        // conversation. Idempotent (only touches NULLs).
        let _ = conn.execute_batch(
            "UPDATE companion_node SET session_id = 'default' \
             WHERE kind = 'episode' AND session_id IS NULL;",
        );
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
    -- Pages in the source document (PDF); NULL for flat text.
    page_count      INTEGER,
    -- Pages whose text layer was empty — i.e. scanned images we cannot read
    -- without OCR. > 0 means "this document is partly invisible to search",
    -- which the corpus map surfaces rather than letting the user guess.
    empty_pages     INTEGER NOT NULL DEFAULT 0,
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
    -- Provenance: 1-based page this chunk was read from (paginated sources
    -- only; NULL for flat text). Without it a retrieved chunk can be quoted
    -- but never located, so an agent citing the KB can say what but not where.
    source_page     INTEGER,
    -- How faithfully this text represents its source, 0.0..=1.0. 1.0 is
    -- verbatim; a low score means the page was mostly image and we only
    -- recovered a scrap of text, so answers resting on it should be hedged
    -- rather than asserted.
    extraction_confidence REAL NOT NULL DEFAULT 1.0,
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

-- Structured extraction: one row per extraction pass over a KB. The approved
-- schema is stored on the run so the extracted entities can be interpreted
-- later without re-deriving it.
CREATE TABLE IF NOT EXISTS kb_extraction_runs (
    id              TEXT PRIMARY KEY,
    kb_id           TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    schema_json     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running',
    entity_count    INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_kb_extraction_runs_kb ON kb_extraction_runs(kb_id);

-- One typed object the model pulled out of a document. entity_key is its short
-- label ("F10 footing"); attributes_json is the field->value object matching
-- the run's schema. source_page carries the citation forward from the chunk.
CREATE TABLE IF NOT EXISTS kb_entities (
    id                    TEXT PRIMARY KEY,
    run_id                TEXT NOT NULL REFERENCES kb_extraction_runs(id) ON DELETE CASCADE,
    kb_id                 TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id           TEXT REFERENCES kb_documents(id) ON DELETE SET NULL,
    source_page           INTEGER,
    entity_type           TEXT NOT NULL,
    entity_key            TEXT NOT NULL,
    attributes_json       TEXT NOT NULL DEFAULT '{}',
    extraction_confidence REAL NOT NULL DEFAULT 1.0,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_entities_run ON kb_entities(run_id);
CREATE INDEX IF NOT EXISTS idx_kb_entities_kb_type ON kb_entities(kb_id, entity_type);
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

-- Forget tombstones. `semantic::delete_fact` is a HARD delete — it removes the
-- fact, its provenance, its FTS row and its node row — but the source episodes
-- it was derived from stay, and the sleep cycle reads those same episodes every
-- night through `sleep_cycle::apply`. So "forget that I use VS Code" used to
-- hold only until the next cycle re-derived it from the same evidence, with no
-- record that the user had ever objected. The user's correction was silently
-- reversed, and from their side it looked like Athena had ignored them.
--
-- A row here says: consolidation may not RE-derive this (scope, fact_key). It
-- deliberately does not block an explicit write — Athena proposing the fact
-- again and the user approving it is new evidence, not a re-derivation, and
-- that path clears the tombstone (`semantic::clear_tombstone`).
--
-- `value_excerpt` is the forgotten value, kept for the audit trail only. It is
-- never matched against: the user forgetting a key is forgetting the SUBJECT,
-- and blocking only an exact value would let the next cycle re-derive the same
-- fact in different words.
--
-- A new table rather than a `user_state` column on `companion_fact`, because a
-- hard-deleted fact has no row left to carry one.
CREATE TABLE IF NOT EXISTS companion_fact_tombstone (
    scope         TEXT NOT NULL,
    fact_key      TEXT NOT NULL,
    value_excerpt TEXT,
    forgotten_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (scope, fact_key)
);

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

-- The keyword lane that this table's comments used to only PROMISE now exists:
-- `companion::brain::keyword` reads it with BM25 (`ORDER BY bm25(companion_fts)`)
-- and it is the sole retrieval lane on the non-`ml` build. A sibling device
-- dropped this table on 2026-08-07 on the correct-at-the-time premise that it
-- had no reader; the 2026-08-08 merge restored it, because it now has one.
-- The open trade-off it correctly identified stands: this is a second plaintext
-- copy of every memory body, transcripts included, and it is NOT covered by the
-- encrypted-section work. Retiring it means porting the lane to `companion_node`,
-- not just deleting the table — the reader would silently return nothing.
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

-- DEV MODE dispatch ledger (docs/tests/athena/dev-mode-direction.md, Phase 4).
-- One row per dev_improve operation. Durable so the dev_merge handshake and
-- boot recovery survive the app restart that backend work inherently causes;
-- doubles as the Phase-5 experiment ledger (user_verdict + metrics queries).
-- status: dispatched | completed | merged | closed | interrupted
CREATE TABLE IF NOT EXISTS companion_dev_op (
    op_id            TEXT PRIMARY KEY,
    request          TEXT NOT NULL,
    backend          INTEGER NOT NULL DEFAULT 1,
    workspace        TEXT NOT NULL,
    branch           TEXT,
    fleet_session_id TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'dispatched',
    commit_sha       TEXT,
    user_verdict     TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_dev_op_status ON companion_dev_op(status, created_at DESC);

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

-- Sleep cycles: one row per reconciliation pass over the brain (phase L1 of
-- docs/plans/athena-longevity.md). Distinct from companion_consolidation,
-- which is the older *manual, proposal-only* fact-diff pass: a cycle is the
-- scheduled multi-phase run (compress / reconcile / identity / critique) and
-- its `phases_json` is the audit trail of what each phase did.
--
-- The narrative report is a `companion_node` row (kind='cycle_report') with
-- markdown on disk under `cycles/`, mirrored into companion_fts so the
-- keyword lane can retrieve it — same four-way write every other memory tier
-- performs. This table is the structured index over those reports.
--
-- No incremental ALTER pairs this: the table is new, and COMPANION_SCHEMA is
-- re-executed on every boot, so CREATE IF NOT EXISTS reaches existing
-- databases as well as fresh ones.
CREATE TABLE IF NOT EXISTS companion_cycle (
    id           TEXT PRIMARY KEY,
    started_at   TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at  TEXT,
    -- running | completed | failed. A cycle that never finishes STAYS
    -- 'running' — there is no sweeper that rewrites it to failed, because a
    -- crashed cycle and a still-working one are genuinely different and the
    -- ledger must not guess which happened.
    status       TEXT NOT NULL DEFAULT 'running',
    -- JSON array of {phase, status, detail, at} — appended one entry per
    -- phase as the cycle walks.
    phases_json  TEXT NOT NULL DEFAULT '[]',
    -- JSON object of whatever the cycle counted (facts_added, episodes_read,
    -- cost_usd, …) plus `error` on a failed cycle. Versionless; consumers
    -- tolerate gaps, same contract as companion_turn.outcome_json.
    stats_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_companion_cycle_started
    ON companion_cycle(started_at DESC);

-- Classification-tag registry for tier-3 long-term memory (phase L1 of
-- docs/plans/athena-longevity.md). Facts, procedurals and preferences are
-- tagged from THIS table rather than from a hard-coded enum, because the
-- design's central bet is that **schema evolution is rows, never DDL**:
-- Athena's critique phase may propose a new classification, the operator gates
-- it, and expansion stays data — additive, reviewable and reversible. A tag
-- proposed by a cycle carries that cycle's id in `origin`, so every expansion
-- traces back to the pass that argued for it.
--
-- `status` is the gate: 'proposed' is inert (it classifies nothing until
-- someone activates it), 'active' is in use. The seeds below ship 'active'
-- because they are the vocabulary the first cycle needs to say anything at all.
--
-- No incremental ALTER pairs this: the table is new, and COMPANION_SCHEMA is
-- re-executed on every boot, so CREATE IF NOT EXISTS reaches existing
-- databases as well as fresh ones (same reasoning as companion_cycle above).
CREATE TABLE IF NOT EXISTS companion_taxonomy (
    id          TEXT PRIMARY KEY,
    tag         TEXT NOT NULL UNIQUE,
    definition  TEXT NOT NULL,
    -- 'seed' | a companion_cycle.id — who introduced this tag.
    origin      TEXT NOT NULL,
    -- 'active' | 'proposed'
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_taxonomy_status
    ON companion_taxonomy(status, tag);

-- The seed vocabulary. `INSERT OR IGNORE` keyed on the UNIQUE `tag` (and a
-- deterministic id) makes this idempotent across every boot: re-running cannot
-- duplicate a tag, and — importantly — cannot resurrect the *status* of a tag
-- a cycle or the operator has since changed, because the row already exists and
-- the insert is skipped entirely. Deleting a seed row does re-seed it on the
-- next boot; demote by status instead of deleting, which is the same
-- forgetting-is-demotion rule the rest of the memory model follows.
INSERT OR IGNORE INTO companion_taxonomy (id, tag, definition, origin, status) VALUES
    ('tax_seed_preference',  'preference',  'How the operator wants things done or communicated.',        'seed', 'active'),
    ('tax_seed_style',       'style',       'Tone, format or verbosity of communication.',                 'seed', 'active'),
    ('tax_seed_constraint',  'constraint',  'A hard limit or rule to respect.',                            'seed', 'active'),
    ('tax_seed_decision',    'decision',    'A choice that was made, with its why.',                       'seed', 'active'),
    ('tax_seed_workflow',    'workflow',    'A repeatable way of doing something.',                        'seed', 'active'),
    ('tax_seed_tool',        'tool',        'A capability, service or integration, and how to use it.',    'seed', 'active'),
    ('tax_seed_contact',     'contact',     'A person, team or agent, and their role.',                    'seed', 'active'),
    ('tax_seed_incident',    'incident',    'Something that went wrong and what it taught.',               'seed', 'active'),
    ('tax_seed_environment', 'environment', 'A fact about a machine, repo or system.',                     'seed', 'active');

-- Staging inbox for cross-device memory sync (phase LS of
-- docs/plans/athena-longevity.md). Both paired machines are homes — the
-- operator works on each — so project-abstract memory (user/world-scope facts,
-- user-scope procedurals, preferences, taxonomy rows) syncs while episodes,
-- project-scope facts, doctrine, goals and cycle reports stay local.
--
-- THE CONTRACT, and the reason this is a table rather than a direct write:
--
--   * LS **writes** here. An arriving delta lands in staging, tagged with the
--     device it came from — never anywhere else.
--   * The sleep cycle's **reconcile phase is the ONLY consumer.** It reads
--     unprocessed rows, treats them as semi-trusted evidence, and puts them
--     through the same supersede / contradict / dedupe machinery and the same
--     proposal gate as locally-derived memory.
--   * **Sync never force-writes long-term memory.** There is deliberately no
--     path from an inbound delta to a fact row that does not pass through a
--     cycle's judgement. Conflict resolution IS the sleep cycle; this table is
--     what makes that possible instead of aspirational.
--
-- `processed_cycle_id` (NULL = unprocessed) gives idempotency and echo
-- prevention for free: a redelivered delta is visible as already-consumed, and
-- the row records WHICH cycle consumed it, so a bad reconcile is auditable
-- rather than merely regrettable. Rows are never deleted on processing — the
-- distillate that crossed the wire is the evidence for what the cycle then did.
CREATE TABLE IF NOT EXISTS companion_sync_inbox (
    id                  TEXT PRIMARY KEY,
    -- Which paired device produced this delta.
    origin_device       TEXT NOT NULL,
    -- 'fact' | 'procedural' | 'taxonomy'
    item_kind           TEXT NOT NULL,
    payload_json        TEXT NOT NULL,
    received_at         TEXT NOT NULL DEFAULT (datetime('now')),
    -- companion_cycle.id that reconciled this row; NULL = still unprocessed.
    processed_cycle_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_sync_inbox_unprocessed
    ON companion_sync_inbox(processed_cycle_id, received_at);

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
    trigger_kind  TEXT NOT NULL,                 -- 'goal_target_approaching' | 'backlog_aging' | 'cadence_due' | 'athena_scheduled'
    trigger_ref   TEXT,                           -- id of the goal/backlog/ritual that fired
    message       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at  TEXT,
    resolved_at   TEXT,
    -- NULL = "deliver as soon as triggers say so" (current behavior).
    -- Non-NULL ISO8601 = the deliver-due sweep skips this row until the
    -- timestamp is reached. Set by Athena's `schedule_proactive` op.
    scheduled_for TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_proactive_status
    ON companion_proactive_message(status, created_at DESC);
-- Per-trigger dedupe: don't fire the same trigger for the same target
-- multiple times in a row. The query checks for an unresolved message
-- with matching (trigger_kind, trigger_ref) before inserting.
CREATE INDEX IF NOT EXISTS idx_companion_proactive_dedupe
    ON companion_proactive_message(trigger_kind, trigger_ref, status);

-- Design decisions captured during companion conversations. Persisted
-- copy of the `show_decision_log` chat-card entries so Athena (and the
-- user) can retrace design rationale across sessions. `persona_context`
-- is optional — a persona id, build session id, or free-form intent
-- string letting future queries filter by which persona the decisions
-- describe.
CREATE TABLE IF NOT EXISTS companion_design_decision (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    persona_context     TEXT,
    label               TEXT NOT NULL,
    choice              TEXT NOT NULL,
    rationale           TEXT NOT NULL,
    decision_timestamp  TEXT,            -- the timestamp Athena attached, optional
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_design_decision_session
    ON companion_design_decision(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_companion_design_decision_context
    ON companion_design_decision(persona_context, created_at DESC);

-- Daily budget for proactive nudges. The scheduler increments on each
-- delivery; a fresh row is created on the first nudge of any UTC date.
CREATE TABLE IF NOT EXISTS companion_proactive_budget (
    date    TEXT PRIMARY KEY,                    -- 'YYYY-MM-DD' UTC
    count   INTEGER NOT NULL DEFAULT 0           -- global daily ceiling counter
);

-- Phase C2 (Athena value expansion / direction 2): per-trigger-kind daily
-- sub-budgets under the global ceiling, so one noisy leg can't crowd out
-- another's cards. companion::proactive::budget claims one global unit AND one
-- per-kind unit (atomically) per delivery.
CREATE TABLE IF NOT EXISTS companion_attention_budget (
    date          TEXT NOT NULL,                 -- 'YYYY-MM-DD' UTC
    trigger_kind  TEXT NOT NULL,
    count         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, trigger_kind)
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
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued',
    params_json     TEXT NOT NULL DEFAULT '{}',
    result_text     TEXT,
    error_text      TEXT,
    project_id      TEXT,                            -- nullable: links scan jobs to known_project
    short_title     TEXT,                            -- human one-liner for the task tag/tray (e.g. "Scanning ai-paralegal")
    parent_turn_id  TEXT,                            -- the conversation turn/episode that spawned this task (for in-chat tag grouping)
    conversation_id TEXT,                            -- the thread that spawned it (multiconv P1); orb/tray aggregate ALL threads
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    started_at      TEXT,
    completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_background_job_status
    ON companion_background_job(status, created_at);
CREATE INDEX IF NOT EXISTS idx_companion_job_status_created
    ON companion_background_job(status, created_at);

-- Project tracking: per-project subscription owned by the Dev Tools plugin.
-- One row per row in `companion_known_project`. Watch flags decide which
-- sources the engine project_tracking subsystem polls; `enabled` is the
-- per-project on/off (the Companion master toggle in plugin setup is a
-- separate global gate). Phase 7 auto-creates a row with enabled=false
-- whenever a project is registered; Phase 0 just lays the schema.
CREATE TABLE IF NOT EXISTS dev_tools_project_subscription (
    project_id           TEXT PRIMARY KEY,
    watch_git            INTEGER NOT NULL DEFAULT 1,
    watch_active_runs    INTEGER NOT NULL DEFAULT 1,
    watch_obsidian       INTEGER NOT NULL DEFAULT 0,
    obsidian_vault_path  TEXT,
    enabled              INTEGER NOT NULL DEFAULT 0,
    last_pulse_at        TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES companion_known_project(id) ON DELETE CASCADE
);

-- Project tracking: raw event log. Insert-only, no LLM, no embedding.
-- Pruned to the last 7 days on each scheduler tick (Phase 1). Aggregated
-- into `engine_project_pulse` rows by the consolidator (Phase 2).
-- `kind` is one of: 'commit' | 'run_started' | 'run_completed' | 'note'.
-- `payload_json` carries source-specific fields (commit hash + author +
-- subject + files for 'commit'; run slug + paths for 'run_*'; note path +
-- title + summary for 'note').
CREATE TABLE IF NOT EXISTS engine_cli_event (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL,
    kind          TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES companion_known_project(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_engine_cli_event_project_created
    ON engine_cli_event(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_engine_cli_event_kind_created
    ON engine_cli_event(project_id, kind, created_at);

-- Project tracking: consolidated picture. One row per (project, day),
-- upserted across the day's ticks. `narrative_md` is a single short
-- paragraph, `directions_json` is 3-5 named hypotheses about where work
-- is heading, `tensions_json` is 0-3 bullets flagging drift /
-- half-finished work / contradictions. Aggregates support drill-in
-- queries from chat without re-counting. Token telemetry tracks
-- consolidator cost.
CREATE TABLE IF NOT EXISTS engine_project_pulse (
    project_id        TEXT NOT NULL,
    day               TEXT NOT NULL,                  -- ISO date (YYYY-MM-DD)
    narrative_md      TEXT NOT NULL DEFAULT '',
    directions_json   TEXT NOT NULL DEFAULT '[]',
    tensions_json     TEXT NOT NULL DEFAULT '[]',
    commit_count      INTEGER NOT NULL DEFAULT 0,
    run_count         INTEGER NOT NULL DEFAULT 0,
    note_count        INTEGER NOT NULL DEFAULT 0,
    tokens_in         INTEGER NOT NULL DEFAULT 0,
    tokens_out        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, day),
    FOREIGN KEY (project_id) REFERENCES companion_known_project(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_engine_project_pulse_recent
    ON engine_project_pulse(project_id, day DESC);

-- Phase A1 (Athena value expansion / direction 6): per-turn usage ledger.
-- One row per Claude CLI spawn Athena makes — a chat/autonomous/proactive
-- reasoning turn or a cheap headless decision leg (exec_triage, msg_triage,
-- reaction, review_resolution). Captures the terminal `result` event's
-- total_cost_usd / token usage / duration so the Overview dashboards can show
-- what Athena costs and for what kind of work. Best-effort: usage columns are
-- NULL when the CLI emitted no result event. Pruned to 90 days by
-- companion::turn_ledger::prune_old_turns.
CREATE TABLE IF NOT EXISTS companion_turn (
    id                    TEXT PRIMARY KEY,
    origin                TEXT NOT NULL,                 -- chat | autonomous | proactive | external | headless
    trigger_kind          TEXT,                          -- proactive trigger kind, or headless leg label
    model                 TEXT,
    input_tokens          INTEGER,
    output_tokens         INTEGER,
    cache_read_tokens     INTEGER,
    cache_creation_tokens INTEGER,
    cost_usd              REAL,
    duration_ms           INTEGER,
    num_turns             INTEGER,                        -- CLI-internal assistant turns
    is_error              INTEGER NOT NULL DEFAULT 0,
    voice                 INTEGER NOT NULL DEFAULT 0,
    assistant_episode_id  TEXT,                           -- NULL for headless rows
    outcome_json          TEXT,                           -- dispatcher side-effect / triage verdict counts
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_turn_created
    ON companion_turn(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_companion_turn_origin
    ON companion_turn(origin, created_at DESC);

-- Phase D1 (Athena value expansion / direction 3): learned per-persona cost +
-- duration baselines so execution triage flags deviation-from-own-norm instead
-- of global constants. Computed from persona_executions (operational DB),
-- cached here, refreshed lazily (24h) per companion::proactive::baselines.
-- declared_* are optional user-set expected bands that override the learned p95.
CREATE TABLE IF NOT EXISTS companion_persona_baseline (
    persona_id            TEXT PRIMARY KEY,
    p50_cost              REAL,
    p95_cost              REAL,
    p50_duration_ms       INTEGER,
    p95_duration_ms       INTEGER,
    sample_n              INTEGER NOT NULL DEFAULT 0,
    declared_cost_usd     REAL,
    declared_duration_ms  INTEGER,
    computed_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Phase F3 (Athena value expansion / direction 7): lightweight behavioral
-- signals the frontend records (refine-chip clicks, walkthrough completion,
-- decision-queue usage) so the weekly profile-synthesis pass can learn how the
-- user works from what they DO, not just what they say. payload_json is a tiny
-- numbers/enums blob — never raw user content.
CREATE TABLE IF NOT EXISTS companion_ux_signal (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_ux_signal_kind
    ON companion_ux_signal(kind, created_at DESC);

-- Night Shift v1 (moonshot batch-2): one row per proposed overnight plan.
-- Status: proposed → approved → running → completed | declined | expired.
-- plan_json is the bounded planner::DraftPlan; window_end (RFC3339 UTC, set
-- at approval) is the wake time that closes the unattended night window.
-- No plan runs unapproved — dispatch only happens via the
-- `night_shift_execute_plan` approval executor.
CREATE TABLE IF NOT EXISTS companion_night_plan (
    id            TEXT PRIMARY KEY,
    status        TEXT NOT NULL DEFAULT 'proposed',
    summary       TEXT NOT NULL,
    plan_json     TEXT NOT NULL,
    window_end    TEXT,
    max_sessions  INTEGER NOT NULL DEFAULT 3,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at   TEXT,
    completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_night_plan_status
    ON companion_night_plan(status, created_at DESC);

-- Night Shift v1: append-only audit ledger of every autonomous night act —
-- dispatches, unattended guidance answers, parked destructive approvals,
-- review-station verdicts. Every row is attributed (plan_id +
-- fleet_session_id); the morning report is composed from this table.
CREATE TABLE IF NOT EXISTS companion_night_event (
    id               TEXT PRIMARY KEY,
    plan_id          TEXT,
    kind             TEXT NOT NULL,
    fleet_session_id TEXT,
    project_label    TEXT,
    payload_json     TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_night_event_plan
    ON companion_night_event(plan_id, kind, created_at);

-- Dev-only gamification: daily goal sets for the Athena companion panel.
-- One "set" = 1-3 goals entered together (shared set_id); at most one set
-- is status='active' at a time. Evaluation is manual (the operator toggles
-- each goal); when the last open goal is marked done the whole set flips
-- to 'completed' and completed_date (LOCAL 'YYYY-MM-DD') becomes the
-- streak key. Completed rows are kept as history so the streak is always
-- recomputable; discarded sets never count.
CREATE TABLE IF NOT EXISTS companion_daily_goal (
    id             TEXT PRIMARY KEY,
    set_id         TEXT NOT NULL,
    slot           INTEGER NOT NULL,
    title          TEXT NOT NULL,
    done_at        TEXT,
    status         TEXT NOT NULL DEFAULT 'active',
    completed_date TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_daily_goal_status
    ON companion_daily_goal(status, completed_date);

-- Per-turn sidecars: the rich side channels the frontend parses out of the
-- CLI stream for one assistant episode (narration/tool trail, TodoWrite
-- plan, dispatcher turn summary, recall preview). They used to live only in
-- the Zustand store, so an app restart stripped every older bubble back to
-- bare text and the dev conversation-log export lost them for pre-restart
-- turns. One row per assistant episode; each column is an opaque JSON blob
-- owned by the frontend types (StoredNarration / TodoStep[] /
-- StoredTurnSummary / CompanionRecallPreview) — the backend never parses
-- them, it only stores and returns them.
CREATE TABLE IF NOT EXISTS companion_turn_sidecar (
    episode_id     TEXT PRIMARY KEY,
    narration_json TEXT,
    steps_json     TEXT,
    summary_json   TEXT,
    recall_json    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Durable inline chat-cards. Informational cards (persona_overview, …) stay
-- transient by design — they are UI snippets riding along with a reply. But
-- ACTIONABLE cards (fleet_plan, ship_milestone) are proposals the operator is
-- expected to confirm, and the plan JSON is stripped from the assistant text
-- before episode persistence: once the transient store array was cleared (next
-- send, panel reset, dev refresh) the proposal was unrecoverable. An Aug 2026
-- session silently lost six dispatched builds that way. Actionable cards now
-- get a row here BEFORE the event is emitted; the row id rides in the payload
-- and the frontend resolves it. status: pending → dispatched | dismissed |
-- superseded (dispatched is terminal — its sessions are real).
CREATE TABLE IF NOT EXISTS companion_chat_card (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    episode_id      TEXT,
    kind            TEXT NOT NULL,
    title           TEXT,
    config_json     TEXT NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending',
    result_json     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_chat_card_pending
    ON companion_chat_card(conversation_id, status, created_at DESC);

-- companion_tours: Athena-composed guided tours (Generative Tours).
-- One row per composed tour; steps stored as validated JSON in the frontend
-- `TourStepDef` shape. `manifest_hash` records which anchor manifest the tour
-- was proven against, so upgrades can re-prove and mark drifted tours 'stale'
-- instead of letting them break mid-play.
--
-- Moved here 2026-08-15 from migrations/incremental.rs. Its DDL ran against
-- the MAIN database while all four of its statements execute on
-- `&UserDbPool` (companion/tours.rs:223,258,302,379). Verified on the live
-- files: the table existed in personas.db with 0 rows, and
-- `SELECT count(*) FROM companion_tours` against personas_data.db returned
-- "no such table". The feature shipped 2026-07-30 and never wrote a row.
--
-- It compiled because DbPool and UserDbPool are the same type behind two
-- aliases, so the store a handle points at is not a fact the compiler holds.
-- Nothing else caught it either: no test asserts persistence, and
-- `compose_tour` pays for a Claude call BEFORE it fails.
--
-- The empty table left behind in personas.db on existing installs is
-- deliberately not dropped — it holds no rows and dropping it would be a
-- destructive migration to reclaim nothing.
CREATE TABLE IF NOT EXISTS companion_tours (
    id            TEXT PRIMARY KEY,
    topic         TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    icon          TEXT NOT NULL DEFAULT 'Sparkles',
    color         TEXT NOT NULL DEFAULT 'violet',
    steps_json    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'ready',
    manifest_hash TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companion_tours_created
    ON companion_tours(created_at DESC);
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

/// Path of a SQLite sidecar (`-wal` / `-shm`) for `db_path`.
///
/// SQLite derives sidecar names by appending the suffix to the FULL file
/// name — `store` → `store-wal`, `data.sqlite` → `data.sqlite-wal`. It is
/// tempting to reach for `Path::with_extension("db-wal")`, which is only
/// correct while the store happens to be named `*.db`; a store named without
/// an extension, or with a different one, gets a name SQLite never wrote, and
/// a delete or permission pass that uses it silently misses the real sidecar.
pub(crate) fn sidecar_path(db_path: &Path, suffix: &str) -> std::path::PathBuf {
    let mut name = db_path.as_os_str().to_os_string();
    name.push(suffix);
    std::path::PathBuf::from(name)
}

/// Set owner-only permissions on the database file and its WAL/SHM journal files.
///
/// On Unix: chmod 0600 (owner read/write only).
/// On Windows: icacls to remove inherited permissions and grant owner-only access.
fn restrict_db_file_permissions(db_path: &Path) {
    let wal_path = sidecar_path(db_path, "-wal");
    let shm_path = sidecar_path(db_path, "-shm");

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
    // The embedded-Pumper "local-scraper" connector was retired in Phase 1c —
    // the scraper now talks to the app via Signals (event bus), not a connector
    // or persona-invoked MCP tools. Remove it from any DB a prior build seeded.
    let _ = conn.execute(
        "DELETE FROM connector_definitions WHERE id = 'builtin-local-scraper' AND is_builtin = 1",
        [],
    );
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

/// Seed the curated shared-event catalog + baked firings that ship with this
/// release. Definitions are auto-generated from scripts/connectors/builtin/*.json
/// (catalog) and scripts/events/connector-events.ledger.json (firings) into
/// `db/builtin_shared_events.rs`. Regenerate with:
///   node scripts/events/generate-connector-events.mjs
///
/// Catalog rows upsert like connectors (INSERT OR IGNORE + UPDATE-on-upgrade to
/// refresh copy/icon while preserving subscriber_count). Firings are append-only
/// (INSERT OR IGNORE by id); the local relay delivers unseen firings to
/// subscribers offline.
fn seed_builtin_shared_events(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();

    let catalog = builtin_shared_events::BUILTIN_SHARED_EVENTS;
    for e in catalog {
        conn.execute(
            "INSERT OR IGNORE INTO shared_event_catalog
             (id, slug, name, description, category, publisher, icon, color,
              sample_payload, event_schema, subscriber_count, is_featured, status, cached_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 0, 'active', ?11)",
            params![
                e.id,
                e.slug,
                e.name,
                e.description,
                e.category,
                e.publisher,
                e.icon,
                e.color,
                e.sample_payload,
                e.event_schema,
                now,
            ],
        )?;
        // Refresh presentation fields on upgrade; preserve subscriber_count/status.
        conn.execute(
            "UPDATE shared_event_catalog
             SET name = ?1, description = ?2, category = ?3, publisher = ?4,
                 icon = ?5, color = ?6, sample_payload = ?7, event_schema = ?8, cached_at = ?9
             WHERE id = ?10",
            params![
                e.name,
                e.description,
                e.category,
                e.publisher,
                e.icon,
                e.color,
                e.sample_payload,
                e.event_schema,
                now,
                e.id,
            ],
        )?;
    }

    let firings = builtin_shared_events::BUILTIN_SHARED_EVENT_FIRINGS;
    for f in firings {
        conn.execute(
            "INSERT OR IGNORE INTO shared_event_firings
             (id, slug, seq, title, fired_at, payload, release_version, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                f.id,
                f.slug,
                f.seq,
                f.title,
                f.fired_at,
                f.payload,
                f.release_version,
                now,
            ],
        )?;
    }

    tracing::debug!(
        "Seeded {} shared-event catalog feeds, {} baked firings",
        catalog.len(),
        firings.len()
    );
    Ok(())
}

/// Seed one disabled example scrape config so users have a working template to
/// clone. INSERT OR IGNORE keeps a user's edits/deletion sticky across upgrades.
#[cfg(feature = "scraper")]
fn seed_example_scrape_config(conn: &rusqlite::Connection) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR IGNORE INTO scraper_configs
         (id, name, description, urls, rules, dataset, key_field, cron, enabled)
         VALUES ('example-hn-front', ?1, ?2, ?3, ?4, 'hn_front', 'title', NULL, 0)",
        params![
            "Hacker News front page",
            "Example — top story titles + links from the HN homepage.",
            r#"["https://news.ycombinator.com/"]"#,
            r#"{"title":{"type":"css","selector":".titleline > a","all":true}}"#,
        ],
    )?;
    Ok(())
}

// Available to this crate's own tests AND, via the `test-support` feature, to
// the desktop crate's — `cfg(test)` does not cross a crate boundary, and ~72
// test modules over there build their fixtures with this.
/// Path to a fully-migrated, fully-seeded database built **once per test
/// process**, which [`init_test_db`] copies per call.
///
/// WHY (2026-08-13). This fixture has ~576 call sites. Each one used to run the
/// entire migration chain from scratch — the initial schema, 124 `run_step`s,
/// 378 `ddl_step` calls and three seed functions — against a temp file on disk.
/// Measured, that is ~24 CPU-minutes of pure schema setup per suite before a
/// single assertion executes, and cargo's default `--test-threads` is the core
/// count, so it lands on every core at once. Two concurrent suites made a
/// developer machine unusable.
///
/// Building the chain once and copying the resulting file is orders of
/// magnitude cheaper: a copy is a few milliseconds against seconds for the
/// chain.
///
/// Safe because the standard pragma set does **not** enable WAL, so a database
/// is a single self-contained file with no `-wal`/`-shm` sidecar to tear; the
/// building connection is dropped before any copy is taken.
#[cfg(any(test, feature = "test-support"))]
fn migrated_template() -> Result<std::path::PathBuf, AppError> {
    use std::sync::OnceLock;
    static TEMPLATE: OnceLock<Result<std::path::PathBuf, String>> = OnceLock::new();

    TEMPLATE
        .get_or_init(|| {
            // One template per process — the pid keeps concurrent cargo test
            // binaries (and parallel harness runs) off each other's file.
            let path = std::env::temp_dir()
                .join(format!("personas_test_template_{}.db", std::process::id()));
            let _ = std::fs::remove_file(&path); // stale template from a crashed run

            let build = || -> Result<(), AppError> {
                let conn = rusqlite::Connection::open(&path)?;
                apply_standard_pragmas(&conn)?;
                migrations::run(&conn)?;
                migrations::run_incremental(&conn)?;
                seed_builtin_tools(&conn)?;
                seed_builtin_connectors(&conn)?;
                seed_builtin_shared_events(&conn)?;
                // Drop before the first copy: an open handle can leave the
                // rollback journal on disk, and a copy taken then is torn.
                drop(conn);
                Ok(())
            };

            match build() {
                Ok(()) => Ok(path),
                Err(e) => {
                    let _ = std::fs::remove_file(&path);
                    Err(format!("could not build the test-database template: {e}"))
                }
            }
        })
        .clone()
        .map_err(AppError::Internal)
}

/// Filename prefixes every test-only database in this crate uses. A sweep that
/// does not know a prefix cannot reclaim it, so adding a new `init_*_db` helper
/// means adding its prefix here — the test at the bottom of this file asserts
/// each one is actually constructed somewhere.
#[cfg(any(test, feature = "test-support"))]
const TEST_DB_PREFIXES: &[&str] = &[
    "personas_test_",
    "personas_user_test_",
    "personas_journal_",
    "personas_cdc_drop_",
    "mgmt_api_test_",
];

/// How stale a temp database must be before the sweep will remove it.
///
/// The full Rust suite runs in ~80 seconds and cargo runs test binaries in
/// parallel, so anything untouched for an hour belongs to a process that has
/// long since exited. Deliberately generous: reclaiming a file a live test is
/// still using would turn a disk problem into a flaky-test problem, and the
/// cost of being wrong in that direction is far higher than the megabytes.
#[cfg(any(test, feature = "test-support"))]
const TEST_DB_STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Remove test databases left behind by earlier processes. Runs at most once
/// per process, on the first `init_test_db` / `init_test_user_db` call.
///
/// # Why this exists
///
/// `init_test_db` copies a migrated template to
/// `%TEMP%/personas_test_<uuid>.db` and **nothing ever deleted it**. Every call
/// leaked ~4.5 MB; the suite calls it thousands of times per run. Measured on
/// this machine 2026-08-25: **15,669 files, 70 GB, all written in the preceding
/// five days** — the single largest reclaimable item on a 952 GB volume that had
/// just hit zero bytes free, and larger than any repository on it except one.
///
/// The complete fix would delete each database when its pool drops. That needs
/// the pool to own a `Drop` guard, which means wrapping the connection manager
/// — and `DbPool` is a type alias over `Pool<SqliteConnectionManager>` that 719
/// call sites name. Changing it is a far bigger edit than this defect warrants,
/// so the sweep is the deliberate second-best: it cannot reclaim the CURRENT
/// process's files, but it guarantees the previous ones are gone, which turns
/// unbounded growth into roughly one run's worth. `scripts/build/run-rust-tests.mjs`
/// closes the remaining half for the sanctioned path.
///
/// Entirely best-effort. A failure here must never fail a test: the worst case
/// is the disk usage we already had.
#[cfg(any(test, feature = "test-support"))]
fn sweep_stale_test_dbs() {
    use std::sync::Once;
    static SWEPT: Once = Once::new();
    SWEPT.call_once(run_test_db_sweep);
}

/// The sweep itself, without the `Once`. Split out because a `Once`-guarded
/// function is untestable by construction — the first test to touch a pool
/// consumes it, and every later assertion then passes against a sweep that
/// never ran. That is the shape of vacuous gate this repo keeps finding, so it
/// is avoided here rather than explained later.
#[cfg(any(test, feature = "test-support"))]
fn run_test_db_sweep() {
    {
        let dir = std::env::temp_dir();
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return;
        };
        let now = std::time::SystemTime::now();
        let (mut removed, mut bytes) = (0u32, 0u64);
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if !TEST_DB_PREFIXES.iter().any(|p| name.starts_with(p)) {
                continue;
            }
            // `-wal` and `-shm` siblings are matched by the same prefixes, so
            // they are reclaimed with the database rather than orphaned.
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let stale = meta
                .modified()
                .ok()
                .and_then(|m| now.duration_since(m).ok())
                .is_some_and(|age| age > TEST_DB_STALE_AFTER);
            if !stale {
                continue;
            }
            let len = meta.len();
            if std::fs::remove_file(entry.path()).is_ok() {
                removed += 1;
                bytes += len;
            }
        }
        if removed > 0 {
            tracing::debug!(
                removed,
                mib = bytes / (1024 * 1024),
                "swept stale test databases from the temp dir"
            );
        }
    }
}

#[cfg(any(test, feature = "test-support"))]
pub fn init_test_db() -> Result<DbPool, AppError> {
    use std::time::Duration;

    // Copy the once-built template rather than re-running the migration chain.
    // A unique file per test (not `:memory:`) because r2d2 hands out multiple
    // connections and each in-memory connection would get its own empty
    // database.
    sweep_stale_test_dbs();
    let template = migrated_template()?;
    let tmp = std::env::temp_dir().join(format!("personas_test_{}.db", uuid::Uuid::new_v4()));
    std::fs::copy(&template, &tmp).map_err(AppError::Io)?;

    let manager = SqliteConnectionManager::file(&tmp);
    let pool = Pool::builder()
        .max_size(2)
        .connection_timeout(Duration::from_secs(5))
        .connection_customizer(Box::new(SqlitePragmaCustomizer))
        .build(manager)?;

    // Prove the copy is usable before handing it to a test: a torn or truncated
    // copy would otherwise surface as a baffling failure in whichever assertion
    // touched the database first.
    {
        let conn = pool.get()?;
        conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })?;
    }
    Ok(pool)
}

/// Throwaway USER database (the `personas_data.db` counterpart of
/// [`init_test_db`]) for tests that exercise code spanning BOTH pools — the
/// portability importer reads twins out of the app database but their
/// knowledge bases out of this one.
///
/// Applies [`KNOWLEDGE_BASE_SCHEMA`] **and** [`COMPANION_SCHEMA`] plus the
/// post-CREATE ALTERs `init_user_db` performs, so a test pool is shaped like a
/// real `personas_data.db`. (It used to be knowledge-base only, on the grounds
/// that nothing needing this pool also needed the brain — Athena's memory
/// section of the portability bundle needs both, and a fixture whose columns
/// differ from production is a test that proves the wrong thing.)
/// The companion schema text itself, so a test can prove that **re-executing**
/// it is idempotent.
///
/// That is not a hypothetical property: `init_user_db` runs `COMPANION_SCHEMA`
/// on every single app launch, and the block now contains `INSERT OR IGNORE`
/// seed rows as well as `CREATE TABLE IF NOT EXISTS`. A seed block that
/// duplicated on re-execution would grow the taxonomy by nine rows per launch
/// and nothing else in the tree would notice.
#[cfg(any(test, feature = "test-support"))]
pub fn companion_schema_for_test() -> &'static str {
    COMPANION_SCHEMA
}

#[cfg(any(test, feature = "test-support"))]
pub fn init_test_user_db() -> Result<UserDbPool, AppError> {
    use std::time::Duration;

    sweep_stale_test_dbs();
    let tmp = std::env::temp_dir().join(format!("personas_user_test_{}.db", uuid::Uuid::new_v4()));
    let manager = SqliteConnectionManager::file(&tmp);
    let pool = Pool::builder()
        .max_size(2)
        .connection_timeout(Duration::from_secs(5))
        .connection_customizer(Box::new(SqlitePragmaCustomizer))
        .build(manager)?;
    {
        let conn = pool.get()?;
        conn.execute_batch(KNOWLEDGE_BASE_SCHEMA)?;
        conn.execute_batch(COMPANION_SCHEMA)?;
        // The columns `init_user_db` adds after the CREATE. Same
        // failure-ignoring contract: "duplicate column name" is the success
        // path on a re-run.
        for stmt in &[
            "ALTER TABLE companion_session ADD COLUMN title TEXT;",
            "ALTER TABLE companion_session ADD COLUMN status TEXT NOT NULL DEFAULT 'active';",
            "ALTER TABLE companion_session ADD COLUMN last_read_at TEXT;",
            "ALTER TABLE companion_session ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
            "ALTER TABLE companion_session ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';",
            "ALTER TABLE companion_node ADD COLUMN session_id TEXT;",
            // The sleep cycle's classification tags. Mirrors `init_user_db`'s
            // batch: a test pool missing this column would let every
            // tags-through-the-writers assertion pass against a fixture that
            // does not match production.
            "ALTER TABLE companion_node ADD COLUMN tags_json TEXT;",
        ] {
            let _ = conn.execute_batch(stmt);
        }
    }
    Ok(pool)
}

#[cfg(test)]
mod boot_tests {
    use super::*;

    /// Reopen smoke test for the REAL boot path (`init_db`) — the function the
    /// app calls on every launch. First call simulates a fresh install; the
    /// second call on the same data dir simulates the next app launch on the
    /// existing database, which is the upgrade-on-boot path (migrations::run +
    /// run_incremental replayed, FTS ensure, seeds re-upserted, orphan sweep).
    /// A regression anywhere in that sequence bricks existing user databases,
    /// so this pins: (1) the second init succeeds, and (2) data written in
    /// session 1 survives into session 2.
    #[test]
    fn init_db_second_launch_reopens_and_preserves_data() {
        let data_dir =
            std::env::temp_dir().join(format!("personas_boot_test_{}", uuid::Uuid::new_v4()));

        // -- Session 1: fresh install --------------------------------------
        {
            let pool = init_db(&data_dir, None).expect("first init_db (fresh install) failed");
            repos::core::settings::set(&pool, settings_keys::CLI_ENGINE, "claude_code")
                .expect("writing a settings row in session 1 failed");
        } // pool dropped here — all connections closed, like an app exit

        // -- Session 2: second launch on the same data dir ------------------
        {
            let pool = init_db(&data_dir, None)
                .expect("second init_db on an existing DB failed — the upgrade-on-boot path would brick user databases");

            let value = repos::core::settings::get(&pool, settings_keys::CLI_ENGINE)
                .expect("reading the settings row back in session 2 failed");
            assert_eq!(
                value.as_deref(),
                Some("claude_code"),
                "data written in session 1 was lost across a reopen"
            );

            // The reopen replayed the full migration chain; spot-check that a
            // late incremental artifact is (still) present so this test stays
            // coupled to the migration path and not just file reopening.
            let conn = pool.get().unwrap();
            let spend_table: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dev_llm_spend'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(spend_table, 1, "late-migration table missing after reopen");

            // Builtin seeds must still be present after the second boot's
            // re-upsert (init_db seeds on every launch).
            let connector_defs: i64 = conn
                .query_row("SELECT COUNT(*) FROM connector_definitions", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert!(
                connector_defs > 0,
                "builtin connector seeds missing after reopen"
            );
        }

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// List `*.db` files in a backup dir, sorted ascending (lexicographic ==
    /// chronological for the `personas-<stamp>-<nn>.db` naming scheme).
    fn list_backup_dbs(backup_dir: &Path) -> Vec<PathBuf> {
        let mut dbs: Vec<PathBuf> = std::fs::read_dir(backup_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| p.extension().is_some_and(|x| x == "db"))
                    .collect()
            })
            .unwrap_or_default();
        dbs.sort();
        dbs
    }

    /// The pre-migration safety net: booting on an EXISTING database must
    /// snapshot it into `<data_dir>/backups/` before the migration chain
    /// runs, and the snapshot must itself be an openable SQLite file that
    /// still contains the previous session's data — i.e. it is actually
    /// restorable, not just a file that exists.
    #[test]
    fn init_db_second_launch_backs_up_existing_db_before_migrations() {
        let data_dir =
            std::env::temp_dir().join(format!("personas_boot_test_{}", uuid::Uuid::new_v4()));
        let backup_dir = data_dir.join("backups");

        // -- Session 1: fresh install — no pre-existing DB, so NO backup ----
        {
            let pool = init_db(&data_dir, None).expect("first init_db (fresh install) failed");
            repos::core::settings::set(&pool, settings_keys::CLI_ENGINE, "claude_code")
                .expect("writing a settings row in session 1 failed");
        }
        assert!(
            !backup_dir.exists(),
            "fresh install must not create a backup dir"
        );

        // -- Session 2: boot on the existing DB — exactly one backup --------
        {
            let _pool = init_db(&data_dir, None).expect("second init_db failed");
        }
        let backups = list_backup_dbs(&backup_dir);
        assert_eq!(
            backups.len(),
            1,
            "second launch must create exactly one backup, found: {backups:?}"
        );
        let name = backups[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(
            name.starts_with("personas-") && name.ends_with(".db"),
            "unexpected backup file name: {name}"
        );

        // The snapshot was taken BEFORE session 2's migrations touched the
        // file, and it must hold session 1's data.
        let conn = rusqlite::Connection::open(&backups[0])
            .expect("backup is not an openable SQLite database");
        let value: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![settings_keys::CLI_ENGINE],
                |r| r.get(0),
            )
            .expect("session-1 settings row missing from the backup");
        assert_eq!(value, "claude_code", "backup does not carry session-1 data");
        drop(conn);

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// Fresh create must make NO backup: there is no user data to protect,
    /// and an empty `backups/` dir on a brand-new install would be litter.
    #[test]
    fn init_db_fresh_create_makes_no_backup() {
        let data_dir =
            std::env::temp_dir().join(format!("personas_boot_test_{}", uuid::Uuid::new_v4()));
        {
            let _pool = init_db(&data_dir, None).expect("fresh init_db failed");
        }
        assert!(
            !data_dir.join("backups").exists(),
            "fresh install must not create any backup"
        );
        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// Rotation: only the newest 3 backup sets survive, and WAL/SHM siblings
    /// of rotated-out sets are deleted with them. Exercises the helper
    /// directly (a dummy file stands in for the DB — the copy path doesn't
    /// parse SQLite) so five "boots" don't need five full migration replays.
    #[test]
    fn backup_rotation_keeps_only_newest_three() {
        let data_dir =
            std::env::temp_dir().join(format!("personas_boot_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&data_dir).unwrap();
        let db_path = data_dir.join("personas.db");
        std::fs::write(&db_path, b"stand-in db bytes").unwrap();
        // Sidecar present → every backup set gets a -wal sibling too.
        std::fs::write(sidecar_path(&db_path, "-wal"), b"wal bytes").unwrap();

        let mut created: Vec<PathBuf> = Vec::new();
        for _ in 0..5 {
            created.push(
                backup::backup_before_migrations(&data_dir, &db_path)
                    .expect("backup helper returned None for an existing DB"),
            );
        }

        let backup_dir = data_dir.join("backups");
        let survivors = list_backup_dbs(&backup_dir);
        assert_eq!(
            survivors.len(),
            3,
            "rotation must keep exactly 3 backups, found: {survivors:?}"
        );
        // The survivors are the three NEWEST (creation order == name order).
        assert_eq!(
            survivors,
            created[2..].to_vec(),
            "rotation kept the wrong backups"
        );

        for old in &created[..2] {
            assert!(!old.exists(), "rotated-out backup still on disk: {old:?}");
            assert!(
                !sidecar_path(old, "-wal").exists(),
                "rotated-out backup left its WAL sibling behind: {old:?}"
            );
        }
        for kept in &created[2..] {
            assert!(kept.exists(), "surviving backup missing: {kept:?}");
            assert!(
                sidecar_path(kept, "-wal").exists(),
                "surviving backup missing its WAL sibling: {kept:?}"
            );
        }

        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// The sidecar names come from SQLite's rule (append to the FULL file
    /// name), not from the path library's extension swap. A store named
    /// without the conventional `.db` is where the two diverge, so that is
    /// the case this test pins: open under WAL, write, and assert the
    /// constructed path is the file SQLite actually created.
    #[test]
    fn sidecar_path_matches_what_sqlite_writes() {
        let dir =
            std::env::temp_dir().join(format!("personas_sidecar_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["store", "data.sqlite", "personas.db"] {
            let db_path = dir.join(name);
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "PRAGMA journal_mode = WAL; CREATE TABLE t(x); INSERT INTO t VALUES (1);",
            )
            .unwrap();
            let wal = sidecar_path(&db_path, "-wal");
            assert!(
                wal.exists(),
                "SQLite wrote no sidecar at the constructed path {wal:?}"
            );
            assert_eq!(
                wal.file_name().unwrap().to_str().unwrap(),
                format!("{name}-wal")
            );
            drop(conn);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// [`ensure_executions_fts`] runs on every production boot and, until now, had
/// no test anywhere in the crate — `init_test_db` never calls it, so the
/// backfill it exists for had never actually been executed by a test.
///
/// NOTE (out of scope, recorded so it is not lost): `init_test_db` also differs
/// from `init_db` by never setting `journal_mode = WAL` and never registering
/// the CDC/journal connection customizer. Those are separate fidelity gaps
/// between the test fixture and the real boot path.
#[cfg(test)]
mod executions_fts_tests {
    use super::*;

    fn insert_persona(conn: &rusqlite::Connection) {
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at) \
             VALUES ('p1', 'p', 'sp', datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert persona");
    }

    fn insert_execution(conn: &rusqlite::Connection, id: &str, input: &str) {
        conn.execute(
            "INSERT INTO persona_executions (id, persona_id, status, input_data, created_at) \
             VALUES (?1, 'p1', 'completed', ?2, datetime('now'))",
            params![id, input],
        )
        .expect("insert execution");
    }

    /// Put the database in the ONLY state `ensure_executions_fts` exists to
    /// repair: rows in the content table, nothing in the index. That is what a
    /// database that predates the `executions_fts` migration looks like, and a
    /// test reaches it by dropping the sync triggers before inserting.
    fn seed_unindexed_executions(conn: &rusqlite::Connection, rows: &[(&str, &str)]) {
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS executions_fts_ai;
             DROP TRIGGER IF EXISTS executions_fts_ad;
             DROP TRIGGER IF EXISTS executions_fts_au;",
        )
        .expect("drop the fts sync triggers");
        insert_persona(conn);
        for (id, input) in rows {
            insert_execution(conn, id, input);
        }
    }

    /// Search the way the app does — through the index, not through a COUNT
    /// that an external-content FTS5 table may satisfy from its content table.
    fn matches(conn: &rusqlite::Connection, term: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM executions_fts WHERE executions_fts MATCH ?1",
            params![term],
            |r| r.get(0),
        )
        .expect("fts match query")
    }

    #[test]
    fn ensure_executions_fts_is_a_noop_on_a_fresh_database() {
        let pool = init_test_db().expect("init_test_db");
        let conn = pool.get().expect("pool.get");

        ensure_executions_fts(&conn).expect("fresh database with zero executions");
        assert_eq!(matches(&conn, "anything"), 0);

        // Boot runs it on every launch, so a fresh DB must tolerate repeats.
        ensure_executions_fts(&conn).expect("second call on a fresh database");
        assert_eq!(matches(&conn, "anything"), 0);
    }

    #[test]
    fn ensure_executions_fts_backfills_rows_the_index_never_saw() {
        let pool = init_test_db().expect("init_test_db");
        let conn = pool.get().expect("pool.get");
        seed_unindexed_executions(
            &conn,
            &[("e1", "deploy the widget"), ("e2", "widget teardown")],
        );

        assert_eq!(
            matches(&conn, "widget"),
            0,
            "precondition: the index must start out empty",
        );
        let reported_fts_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM executions_fts", [], |r| r.get(0))
            .unwrap();

        ensure_executions_fts(&conn).expect("backfill");

        assert_eq!(
            matches(&conn, "widget"),
            2,
            "every pre-existing execution must be searchable after the backfill. \
             `SELECT COUNT(*) FROM executions_fts` reported {reported_fts_rows} before the \
             call — if that already equalled the execution count, the \
             `fts_count < execution_count` guard skipped the rebuild and the backfill is \
             unreachable in production",
        );
    }

    #[test]
    fn ensure_executions_fts_re_run_does_not_duplicate_index_entries() {
        let pool = init_test_db().expect("init_test_db");
        let conn = pool.get().expect("pool.get");
        seed_unindexed_executions(
            &conn,
            &[("e1", "deploy the widget"), ("e2", "widget teardown")],
        );

        ensure_executions_fts(&conn).expect("first backfill");
        let after_first = matches(&conn, "widget");
        assert_eq!(
            after_first, 2,
            "precondition: the backfill indexed both rows"
        );

        // The real boot path calls this on every launch.
        ensure_executions_fts(&conn).expect("second call");
        ensure_executions_fts(&conn).expect("third call");

        assert_eq!(
            matches(&conn, "widget"),
            after_first,
            "re-running the backfill must not duplicate index entries",
        );
        assert!(
            executions_fts_drift(&conn).is_none(),
            "a rebuilt index must read as in-sync, or every launch rebuilds it again",
        );
        let hits: Vec<i64> = {
            let mut stmt = conn
                .prepare(
                    "SELECT rowid FROM executions_fts WHERE executions_fts MATCH 'widget' \
                     ORDER BY rowid",
                )
                .unwrap();
            let rows = stmt.query_map([], |r| r.get(0)).unwrap();
            rows.collect::<Result<Vec<_>, _>>().unwrap()
        };
        let mut deduped = hits.clone();
        deduped.dedup();
        assert_eq!(hits, deduped, "the index returned the same rowid twice");
    }

    /// A healthy database must NOT read as drifted, or `init_db` re-tokenizes
    /// the entire execution history on every single launch. Includes an
    /// execution whose indexed columns are all NULL — FTS5 still owes it a
    /// `%_docsize` row, and if it did not, the drift check would be permanently
    /// true on any database that has ever queued an execution.
    #[test]
    fn a_trigger_synced_database_does_not_read_as_drifted() {
        let pool = init_test_db().expect("init_test_db");
        let conn = pool.get().expect("pool.get");
        insert_persona(&conn);
        insert_execution(&conn, "e1", "deploy the widget");
        conn.execute(
            "INSERT INTO persona_executions (id, persona_id, status, created_at) \
             VALUES ('e2', 'p1', 'queued', datetime('now'))",
            [],
        )
        .expect("insert an execution with no indexable text at all");

        assert!(
            executions_fts_drift(&conn).is_none(),
            "the sync triggers keep the index current; a healthy DB must not be rebuilt \
             on every launch (drift = {:?})",
            executions_fts_drift(&conn),
        );
        ensure_executions_fts(&conn).expect("no-op on a healthy database");
        assert_eq!(matches(&conn, "widget"), 1);
    }

    /// The mirror of a missing backfill: entries for executions that no longer
    /// exist. `SELECT COUNT(*) FROM executions_fts` could never see this either,
    /// and the old `<` comparison would have ignored it even if it could —
    /// leaving execution search returning hits for rows the user deleted.
    #[test]
    fn ensure_executions_fts_clears_index_entries_for_deleted_executions() {
        let pool = init_test_db().expect("init_test_db");
        let conn = pool.get().expect("pool.get");
        insert_persona(&conn);
        insert_execution(&conn, "e1", "deploy the widget");
        insert_execution(&conn, "e2", "widget teardown");
        assert_eq!(matches(&conn, "widget"), 2, "precondition: both indexed");

        // Delete one WITHOUT the delete trigger, stranding its index entry.
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS executions_fts_ad;
             DELETE FROM persona_executions WHERE id = 'e2';",
        )
        .expect("strand an index entry");
        assert_eq!(
            matches(&conn, "widget"),
            2,
            "precondition: the index still returns the deleted execution",
        );

        ensure_executions_fts(&conn).expect("repair");

        assert_eq!(
            matches(&conn, "widget"),
            1,
            "search must stop returning executions that no longer exist",
        );
    }
}

#[cfg(test)]
mod test_db_sweep_tests {
    use super::*;

    /// THE LEAK THIS SWEEP EXISTS FOR.
    ///
    /// Measured in `%TEMP%` on 2026-08-25: **15,669 `personas_test_*.db`,
    /// 70 GB, every one of them written in the preceding five days** — because
    /// `init_test_db` copies a migrated template per call and nothing ever
    /// removed it. It was the largest reclaimable item on a 952 GB volume that
    /// had just hit zero bytes free, and bigger than every repository on the
    /// machine except one.
    ///
    /// Both halves of the contract are asserted here, and the second matters as
    /// much as the first: a stale file IS reclaimed, and a fresh one is NOT —
    /// because a sweep that deleted a database a running test still held would
    /// trade a disk problem for a flaky-test problem, which is the worse of the
    /// two failures.
    #[test]
    fn stale_test_dbs_are_reclaimed_and_live_ones_are_spared() {
        use std::io::Write;

        let dir = std::env::temp_dir();
        let tag = uuid::Uuid::new_v4();
        let stale = dir.join(format!("personas_test_sweepcase_{tag}_stale.db"));
        let fresh = dir.join(format!("personas_test_sweepcase_{tag}_fresh.db"));
        for p in [&stale, &fresh] {
            let mut f = std::fs::File::create(p).expect("create fixture");
            f.write_all(b"not a real database").expect("write fixture");
        }

        // Backdate one past the threshold — the only way to age a file without
        // sleeping for an hour inside a unit test.
        let old = std::time::SystemTime::now() - (TEST_DB_STALE_AFTER * 2);
        std::fs::File::options()
            .write(true)
            .open(&stale)
            .expect("reopen")
            .set_times(std::fs::FileTimes::new().set_modified(old))
            .expect("backdate");

        run_test_db_sweep();

        assert!(
            !stale.exists(),
            "a database untouched for twice the staleness window must be reclaimed"
        );
        assert!(
            fresh.exists(),
            "a just-written database may belong to a RUNNING test and must be spared"
        );

        let _ = std::fs::remove_file(&fresh);
    }

    /// The prefix list is the sweep's whole reach: a file it does not match is a
    /// file it can never reclaim. Both constructors in this crate must be
    /// covered, so that adding a third and forgetting the prefix fails here
    /// rather than silently leaking a new family of files.
    #[test]
    fn both_test_db_constructors_are_covered_by_a_prefix() {
        for name in [
            "personas_test_00000000-0000-0000-0000-000000000000.db",
            "personas_user_test_00000000-0000-0000-0000-000000000000.db",
        ] {
            assert!(
                TEST_DB_PREFIXES.iter().any(|p| name.starts_with(p)),
                "{name} is written by a constructor in this file but no swept prefix matches it"
            );
        }
    }
}
