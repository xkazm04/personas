//! Corruption-class response for the primary store (`personas.db`).
//!
//! `personas.db` is local-first: there is no server-side replica, so the file
//! on the operator's machine is the only copy. Until this module, the whole
//! recovery story was [`crate::backup`] — a pre-migration snapshot rotated at
//! three sets. Three slots is enough for a bad migration, which is what that
//! module was written for. It is **not** enough for slow structural damage: a
//! handle that keeps writing to a damaged file for one session and then boots
//! three more times has rotated every good copy out of existence before anyone
//! noticed.
//!
//! The rule this module adds is that **the corruption class decides the
//! response**, and the class is knowable from the error at the moment it is
//! raised:
//!
//! - **Derived** damage — a search index, anything rebuildable from rows we
//!   still hold — *detaches*. The stale marker goes into `app_settings`, the
//!   sync triggers are dropped, and the canonical write is retried without the
//!   index sinks. A live write NEVER starts a rebuild; rebuild ownership stays
//!   at boot, in [`crate::ensure_executions_fts`].
//! - **Canonical** damage — the record trees, the schema, the free list —
//!   *quarantines the store*. Every pooled connection comes back
//!   `query_only`, so every write on every one of the ~1,350 call sites fails
//!   at the engine rather than at a call site somebody remembered to edit; the
//!   close-time checkpoint is disabled; and [`crate::backup`] stops rotating,
//!   so a damaged-but-readable file cannot eat its own history.
//!
//! ## Why the close-time checkpoint is refused
//!
//! Folding WAL frames into the main file is the tidy thing to do at close, and
//! on a store with damaged canonical structure it is the single write with the
//! widest blast radius: it rewrites pages across the whole file using the very
//! metadata that is suspect. An intact `-wal` sidecar is forensic evidence and
//! often the recoverable half. The skip is reachable ONLY from the quarantine
//! path — see [`harden_connection`] — so the periodic
//! `wal_checkpoint(TRUNCATE)` on healthy installs is untouched.
//!
//! ## Classification is not string matching
//!
//! The split is made on SQLite's **extended result code**, not on the message.
//! `SQLITE_CORRUPT_VTAB` (267) is raised when a virtual table reports its own
//! backing store is malformed; every virtual table in this schema is derived
//! (`executions_fts`, `kb_chunks_fts`, the vec0 tables). A bare
//! `SQLITE_CORRUPT` / `SQLITE_NOTADB` with no derived provenance is canonical.
//! No branch here reads the error text, so a SQLite version that rewords a
//! message cannot silently change the policy.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use personas_core::error::AppError;
use rusqlite::Connection;

use crate::settings_keys;

/// Sidecar suffix of the durable quarantine marker.
///
/// A file, deliberately — the marker has to be readable by
/// [`crate::backup::backup_before_migrations`], which runs BEFORE any
/// connection opens the store, precisely so it can protect a file that may not
/// open at all. A flag stored inside the damaged database is unreadable exactly
/// when it matters.
const QUARANTINE_SUFFIX: &str = ".quarantine";

/// The three `executions_fts` synchronisation triggers, dropped on a derived
/// detach so the canonical write can be retried without the index sinks.
const FTS_SYNC_TRIGGERS: [&str; 3] = [
    "executions_fts_ai",
    "executions_fts_ad",
    "executions_fts_au",
];

/// Closed three-way verdict on a `rusqlite::Error`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageClass {
    /// Not a corruption report at all — a constraint, a busy timeout, a typo.
    Unrelated,
    /// Damage confined to a rebuildable structure. Detach, keep writing.
    Derived,
    /// Damage in canonical structure. Quarantine, stop writing.
    Canonical,
}

/// What the failing operation was working on, as declared by its caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provenance {
    /// The statement touches canonical tables (possibly *also* reaching a
    /// derived sink through a trigger). Only an explicit vtab-scoped corruption
    /// code reads as derived here; anything else is canonical, because absent
    /// provenance the dangerous reading is the correct default.
    Ambiguous,
    /// The statement is entirely against a derived object — an FTS rebuild, a
    /// shadow-table maintenance pass. Any corruption report is derived damage.
    DerivedOnly,
}

