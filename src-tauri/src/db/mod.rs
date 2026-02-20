#[macro_use]
pub mod macros;
#[allow(dead_code)] // Functions used by Tauri commands in Phase 3
pub mod migrations;
#[allow(dead_code)]
pub mod models;
#[allow(dead_code)]
pub mod repos;

use r2d2::{CustomizeConnection, Pool};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use std::path::PathBuf;

use crate::error::AppError;

pub type DbPool = Pool<SqliteConnectionManager>;

/// Connection customizer that sets per-connection SQLite pragmas.
#[derive(Debug)]
struct SqlitePragmaCustomizer;

impl CustomizeConnection<rusqlite::Connection, rusqlite::Error> for SqlitePragmaCustomizer {
    fn on_acquire(&self, conn: &mut rusqlite::Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -8000;",
        )?;
        Ok(())
    }
}

/// Initialize the database: create file, enable WAL + foreign keys, run migrations, seed data.
pub fn init_db(app_data_dir: &PathBuf) -> Result<DbPool, AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("personas.db");

    tracing::info!(path = %db_path.display(), "Initializing database");

    let manager = SqliteConnectionManager::file(&db_path);
    let pool = Pool::builder()
        .max_size(8)
        .connection_customizer(Box::new(SqlitePragmaCustomizer))
        .build(manager)?;

    // Set WAL journal mode (database-wide, only needs to run once)
    {
        let conn = pool.get()?;
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        tracing::debug!("SQLite pragmas configured (WAL, FK, busy_timeout)");
    }

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
fn seed_builtin_connectors(conn: &rusqlite::Connection) -> Result<(), AppError> {
        let now = chrono::Utc::now().to_rfc3339();

    let google_fields = r#"[]"#;

        let google_healthcheck = r#"{
            "endpoint": "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
            "method": "GET",
            "headers": {
                "Authorization": "Bearer {{access_token}}"
            },
            "description": "Validates Google OAuth identity access"
        }"#;

        let google_metadata = r#"{
            "template_enabled": true,
            "recommended": true,
            "summary": "Google Workspace consent-first template for Gmail, Drive, and Calendar automation.",
            "setup_instructions": "1. Open Google Cloud Console (https://console.cloud.google.com).\n2. Create/select a project and enable Gmail API, Google Drive API, and Google Calendar API.\n3. Configure OAuth consent screen and add authorized test users (up to your dev quota).\n4. In Personas, click Authorize with Google.\n5. Complete consent in your browser (you can uncheck permissions you do not want).\n6. Return to Personas; token metadata is saved automatically.",
            "oauth_type": "google"
        }"#;

        conn.execute(
                "INSERT OR IGNORE INTO connector_definitions
                 (id, name, label, icon_url, color, category, fields,
                    healthcheck_config, services, events, metadata, is_builtin,
                    created_at, updated_at)
                 VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?11)",
                params![
                        "builtin-google-workspace-oauth-template",
                        "google_workspace_oauth_template",
                    "Google Workspace",
                        "#4285F4",
                        "productivity",
                        google_fields,
                        google_healthcheck,
                        "[]",
                        "[]",
                        google_metadata,
                        now,
                ],
        )?;

            conn.execute(
                "UPDATE connector_definitions
                 SET label = ?1,
                     fields = ?2,
                     metadata = ?3,
                     updated_at = ?4
                 WHERE name = ?5",
                params![
                    "Google Workspace",
                    google_fields,
                    google_metadata,
                    now,
                    "google_workspace_oauth_template",
                ],
            )?;

        tracing::debug!("Builtin connector templates seeded");
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
