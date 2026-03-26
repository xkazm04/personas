#[macro_use]
pub mod macros;
#[allow(dead_code)] // Functions used by Tauri commands in Phase 3
pub mod migrations;
#[allow(dead_code)]
pub mod models;
#[allow(dead_code)]
pub mod repos;
pub mod settings_keys;
mod builtin_connectors;

use r2d2::{CustomizeConnection, Pool};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use std::path::{Path, PathBuf};

use crate::error::AppError;

pub type DbPool = Pool<SqliteConnectionManager>;

/// Separate connection pool for the user-facing database (`personas_data.db`).
/// This is completely isolated from the internal app database to prevent
/// user queries from corrupting app state.
pub type UserDbPool = Pool<SqliteConnectionManager>;

/// Connection customizer that sets per-connection SQLite pragmas.
#[derive(Debug)]
struct SqlitePragmaCustomizer;

impl CustomizeConnection<rusqlite::Connection, rusqlite::Error> for SqlitePragmaCustomizer {
    fn on_acquire(&self, conn: &mut rusqlite::Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -2000;",
        )?;
        Ok(())
    }
}

/// Initialize the database: create file, enable WAL + foreign keys, run migrations, seed data.
pub fn init_db(app_data_dir: &PathBuf) -> Result<DbPool, AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    restrict_dir_permissions(app_data_dir);
    let db_path = app_data_dir.join("personas.db");

    tracing::info!(path = %db_path.display(), "Initializing database");

    let manager = SqliteConnectionManager::file(&db_path);
    let pool = Pool::builder()
        .max_size(4)
        .connection_customizer(Box::new(SqlitePragmaCustomizer))
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

    // Seed builtin data
    {
        let conn = pool.get()?;
        seed_builtin_tools(&conn)?;
        seed_builtin_connectors(&conn)?;
    }

    tracing::info!("Database initialized successfully");
    Ok(pool)
}

/// Initialize the user-facing database: a separate SQLite file (`personas_data.db`)
/// that agents and users can freely read/write without risk to the internal app database.
pub fn init_user_db(app_data_dir: &Path) -> Result<UserDbPool, AppError> {
    let db_path = app_data_dir.join("personas_data.db");

    tracing::info!(path = %db_path.display(), "Initializing user data database");

    let manager = SqliteConnectionManager::file(&db_path);
    let pool = Pool::builder()
        .max_size(2)
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
        ("builtin-http-request", "http_request", "network", "Make HTTP requests to external APIs", "builtin://http_request", None),
        ("builtin-gmail-read", "gmail_read", "email", "Read emails from Gmail", "builtin://gmail_read", Some("gmail")),
        ("builtin-gmail-send", "gmail_send", "email", "Send emails via Gmail", "builtin://gmail_send", Some("gmail")),
        ("builtin-gmail-search", "gmail_search", "email", "Search Gmail messages", "builtin://gmail_search", Some("gmail")),
        ("builtin-gmail-mark-read", "gmail_mark_read", "email", "Mark Gmail messages as read", "builtin://gmail_mark_read", Some("gmail")),
        ("builtin-file-read", "file_read", "filesystem", "Read file contents from disk", "builtin://file_read", None),
        ("builtin-file-write", "file_write", "filesystem", "Write content to files on disk", "builtin://file_write", None),
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
              healthcheck_config, services, events, metadata, is_builtin,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12)",
            params![c.id, c.name, c.label, c.icon_url, c.color, c.category, c.fields,
                    c.healthcheck_config, c.services, c.events, c.metadata, now],
        )?;

        // Update existing rows to refresh fields/metadata/category/services/events on app upgrade
        conn.execute(
            "UPDATE connector_definitions
             SET label = ?1, icon_url = ?2, fields = ?3, healthcheck_config = ?4, metadata = ?5, category = ?6, services = ?7, events = ?8, updated_at = ?9
             WHERE name = ?10 AND is_builtin = 1",
            params![c.label, c.icon_url, c.fields, c.healthcheck_config, c.metadata, c.category, c.services, c.events, now, c.name],
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