/// What a quarantined store records about why it stopped.
#[derive(Debug, Clone)]
pub struct QuarantineReport {
    pub reason: String,
    pub detected_at: String,
}

/// Quarantined stores, keyed by normalised path. Keyed rather than a single
/// process-wide flag so `personas.db` going out never silences
/// `personas_data.db` — and so a test that quarantines a fixture cannot poison
/// every other test sharing the process.
fn quarantined() -> &'static Mutex<HashMap<String, QuarantineReport>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, QuarantineReport>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Fast path for the pool's per-acquire pragma batch: nothing is quarantined
/// until something is, and the lookup below costs a `canonicalize` syscall.
/// Set once and never cleared during a quarantine, so a `false` here is an
/// exact answer, not an optimistic one.
static ANY_QUARANTINE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Case- and symlink-insensitive key for a store path. Both sides of every
/// comparison go through this: our own `app_data_dir.join("personas.db")` and
/// whatever absolute path SQLite reports back from `Connection::path`.
fn key(db_path: &Path) -> String {
    std::fs::canonicalize(db_path)
        .unwrap_or_else(|_| db_path.to_path_buf())
        .to_string_lossy()
        .to_lowercase()
}

/// Turn a `rusqlite::Error` into a closed verdict. This is the whole design;
/// everything else follows from it.
pub fn classify(err: &rusqlite::Error, provenance: Provenance) -> DamageClass {
    let rusqlite::Error::SqliteFailure(ffi_err, _) = err else {
        return DamageClass::Unrelated;
    };
    let corrupt = matches!(
        ffi_err.code,
        rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase
    );
    if !corrupt {
        return DamageClass::Unrelated;
    }
    // `SQLITE_CORRUPT_VTAB` is the virtual-table module's own report that its
    // backing store is malformed. Every vtab in this schema is derived.
    if provenance == Provenance::DerivedOnly
        || ffi_err.extended_code == rusqlite::ffi::SQLITE_CORRUPT_VTAB
    {
        return DamageClass::Derived;
    }
    DamageClass::Canonical
}

/// Path of the durable quarantine marker for `db_path`.
pub fn marker_path(db_path: &Path) -> PathBuf {
    crate::sidecar_path(db_path, QUARANTINE_SUFFIX)
}

/// Did the PREVIOUS session end with this store quarantined? Read at boot by
/// [`crate::backup`], before any connection opens the file.
pub fn previous_session_quarantined(db_path: &Path) -> bool {
    marker_path(db_path).exists()
}

/// Is this store quarantined in THIS process?
pub fn is_quarantined(db_path: &Path) -> bool {
    quarantine_status(db_path).is_some()
}

/// The incident record for a quarantined store, for an operator-facing
/// surface to render. A typed value, so no caller has to re-derive the verdict
/// by matching an error message.
pub fn quarantine_status(db_path: &Path) -> Option<QuarantineReport> {
    if !ANY_QUARANTINE.load(std::sync::atomic::Ordering::Relaxed) {
        return None;
    }
    quarantined().lock().ok()?.get(&key(db_path)).cloned()
}

/// Whether the connection's own database is quarantined. Used by the pool's
/// pragma path, which has a connection and no path.
pub(crate) fn is_connection_quarantined(conn: &Connection) -> bool {
    conn.path()
        .map(|p| is_quarantined(Path::new(p)))
        .unwrap_or(false)
}

/// Declare `db_path` quarantined: record the incident in-process, drop the
/// durable marker so the next boot's backup pass will not rotate, and return
/// the typed error the failing write should propagate.
///
/// Nothing is retried, nothing is repaired. Stopping the writes IS the
/// protection; restoring a backup stays a deliberate, surfaced act.
pub fn quarantine(db_path: &Path, reason: impl Into<String>) -> AppError {
    let report = QuarantineReport {
        reason: reason.into(),
        detected_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Ok(mut map) = quarantined().lock() {
        map.entry(key(db_path)).or_insert_with(|| report.clone());
        ANY_QUARANTINE.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    // Best-effort: a marker we could not write costs the cross-boot half of
    // the policy, not the in-process half. Never block on it.
    if let Err(e) = std::fs::write(
        marker_path(db_path),
        format!("{}\n{}\n", report.detected_at, report.reason),
    ) {
        tracing::warn!(
            path = %marker_path(db_path).display(),
            error = %e,
            "Could not write the store quarantine marker — backup rotation will NOT be held across the next boot"
        );
    }
    tracing::error!(
        db = %db_path.display(),
        reason = %report.reason,
        "Store QUARANTINED — writes refused, WAL checkpoint on close disabled, backup rotation held"
    );
    refuse_write(&report.reason)
}

/// Clear the quarantine for `db_path`. Deliberately has no automatic caller:
/// the operator restores or repairs the file and then clears the state. An
/// automatic clear would resume backup rotation over a file nobody has
/// actually fixed.
pub fn clear_quarantine(db_path: &Path) -> std::io::Result<()> {
    if let Ok(mut map) = quarantined().lock() {
        map.remove(&key(db_path));
        ANY_QUARANTINE.store(!map.is_empty(), std::sync::atomic::Ordering::Relaxed);
    }
    match std::fs::remove_file(marker_path(db_path)) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// The typed error a refused write propagates. `AppError::Database` carries a
/// real `SQLITE_CORRUPT` failure — kind `database`, category `ApiError`,
/// path-sanitised on the way out — because the store genuinely is corrupt.
/// A surface that needs the *class* calls [`quarantine_status`] rather than
/// reading this message.
pub fn refuse_write(reason: &str) -> AppError {
    AppError::Database(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
        Some(format!("store is quarantined: {reason}")),
    ))
}

/// Apply the quarantine posture to one connection: refuse every write at the
/// engine, and disable SQLite's own last-connection checkpoint.
///
/// `PRAGMA query_only` is what makes the refusal total. There are ~1,350
/// `pool.get()` sites in this tree; a guard that had to be added to each one
/// would be a guard with a long tail of sites that never got it. Reads stay
/// available on purpose — quarantine has to be a recoverable state, which
/// means the operator can still read and export while the file is out.
pub(crate) fn harden_connection(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.set_db_config(
        rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE,
        true,
    )?;
    conn.execute_batch("PRAGMA query_only = ON;")?;
    Ok(())
}

/// Cheap structural check, run at open and in the idle quiet window.
///
/// `quick_check` rather than `integrity_check`: it verifies page and B-tree
/// structure — exactly the canonical class this policy quarantines for — and
/// skips the index-content verification that makes `integrity_check` O(index)
/// and unfit for the boot path of a 331 MiB store. The work `quick_check`
/// omits is by definition about rebuildable structures, which is the class that
/// detaches rather than quarantines.
///
/// Returns [`DamageClass::Canonical`] on a failed check, including when the
/// check statement itself cannot run because the file is not a database.
pub(crate) fn check_at_open(conn: &Connection) -> DamageClass {
    match conn.query_row("PRAGMA quick_check(1)", [], |r| {
        r.get::<_, String>("quick_check")
    }) {
        Ok(verdict) if verdict.eq_ignore_ascii_case("ok") => DamageClass::Unrelated,
        Ok(verdict) => {
            tracing::error!(verdict = %verdict, "PRAGMA quick_check reported structural damage");
            DamageClass::Canonical
        }
        Err(e) => {
            let class = classify(&e, Provenance::Ambiguous);
            if class == DamageClass::Unrelated {
                // The check could not run for a reason that is not damage
                // (locked, out of memory). Absence of a verdict is not a
                // verdict; do not quarantine on it.
                tracing::warn!(error = %e, "PRAGMA quick_check could not run — no damage verdict");
                return DamageClass::Unrelated;
            }
            tracing::error!(error = %e, "PRAGMA quick_check failed with a corruption report");
            DamageClass::Canonical
        }
    }
}

/// Detach the `executions_fts` index: record the durable stale marker and drop
/// the synchronisation triggers, in one transaction, so the canonical write can
/// be retried without the index sinks.
///
/// The marker is durable and readable through `repos::core::settings::get`, so
/// a search surface can label a degraded answer as degraded instead of quietly
/// returning fewer rows.
pub(crate) fn detach_derived_index(conn: &Connection, reason: &str) -> Result<(), rusqlite::Error> {
    let mut batch = String::from("BEGIN IMMEDIATE;");
    for trigger in FTS_SYNC_TRIGGERS {
        batch.push_str(&format!("DROP TRIGGER IF EXISTS {trigger};"));
    }
    batch.push_str("COMMIT;");
    conn.execute_batch(&batch)?;
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![settings_keys::EXECUTIONS_FTS_STALE, "1"],
    )?;
    tracing::warn!(
        reason,
        "executions_fts DETACHED — sync triggers dropped, index marked stale; canonical writes continue"
    );
    Ok(())
}

/// Is the executions search index currently detached?
pub fn fts_detached(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        rusqlite::params![settings_keys::EXECUTIONS_FTS_STALE],
        |r| r.get::<_, String>("value"),
    )
    .map(|v| v == "1")
    .unwrap_or(false)
}

/// Run a write and respond to corruption **by class**.
///
/// On a derived verdict: detach the index and retry `op` once, without the
/// sinks. On a canonical verdict: quarantine and propagate typed, retrying
/// nothing. On anything else the error passes through untouched.
///
/// `op` must be idempotent enough to survive one retry — the retry runs only
/// after a failure that rolled the statement back.
///
/// **A live operation never triggers a rebuild.** Rebuild ownership stays at
/// boot, in [`crate::ensure_executions_fts`], which is the right moment; this
/// helper only ever *drops* the sinks.
pub(crate) fn guarded_write<T, F>(
    conn: &Connection,
    provenance: Provenance,
    label: &str,
    mut op: F,
) -> Result<T, AppError>
where
    F: FnMut(&Connection) -> Result<T, rusqlite::Error>,
{
    if is_connection_quarantined(conn) {
        return Err(refuse_write(label));
    }
    let err = match op(conn) {
        Ok(value) => return Ok(value),
        Err(e) => e,
    };
    match classify(&err, provenance) {
        DamageClass::Derived => {
            let reason = format!("{label}: {err}");
            detach_derived_index(conn, &reason).map_err(AppError::Database)?;
            op(conn).map_err(AppError::Database)
        }
        DamageClass::Canonical => {
            let db_path = conn.path().map(PathBuf::from);
            let reason = format!("{label}: {err}");
            match db_path {
                Some(path) => {
                    let refusal = quarantine(&path, reason);
                    // Poison this connection immediately: `on_acquire` covers
                    // every LATER checkout, but the one in hand is already out.
                    let _ = harden_connection(conn);
                    Err(refusal)
                }
                None => Err(AppError::Database(err)),
            }
        }
        DamageClass::Unrelated => Err(AppError::Database(err)),
    }
}

#[cfg(test)]
mod tests {
    /// The 16-byte magic string that opens every SQLite file. Overwriting exactly
    /// that is the smallest damage that makes the file "not a database" to the
    /// engine, which is the class the quarantine must catch at open.
    const SQLITE_MAGIC_LEN: usize = 16;

    use super::*;
    use crate::PoolExt;

    fn corrupt_error(extended: i32) -> rusqlite::Error {
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(extended), None)
    }

    #[test]
    fn classification_splits_on_the_extended_code_not_the_message() {
        // A vtab-scoped corruption report is derived damage even when the
        // caller could not say where the statement was working.
        assert_eq!(
            classify(
                &corrupt_error(rusqlite::ffi::SQLITE_CORRUPT_VTAB),
                Provenance::Ambiguous
            ),
            DamageClass::Derived
        );
        // A bare structural report with no derived provenance is canonical —
        // the dangerous reading is the default.
        assert_eq!(
            classify(
                &corrupt_error(rusqlite::ffi::SQLITE_CORRUPT),
                Provenance::Ambiguous
            ),
            DamageClass::Canonical
        );
        assert_eq!(
            classify(
                &corrupt_error(rusqlite::ffi::SQLITE_NOTADB),
                Provenance::Ambiguous
            ),
            DamageClass::Canonical
        );
        // A statement working only against a derived object reads every
        // corruption report as derived.
        assert_eq!(
            classify(
                &corrupt_error(rusqlite::ffi::SQLITE_CORRUPT),
                Provenance::DerivedOnly
            ),
            DamageClass::Derived
        );
        // Everything that is not a corruption report is Unrelated, whichever
        // provenance the caller declared.
        for provenance in [Provenance::Ambiguous, Provenance::DerivedOnly] {
            assert_eq!(
                classify(&corrupt_error(rusqlite::ffi::SQLITE_BUSY), provenance),
                DamageClass::Unrelated
            );
            assert_eq!(
                classify(&rusqlite::Error::QueryReturnedNoRows, provenance),
                DamageClass::Unrelated
            );
        }
    }

    /// Damage the FTS5 structure record (`%_data` rowid 10). The shadow table
    /// is an ordinary table, so this is a deterministic, hermetic way to make
    /// FTS5 — and only FTS5 — report that its backing store is malformed.
    fn damage_the_search_index(conn: &Connection) {
        conn.execute(
            "UPDATE executions_fts_data SET block = randomblob(64) WHERE id = 10",
            [],
        )
        .expect("the FTS5 shadow table is writable");
    }

    fn seed_persona_and_execution(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES ('p-damage', 'damage', 'x', datetime('now'), datetime('now'))
             ON CONFLICT(id) DO NOTHING",
            [],
        )
        .expect("seed persona");
        conn.execute(
            "INSERT INTO persona_executions (id, persona_id, status, input_data, created_at)
             VALUES (?1, 'p-damage', 'queued', 'needle haystack', datetime('now'))",
            rusqlite::params![id],
        )
        .expect("seed execution");
    }

    #[test]
    fn derived_damage_detaches_and_the_canonical_write_survives() {
        let pool = crate::init_test_db().expect("init_test_db");
        let conn = pool.conn("damage::derived_test").expect("conn");
        seed_persona_and_execution(&conn, "e-before");
        damage_the_search_index(&conn);

        // Sanity: the damage is real — a write through the FTS sink fails.
        let raw = conn.execute(
            "INSERT INTO persona_executions (id, persona_id, status, input_data, created_at)
             VALUES ('e-raw', 'p-damage', 'queued', 'needle', datetime('now'))",
            [],
        );
        let raw_err = raw.expect_err("the damaged index must make the sink write fail");
        assert_eq!(
            classify(&raw_err, Provenance::Ambiguous),
            DamageClass::Derived,
            "FTS5 must report SQLITE_CORRUPT_VTAB, not a bare corruption: {raw_err}"
        );

        // The policy response: detach, retry, canonical row lands.
        let written = guarded_write(&conn, Provenance::Ambiguous, "test::insert", |c| {
            c.execute(
                "INSERT INTO persona_executions (id, persona_id, status, input_data, created_at)
                 VALUES ('e-after', 'p-damage', 'queued', 'needle', datetime('now'))",
                [],
            )
        })
        .expect("a derived-damage verdict must NOT stop the canonical write");
        assert_eq!(written, 1);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) AS n FROM persona_executions WHERE id = 'e-after'",
                [],
                |r| r.get("n"),
            )
            .expect("count");
        assert_eq!(count, 1, "the canonical row must be durable after detach");

        assert!(fts_detached(&conn), "the stale marker must be durable");
        let triggers: i64 = conn
            .query_row(
                "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'executions_fts%'",
                [],
                |r| r.get("n"),
            )
            .expect("count triggers");
        assert_eq!(triggers, 0, "the sync triggers must be dropped by a detach");

        // The invariant the whole module protects: no live rebuild.
        assert!(
            !is_quarantined(Path::new(conn.path().unwrap())),
            "derived damage must never quarantine the store"
        );
    }

    /// Build a structurally damaged COPY of a real store. The bytes go into the
    /// header magic, which is the one place SQLite is guaranteed to read first
    /// and to reject — a deterministic canonical fault, no page-layout guessing.
    fn structurally_damaged_copy() -> PathBuf {
        let pool = crate::init_test_db().expect("init_test_db");
        let source = {
            let conn = pool.conn("damage::copy_source").expect("conn");
            PathBuf::from(conn.path().expect("a file-backed test database"))
        };
        drop(pool);
        let victim =
            std::env::temp_dir().join(format!("personas_test_damaged_{}.db", uuid::Uuid::new_v4()));
        std::fs::copy(&source, &victim).expect("copy the store before damaging it");
        let mut bytes = std::fs::read(&victim).expect("read the copy");
        for b in bytes.iter_mut().take(SQLITE_MAGIC_LEN) {
            *b = 0xFF;
        }
        std::fs::write(&victim, &bytes).expect("write the damaged copy");
        victim
    }

    #[test]
    fn canonical_damage_quarantines_and_stops_every_write() {
        let victim = structurally_damaged_copy();
        let conn = Connection::open(&victim).expect("open still succeeds — the read happens later");
        assert_eq!(
            check_at_open(&conn),
            DamageClass::Canonical,
            "the integrity check at open must return a canonical verdict"
        );

        let refusal = quarantine(&victim, "test: structural damage");
        assert!(
            matches!(refusal, AppError::Database(_)),
            "a refused write must propagate typed, not as a bare string"
        );
        assert!(is_quarantined(&victim));
        assert!(
            marker_path(&victim).exists(),
            "the durable marker is what holds backup rotation across the next boot"
        );
        assert!(
            previous_session_quarantined(&victim),
            "the next boot must be able to read the marker without opening the store"
        );

        // Every later write on the handle fails immediately, without touching
        // the file — and the close-time checkpoint is off.
        harden_connection(&conn).expect("harden");
        let write = conn.execute(
            "CREATE TEMP TABLE quarantine_probe (x INTEGER NOT NULL)",
            [],
        );
        assert!(
            write.is_err(),
            "a quarantined store must refuse writes at the engine, not at a call site"
        );
        assert!(
            conn.db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE)
                .expect("read the checkpoint-on-close switch"),
            "the close-time checkpoint must be refused on a quarantined store"
        );

        // guarded_write refuses before it reaches the file at all.
        let refused: Result<usize, AppError> =
            guarded_write(&conn, Provenance::Ambiguous, "test::write", |c| {
                c.execute("CREATE TEMP TABLE never (x INTEGER NOT NULL)", [])
            });
        assert!(
            refused.is_err(),
            "guarded_write must refuse on a quarantined store"
        );

        clear_quarantine(&victim).expect("clear");
        assert!(!is_quarantined(&victim));
        assert!(!marker_path(&victim).exists());
        drop(conn);
        let _ = std::fs::remove_file(&victim);
    }

    #[test]
    fn a_healthy_store_passes_the_check_and_is_never_quarantined() {
        // The positive control: without it, both tests above would still pass
        // against a check that returns Canonical unconditionally.
        let pool = crate::init_test_db().expect("init_test_db");
        let conn = pool.conn("damage::healthy").expect("conn");
        assert_eq!(check_at_open(&conn), DamageClass::Unrelated);
        assert!(!is_connection_quarantined(&conn));
        assert!(!fts_detached(&conn));
    }
}
