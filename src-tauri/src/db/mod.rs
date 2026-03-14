#[macro_use]
pub mod macros;
#[allow(dead_code)] // Functions used by Tauri commands in Phase 3
pub mod migrations;
#[allow(dead_code)]
pub mod models;
#[allow(dead_code)]
pub mod repos;
pub mod settings_keys;

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
pub fn init_user_db(app_data_dir: &PathBuf) -> Result<UserDbPool, AppError> {
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

/// Seed the built-in `personas_database` credential if it doesn't already exist.
/// This ensures a "Built-in Database" entry appears in the Databases submodule
/// immediately on first app launch.
pub fn seed_builtin_database_credential(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM persona_credentials WHERE id = 'builtin-personas-database'",
        [],
        |row| row.get(0),
    )?;

    if exists {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    // The credential stores no secrets -- it's a local file.
    // We use a dummy encrypted_data/iv since the schema requires non-null values.
    conn.execute(
        "INSERT INTO persona_credentials
         (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            "builtin-personas-database",
            "Built-in Database",
            "personas_database",
            "{}",  // no encrypted data
            "",    // no IV
            r#"{"is_builtin":true,"description":"Local SQLite database managed by Personas. Safe for agent read/write operations."}"#,
            now,
        ],
    )?;

    tracing::info!("Seeded built-in database credential");
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
fn seed_builtin_connectors(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();

    struct BuiltinConnector {
        id: &'static str,
        name: &'static str,
        label: &'static str,
        color: &'static str,
        icon_url: &'static str,
        category: &'static str,
        fields: &'static str,
        healthcheck_config: Option<&'static str>,
        metadata: Option<&'static str>,
    }

    let connectors: &[BuiltinConnector] = &[
        BuiltinConnector {
            id: "builtin-google-workspace-oauth-template",
            name: "google_workspace_oauth_template",
            label: "Google Workspace",
            color: "#4285F4",
            icon_url: "/icons/connectors/google.svg",
            category: "productivity",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://www.googleapis.com/oauth2/v1/userinfo?alt=json","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Google OAuth identity access"}"#),
            metadata: Some(r#"{"template_enabled":true,"recommended":true,"summary":"Google Workspace consent-first template for Gmail, Drive, and Calendar automation.","setup_instructions":"1. Open Google Cloud Console (https://console.cloud.google.com).\n2. Create/select a project and enable Gmail API, Google Drive API, and Google Calendar API.\n3. Configure OAuth consent screen and add authorized test users.\n4. In Personas, click Authorize with Google.\n5. Complete consent in your browser.\n6. Return to Personas; token metadata is saved automatically.","oauth_type":"google","auth_type":"oauth","auth_type_label":"OAuth","docs_url":"https://console.cloud.google.com/apis/credentials","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@anthropic/mcp-google-workspace","transport":"stdio","suggested_env":{"GOOGLE_CLIENT_ID":"","GOOGLE_CLIENT_SECRET":"","GOOGLE_REFRESH_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-gmail",
            name: "gmail",
            label: "Gmail",
            color: "#EA4335",
            icon_url: "/icons/connectors/gmail.svg",
            category: "messaging",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://www.googleapis.com/oauth2/v1/userinfo?alt=json","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Google OAuth identity access"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Gmail email automation for reading, sending, and managing messages via the Gmail API v1.","auth_type":"oauth","auth_type_label":"OAuth","oauth_type":"google","oauth_scopes":["https://www.googleapis.com/auth/gmail.modify","https://www.googleapis.com/auth/gmail.send","https://www.googleapis.com/auth/gmail.readonly"],"docs_url":"https://developers.google.com/workspace/gmail/api/reference/rest","setup_guide":"1. Open Google Cloud Console (https://console.cloud.google.com).\n2. Create/select a project and enable the Gmail API.\n3. Configure OAuth consent screen and add authorized test users.\n4. In Personas, click Authorize with Google.\n5. Complete consent in your browser.\n6. Return to Personas; token metadata is saved automatically.","pricing_tier":"freemium","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@googleworkspace/cli","transport":"stdio","suggested_env":{"GOOGLE_CLIENT_ID":"","GOOGLE_CLIENT_SECRET":"","GOOGLE_REFRESH_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-google-sheets",
            name: "google_sheets",
            label: "Google Sheets",
            color: "#34A853",
            icon_url: "/icons/connectors/google-sheets.svg",
            category: "database",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://www.googleapis.com/oauth2/v1/userinfo?alt=json","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Google OAuth identity access"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Google Sheets spreadsheet-as-database for reading, writing, and managing structured data via the Sheets API v4.","auth_type":"oauth","auth_type_label":"OAuth","oauth_type":"google","oauth_scopes":["https://www.googleapis.com/auth/spreadsheets","https://www.googleapis.com/auth/spreadsheets.readonly","https://www.googleapis.com/auth/drive.file"],"docs_url":"https://developers.google.com/workspace/sheets/api/reference/rest","setup_guide":"1. Open Google Cloud Console (https://console.cloud.google.com).\n2. Create/select a project and enable the Google Sheets API.\n3. Configure OAuth consent screen and add authorized test users.\n4. In Personas, click Authorize with Google.\n5. Complete consent in your browser.\n6. Return to Personas; token metadata is saved automatically.","pricing_tier":"freemium","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@googleworkspace/cli","transport":"stdio","suggested_env":{"GOOGLE_CLIENT_ID":"","GOOGLE_CLIENT_SECRET":"","GOOGLE_REFRESH_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-airtable",
            name: "airtable",
            label: "Airtable",
            color: "#18BFFF",
            icon_url: "/icons/connectors/airtable.svg",
            category: "productivity",
            fields: r#"[{"key":"api_key","label":"Personal Access Token","type":"password","required":true,"placeholder":"pat...","helpText":"Generate at airtable.com/create/tokens"},{"key":"base_id","label":"Base ID","type":"text","required":false,"placeholder":"appXXXXXXXXXXXXXX","helpText":"Optional: restrict to a specific base"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.airtable.com/v0/meta/whoami","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via whoami endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Airtable spreadsheet-database for project tracking and data management.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://airtable.com/create/tokens","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-azure-devops",
            name: "azure_devops",
            label: "Azure DevOps",
            color: "#0078D7",
            icon_url: "/icons/connectors/azure-devops.svg",
            category: "development",
            fields: r#"[{"key":"organization","label":"Organization","type":"text","required":true,"placeholder":"my-org","helpText":"Your Azure DevOps organization name (from dev.azure.com/{organization})"},{"key":"pat","label":"Personal Access Token","type":"password","required":true,"placeholder":"","helpText":"Generate at dev.azure.com/{org}/_usersSettings/tokens with required scopes"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://dev.azure.com/{{organization}}/_apis/projects?api-version=7.1","method":"GET","headers":{"Authorization":"Basic {{base64(:pat)}}"},"description":"Validates PAT via Azure DevOps projects endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Azure DevOps for repositories, work items, pipelines, and CI/CD.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://learn.microsoft.com/en-us/rest/api/azure/devops/","pricing_tier":"freemium","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@azure-devops/mcp","transport":"stdio","suggested_env":{"AZURE_DEVOPS_ORG":"","AZURE_DEVOPS_PAT":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-asana",
            name: "asana",
            label: "Asana",
            color: "#F06A6A",
            icon_url: "/icons/connectors/asana.svg",
            category: "productivity",
            fields: r#"[{"key":"personal_access_token","label":"Personal Access Token","type":"password","required":true,"placeholder":"1/12345:abcdef...","helpText":"From Asana -> My Settings -> Apps -> Manage Developer Apps -> Personal Access Tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://app.asana.com/api/1.0/users/me","method":"GET","headers":{"Authorization":"Bearer {{personal_access_token}}"},"description":"Validates personal access token via Asana users/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Asana project management for tasks, projects, and team collaboration.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://developers.asana.com/docs/personal-access-token","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@roychri/mcp-server-asana","transport":"stdio","suggested_env":{"ASANA_ACCESS_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-notion",
            name: "notion",
            label: "Notion",
            color: "#000000",
            icon_url: "/icons/connectors/notion.svg",
            category: "database",
            fields: r#"[{"key":"api_key","label":"Integration Token","type":"password","required":true,"placeholder":"ntn_...","helpText":"Create an internal integration at notion.so/my-integrations"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.notion.com/v1/users/me","method":"GET","headers":{"Authorization":"Bearer {{api_key}}","Notion-Version":"2022-06-28"},"description":"Validates integration token via users/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Notion workspace for knowledge bases, wikis, and project management.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://www.notion.so/my-integrations","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@notionhq/mcp-server","transport":"stdio","suggested_env":{"NOTION_TOKEN":"","OPENAI_API_KEY":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-clickup",
            name: "clickup",
            label: "ClickUp",
            color: "#7B68EE",
            icon_url: "/icons/connectors/clickup.svg",
            category: "productivity",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"pk_...","helpText":"From ClickUp Settings -> Apps -> API Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.clickup.com/api/v2/user","method":"GET","headers":{"Authorization":"{{api_key}}"},"description":"Validates API key via user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"ClickUp project management with tasks, docs, goals, and time tracking.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://clickup.com/api/developer-portal/authentication","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@taazkareem/clickup-mcp-server","transport":"stdio","suggested_env":{"CLICKUP_API_KEY":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-github",
            name: "github",
            label: "GitHub",
            color: "#1F2937",
            icon_url: "/icons/connectors/github.svg",
            category: "development",
            fields: r#"[{"key":"personal_access_token","label":"Personal Access Token","type":"password","required":true,"placeholder":"ghp_...","helpText":"Generate at github.com/settings/tokens with required scopes"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.github.com/user","method":"GET","headers":{"Authorization":"Bearer {{personal_access_token}}","Accept":"application/vnd.github+json","User-Agent":"personas-desktop"},"description":"Validates PAT via GitHub user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"GitHub for repositories, issues, pull requests, and CI/CD.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://github.com/settings/tokens","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@modelcontextprotocol/server-github","transport":"stdio","suggested_env":{"GITHUB_PERSONAL_ACCESS_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-cal-com",
            name: "cal_com",
            label: "Cal.com",
            color: "#292929",
            icon_url: "/icons/connectors/cal-com.svg",
            category: "scheduling",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"cal_live_...","helpText":"Generate at cal.com/settings/developer/api-keys"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.cal.com/v2/me","method":"GET","headers":{"Authorization":"Bearer {{api_key}}","cal-api-version":"2024-08-13"},"description":"Validates API key via Cal.com /v2/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Cal.com open-source scheduling platform for availability and bookings.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://cal.com/docs/api-reference/v2/introduction","pricing_tier":"freemium","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@calcom/cal-mcp","transport":"stdio","suggested_env":{"CAL_API_KEY":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-calendly",
            name: "calendly",
            label: "Calendly",
            color: "#006BFF",
            icon_url: "/icons/connectors/calendly.svg",
            category: "productivity",
            fields: r#"[{"key":"api_key","label":"Personal Access Token","type":"password","required":true,"placeholder":"eyJ...","helpText":"Generate at calendly.com/integrations/api_webhooks"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.calendly.com/users/me","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates token via Calendly users/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Calendly scheduling for meetings and appointment automation.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://developer.calendly.com/api-docs/","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-supabase",
            name: "supabase",
            label: "Supabase",
            color: "#3ECF8E",
            icon_url: "/icons/connectors/supabase.svg",
            category: "database",
            fields: r#"[{"key":"project_url","label":"Project URL","type":"url","required":true,"placeholder":"https://xxxx.supabase.co","helpText":"From Supabase Dashboard -> Settings -> API"},{"key":"anon_key","label":"Anon / Public Key","type":"password","required":true,"placeholder":"eyJ...","helpText":"The anon key for client-side access"},{"key":"service_role_key","label":"Service Role Key","type":"password","required":false,"placeholder":"eyJ...","helpText":"For server-side admin access (bypasses RLS)"},{"key":"pooler_url","label":"Pooler Connection String","type":"password","required":false,"placeholder":"postgresql://postgres.xxxx:...","helpText":"Supavisor pooler URL for direct database access"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{project_url}}/rest/v1/","method":"GET","headers":{"apikey":"{{anon_key}}","Authorization":"Bearer {{anon_key}}"},"description":"Validates Supabase connection via REST endpoint with anon key"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Supabase open-source Firebase alternative with Postgres, auth, and realtime.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://supabase.com/dashboard/project/_/settings/api","auth_variants":[{"id":"anon","label":"Anon Key","fields":["project_url","anon_key"],"auth_type_label":"API Key","healthcheck_config":{"endpoint":"{{project_url}}/rest/v1/","method":"GET","headers":{"apikey":"{{anon_key}}","Authorization":"Bearer {{anon_key}}"}}},{"id":"service_role","label":"Service Role","fields":["project_url","service_role_key"],"auth_type_label":"Service Role","healthcheck_config":{"endpoint":"{{project_url}}/rest/v1/","method":"GET","headers":{"apikey":"{{service_role_key}}","Authorization":"Bearer {{service_role_key}}"}}},{"id":"pooler","label":"Pooler URL","fields":["pooler_url"],"auth_type_label":"Connection String","healthcheck_skip":true}],"auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@supabase/mcp-server-supabase","transport":"stdio","suggested_env":{"SUPABASE_ACCESS_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-sentry",
            name: "sentry",
            label: "Sentry",
            color: "#362D59",
            icon_url: "/icons/connectors/sentry.svg",
            category: "monitoring",
            fields: r#"[{"key":"auth_token","label":"Auth Token","type":"password","required":true,"placeholder":"sntrys_...","helpText":"Generate at sentry.io/settings/auth-tokens/"},{"key":"organization_slug","label":"Organization Slug","type":"text","required":true,"placeholder":"my-org","helpText":"Your Sentry organization slug from the URL"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://sentry.io/api/0/organizations/{{organization_slug}}/","method":"GET","headers":{"Authorization":"Bearer {{auth_token}}"},"description":"Validates auth token via organization endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Sentry application monitoring for errors, performance, and session replay.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://docs.sentry.io/api/guides/create-auth-token/","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@sentry/mcp-server-sentry","transport":"stdio","suggested_env":{"SENTRY_AUTH_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-betterstack",
            name: "betterstack",
            label: "Better Stack",
            color: "#E5484D",
            icon_url: "/icons/connectors/betterstack.svg",
            category: "monitoring",
            fields: r#"[{"key":"api_token","label":"API Token","type":"password","required":true,"placeholder":"","helpText":"From Better Stack Dashboard -> Settings -> API tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://uptime.betterstack.com/api/v2/monitors","method":"GET","headers":{"Authorization":"Bearer {{api_token}}"},"description":"Validates API token via monitors endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Better Stack uptime monitoring, incident management, and status pages.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-mixpanel",
            name: "mixpanel",
            label: "Mixpanel",
            color: "#7856FF",
            icon_url: "/icons/connectors/mixpanel.svg",
            category: "analytics",
            fields: r#"[{"key":"service_account_username","label":"Service Account Username","type":"text","required":true,"placeholder":"","helpText":"From Mixpanel -> Organization Settings -> Service Accounts"},{"key":"service_account_secret","label":"Service Account Secret","type":"password","required":true,"placeholder":"","helpText":"The secret paired with the service account username"},{"key":"project_id","label":"Project ID","type":"text","required":true,"placeholder":"","helpText":"From Mixpanel -> Project Settings -> Project ID"},{"key":"project_token","label":"Project Token","type":"password","required":false,"placeholder":"","helpText":"From Mixpanel -> Project Settings -> Access Keys -> Project Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://mixpanel.com/api/app/me","method":"GET","headers":{"Authorization":"Basic {{base64(service_account_username:service_account_secret)}}"},"description":"Validates service account via Mixpanel app/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Mixpanel product analytics with GDPR-compliant data access.","auth_type":"project_secret","auth_type_label":"Service Account","docs_url":"https://developer.mixpanel.com/reference/project-secret","auth_variants":[{"id":"service_account","label":"Service Account","fields":["service_account_username","service_account_secret","project_id"],"auth_type_label":"Service Account"},{"id":"project_token","label":"Project Token","fields":["project_id","project_token"],"auth_type_label":"Project Token"}],"auth_methods":[{"id":"project_secret","label":"Service Account","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-twilio-segment",
            name: "twilio_segment",
            label: "Twilio Segment",
            color: "#52BD94",
            icon_url: "/icons/connectors/twilio.svg",
            category: "analytics",
            fields: r#"[{"key":"write_key","label":"Write Key","type":"password","required":true,"placeholder":"","helpText":"From Segment -> Sources -> your source -> Settings -> API Keys"},{"key":"access_token","label":"Access Token","type":"password","required":false,"placeholder":"","helpText":"Optional: for Config API access (workspace-level)"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.segment.io/v1/batch","method":"POST","headers":{"Authorization":"Basic {{base64(write_key:)}}","Content-Type":"application/json"},"description":"Validates write key via Segment batch endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Twilio Segment customer data platform for event tracking and routing.","auth_type":"write_key","auth_type_label":"Write Key","docs_url":"https://segment.com/docs/connections/sources/catalog/","auth_variants":[{"id":"write","label":"Write Key","fields":["write_key"],"auth_type_label":"Write Key"},{"id":"config","label":"Write + Config API","fields":["write_key","access_token"],"auth_type_label":"Config API"}],"auth_methods":[{"id":"write_key","label":"Write Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-monday",
            name: "monday",
            label: "Monday.com",
            color: "#FF3D57",
            icon_url: "/icons/connectors/monday.svg",
            category: "productivity",
            fields: r#"[{"key":"api_key_v2","label":"API v2 Token","type":"password","required":true,"placeholder":"eyJ...","helpText":"From monday.com -> Avatar -> Developers -> My Access Tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.monday.com/v2","method":"POST","headers":{"Authorization":"{{api_key_v2}}","Content-Type":"application/json"},"body":"{\"query\":\"{ me { id } }\"}","description":"Validates API token via Monday GraphQL endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Monday.com work management platform for projects, workflows, and CRM.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://developer.monday.com/api-reference/docs/authentication","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-linear",
            name: "linear",
            label: "Linear",
            color: "#5E6AD2",
            icon_url: "/icons/connectors/linear.svg",
            category: "development",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"lin_api_...","helpText":"From Linear -> Settings -> API -> Personal API keys"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.linear.app/graphql","method":"POST","headers":{"Authorization":"{{api_key}}","Content-Type":"application/json"},"body":"{\"query\":\"{ viewer { id } }\"}","description":"Validates API key via Linear GraphQL viewer query"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Linear issue tracking for software teams with cycles, projects, and triage.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://linear.app/settings/api","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"mcp-linear","transport":"stdio","suggested_env":{"LINEAR_API_KEY":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-posthog",
            name: "posthog",
            label: "PostHog",
            color: "#F9BD2B",
            icon_url: "/icons/connectors/posthog.svg",
            category: "analytics",
            fields: r#"[{"key":"personal_api_key","label":"Personal API Key","type":"password","required":true,"placeholder":"phx_...","helpText":"From PostHog -> Settings -> Personal API Keys"},{"key":"project_api_key","label":"Project API Key","type":"password","required":false,"placeholder":"phc_...","helpText":"Optional: project token for event ingestion"},{"key":"host","label":"Host","type":"url","required":false,"placeholder":"https://us.posthog.com","helpText":"Defaults to us.posthog.com. Use eu.posthog.com for EU cloud."}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{host|https://us.posthog.com}}/api/projects/","method":"GET","headers":{"Authorization":"Bearer {{personal_api_key}}"},"description":"Validates personal API key via projects endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"PostHog product analytics, feature flags, session replay, and A/B testing.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://posthog.com/docs/api","auth_variants":[{"id":"personal","label":"Personal API Key","fields":["personal_api_key","host"],"auth_type_label":"API Key"},{"id":"project","label":"Project Key","fields":["project_api_key","host"],"auth_type_label":"Project Key"}],"auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-circleci",
            name: "circleci",
            label: "CircleCI",
            color: "#343434",
            icon_url: "/icons/connectors/circleci.svg",
            category: "development",
            fields: r#"[{"key":"personal_token","label":"Personal API Token","type":"password","required":true,"placeholder":"CCIPAT_...","helpText":"From CircleCI -> User Settings -> Personal API Tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://circleci.com/api/v2/me","method":"GET","headers":{"Circle-Token":"{{personal_token}}"},"description":"Validates token via CircleCI me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"CircleCI continuous integration and delivery platform.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://circleci.com/docs/managing-api-tokens/","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-convex",
            name: "convex",
            label: "Convex",
            color: "#F97316",
            icon_url: "/icons/connectors/convex.svg",
            category: "database",
            fields: r#"[{"key":"deployment_url","label":"Deployment URL","type":"url","required":true,"placeholder":"https://your-app-123.convex.cloud","helpText":"From Convex Dashboard -> Settings -> URL"},{"key":"deploy_key","label":"Deploy Key","type":"password","required":true,"placeholder":"prod:...","helpText":"From Convex Dashboard -> Settings -> Deploy Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{deployment_url}}/version","method":"GET","headers":{},"description":"Validates Convex deployment URL is reachable"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Convex real-time backend-as-a-service with document database, serverless functions, and scheduling.","auth_type":"deploy_key","auth_type_label":"Deploy Key","docs_url":"https://docs.convex.dev/http-api/","db_type":"document","db_engine":"convex","db_features":["function_execution","schema_introspection_pro","document_browsing_pro"],"query_language":"convex","query_help":"Call Convex functions via JSON body. Table browsing requires Professional plan.","pricing_tier":"free","auth_methods":[{"id":"deploy_key","label":"Deploy Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-buffer",
            name: "buffer",
            label: "Buffer",
            color: "#168EEA",
            icon_url: "/icons/connectors/buffer.svg",
            category: "social",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"","helpText":"From Buffer -> Settings -> Apps -> Access Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.bufferapp.com/1/user.json?access_token={{access_token}}","method":"GET","headers":{},"description":"Validates access token via Buffer user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Buffer social media management for scheduling and publishing.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://buffer.com/developers/api","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-leonardo-ai",
            name: "leonardo_ai",
            label: "Leonardo AI",
            color: "#6C3AEF",
            icon_url: "/icons/connectors/leonardo-ai.svg",
            category: "ai",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"","helpText":"Generate at app.leonardo.ai/api-access"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://cloud.leonardo.ai/api/rest/v1/me","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via Leonardo AI /me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Leonardo AI generative image and video platform for creative content.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://docs.leonardo.ai/docs/getting-started","pricing_tier":"freemium","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-kubernetes",
            name: "kubernetes",
            label: "Kubernetes",
            color: "#326CE5",
            icon_url: "/icons/connectors/kubernetes.svg",
            category: "cloud",
            fields: r#"[{"key":"api_server","label":"API Server URL","type":"url","required":true,"placeholder":"https://my-cluster.example.com:6443","helpText":"Kubernetes API server URL (find with: kubectl cluster-info)"},{"key":"token","label":"Bearer Token","type":"password","required":true,"placeholder":"eyJhbGciOi...","helpText":"Service account token (find with: kubectl create token <sa-name>)"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{api_server}}/api","method":"GET","headers":{"Authorization":"Bearer {{token}}"},"description":"Validates token via Kubernetes API versions endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Kubernetes container orchestration for managing clusters, pods, and deployments.","auth_type":"pat","auth_type_label":"Bearer Token","docs_url":"https://kubernetes.io/docs/reference/kubernetes-api/","pricing_tier":"free","auth_methods":[{"id":"pat","label":"Bearer Token","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"mcp-server-kubernetes","transport":"stdio","suggested_env":{}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-linkedin",
            name: "linkedin",
            label: "LinkedIn",
            color: "#0A66C2",
            icon_url: "/icons/connectors/linkedin.svg",
            category: "social",
            fields: r#"[{"key":"client_id","label":"Client ID","type":"text","required":true,"placeholder":"86abc123def456","helpText":"From LinkedIn Developer Portal -> My Apps -> Auth tab"},{"key":"client_secret","label":"Client Secret","type":"password","required":true,"placeholder":"","helpText":"From LinkedIn Developer Portal -> My Apps -> Auth tab"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.linkedin.com/v2/userinfo","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates OAuth token via LinkedIn userinfo endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"LinkedIn professional network for profile, connections, and social posts.","auth_type":"oauth","auth_type_label":"OAuth","oauth_provider_id":"linkedin","oauth_scopes":["openid","profile","email","w_member_social"],"docs_url":"https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true}]}"#),
        },
        // -- New connectors --
        BuiltinConnector {
            id: "builtin-slack",
            name: "slack",
            label: "Slack",
            color: "#4A154B",
            icon_url: "/icons/connectors/slack.svg",
            category: "messaging",
            fields: r#"[{"key":"bot_token","label":"Bot User OAuth Token","type":"password","required":true,"placeholder":"xoxb-...","helpText":"From Slack App -> OAuth & Permissions -> Bot User OAuth Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://slack.com/api/auth.test","method":"GET","headers":{"Authorization":"Bearer {{bot_token}}"},"description":"Validates bot token via Slack auth.test endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Slack workspace messaging for channels, DMs, and workflow notifications.","auth_type":"bot_token","auth_type_label":"Bot Token","docs_url":"https://api.slack.com/authentication/token-types","auth_methods":[{"id":"bot_token","label":"Bot Token","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@modelcontextprotocol/server-slack","transport":"stdio","suggested_env":{"SLACK_BOT_TOKEN":"","SLACK_TEAM_ID":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-discord",
            name: "discord",
            label: "Discord",
            color: "#5865F2",
            icon_url: "/icons/connectors/discord.svg",
            category: "messaging",
            fields: r#"[{"key":"bot_token","label":"Bot Token","type":"password","required":true,"placeholder":"","helpText":"From Discord Developer Portal -> Bot -> Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://discord.com/api/v10/users/@me","method":"GET","headers":{"Authorization":"Bot {{bot_token}}"},"description":"Validates bot token via Discord users/@me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Discord bot integration for server messaging, moderation, and notifications.","auth_type":"bot_token","auth_type_label":"Bot Token","docs_url":"https://discord.com/developers/applications","auth_methods":[{"id":"bot_token","label":"Bot Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-telegram",
            name: "telegram",
            label: "Telegram",
            color: "#26A5E4",
            icon_url: "/icons/connectors/telegram.svg",
            category: "messaging",
            fields: r#"[{"key":"bot_token","label":"Bot Token","type":"password","required":true,"placeholder":"123456:ABC-DEF...","helpText":"From @BotFather on Telegram -> /newbot or /token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.telegram.org/bot{{bot_token}}/getMe","method":"GET","headers":{},"description":"Validates bot token via Telegram getMe endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Telegram bot for messaging, notifications, and group automation.","auth_type":"bot_token","auth_type_label":"Bot Token","docs_url":"https://core.telegram.org/bots/api","auth_methods":[{"id":"bot_token","label":"Bot Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-sendgrid",
            name: "sendgrid",
            label: "SendGrid",
            color: "#1A82E2",
            icon_url: "/icons/connectors/sendgrid.svg",
            category: "messaging",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"SG....","helpText":"From SendGrid -> Settings -> API Keys -> Create API Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.sendgrid.com/v3/scopes","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via SendGrid scopes endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"SendGrid transactional and marketing email delivery at scale.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://docs.sendgrid.com/ui/account-and-settings/api-keys","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-resend",
            name: "resend",
            label: "Resend",
            color: "#000000",
            icon_url: "/icons/connectors/resend.svg",
            category: "messaging",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"re_...","helpText":"From Resend Dashboard -> API Keys -> Create API Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.resend.com/domains","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via Resend domains endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Resend modern email API for developers with React Email support.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://resend.com/docs/api-reference/introduction","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-vercel",
            name: "vercel",
            label: "Vercel",
            color: "#000000",
            icon_url: "/icons/connectors/vercel.svg",
            category: "devops",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"","helpText":"From Vercel -> Settings -> Tokens -> Create"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.vercel.com/v2/user","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Vercel user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Vercel frontend deployment platform with serverless functions and edge network.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://vercel.com/account/tokens","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-netlify",
            name: "netlify",
            label: "Netlify",
            color: "#00C7B7",
            icon_url: "/icons/connectors/netlify.svg",
            category: "devops",
            fields: r#"[{"key":"access_token","label":"Personal Access Token","type":"password","required":true,"placeholder":"","helpText":"From Netlify -> User Settings -> Applications -> Personal Access Tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.netlify.com/api/v1/user","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Netlify user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Netlify web deployment platform with serverless functions and form handling.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://app.netlify.com/user/applications#personal-access-tokens","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-cloudflare",
            name: "cloudflare",
            label: "Cloudflare",
            color: "#F38020",
            icon_url: "/icons/connectors/cloudflare.svg",
            category: "devops",
            fields: r#"[{"key":"api_token","label":"API Token","type":"password","required":true,"placeholder":"","helpText":"From Cloudflare Dashboard -> My Profile -> API Tokens -> Create Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.cloudflare.com/client/v4/user/tokens/verify","method":"GET","headers":{"Authorization":"Bearer {{api_token}}"},"description":"Validates API token via Cloudflare token verify endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Cloudflare CDN, DNS, Workers, and security services.","auth_type":"api_token","auth_type_label":"API Token","docs_url":"https://dash.cloudflare.com/profile/api-tokens","auth_methods":[{"id":"api_token","label":"API Token","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@cloudflare/mcp-server-cloudflare","transport":"stdio","suggested_env":{"CLOUDFLARE_API_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-figma",
            name: "figma",
            label: "Figma",
            color: "#F24E1E",
            icon_url: "/icons/connectors/figma.svg",
            category: "creativity",
            fields: r#"[{"key":"personal_access_token","label":"Personal Access Token","type":"password","required":true,"placeholder":"figd_...","helpText":"From Figma -> Settings -> Personal Access Tokens -> Generate"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.figma.com/v1/me","method":"GET","headers":{"X-Figma-Token":"{{personal_access_token}}"},"description":"Validates personal access token via Figma me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Figma collaborative design tool for UI/UX, prototyping, and design systems.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://www.figma.com/developers/api","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@anthropic/mcp-figma","transport":"stdio","suggested_env":{"FIGMA_PERSONAL_ACCESS_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-hubspot",
            name: "hubspot",
            label: "HubSpot",
            color: "#FF7A59",
            icon_url: "/icons/connectors/hubspot.svg",
            category: "crm",
            fields: r#"[{"key":"access_token","label":"Private App Access Token","type":"password","required":true,"placeholder":"pat-...","helpText":"From HubSpot -> Settings -> Integrations -> Private Apps -> Create"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.hubapi.com/crm/v3/objects/contacts?limit=1","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via HubSpot contacts endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"HubSpot CRM for contacts, deals, marketing automation, and sales pipelines.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://developers.hubspot.com/docs/api/private-apps","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-jira",
            name: "jira",
            label: "Jira",
            color: "#0052CC",
            icon_url: "/icons/connectors/jira.svg",
            category: "development",
            fields: r#"[{"key":"domain","label":"Atlassian Domain","type":"text","required":true,"placeholder":"your-company.atlassian.net","helpText":"Your Jira Cloud domain (without https://)"},{"key":"email","label":"Account Email","type":"text","required":true,"placeholder":"you@company.com","helpText":"The email address for your Atlassian account"},{"key":"api_token","label":"API Token","type":"password","required":true,"placeholder":"","helpText":"From id.atlassian.com/manage-profile/security/api-tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://{{domain}}/rest/api/3/myself","method":"GET","headers":{"Authorization":"Basic {{base64(email:api_token)}}","Accept":"application/json"},"description":"Validates credentials via Jira myself endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Jira issue tracking and project management for agile software teams.","auth_type":"basic_api_token","auth_type_label":"API Token","docs_url":"https://id.atlassian.com/manage-profile/security/api-tokens","auth_methods":[{"id":"basic_api_token","label":"API Token","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@anthropic/mcp-atlassian","transport":"stdio","suggested_env":{"JIRA_URL":"","JIRA_USERNAME":"","JIRA_API_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-confluence",
            name: "confluence",
            label: "Confluence",
            color: "#172B4D",
            icon_url: "/icons/connectors/confluence.svg",
            category: "development",
            fields: r#"[{"key":"domain","label":"Atlassian Domain","type":"text","required":true,"placeholder":"your-company.atlassian.net","helpText":"Your Confluence Cloud domain (without https://)"},{"key":"email","label":"Account Email","type":"text","required":true,"placeholder":"you@company.com","helpText":"The email address for your Atlassian account"},{"key":"api_token","label":"API Token","type":"password","required":true,"placeholder":"","helpText":"From id.atlassian.com/manage-profile/security/api-tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://{{domain}}/wiki/rest/api/space?limit=1","method":"GET","headers":{"Authorization":"Basic {{base64(email:api_token)}}","Accept":"application/json"},"description":"Validates credentials via Confluence spaces endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Confluence wiki and knowledge base for team documentation and collaboration.","auth_type":"basic_api_token","auth_type_label":"API Token","docs_url":"https://id.atlassian.com/manage-profile/security/api-tokens","auth_methods":[{"id":"basic_api_token","label":"API Token","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@anthropic/mcp-atlassian","transport":"stdio","suggested_env":{"CONFLUENCE_URL":"","CONFLUENCE_USERNAME":"","CONFLUENCE_API_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-neon",
            name: "neon",
            label: "Neon",
            color: "#00E699",
            icon_url: "/icons/connectors/neon.svg",
            category: "database",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"","helpText":"From Neon Console -> Account Settings -> API Keys -> Generate"},{"key":"connection_string","label":"Connection String","type":"password","required":false,"placeholder":"postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname","helpText":"Optional: PostgreSQL connection string for direct database access"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://console.neon.tech/api/v2/projects","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via Neon projects endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Neon serverless Postgres with branching, autoscaling, and bottomless storage.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://neon.tech/docs/manage/api-keys","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@modelcontextprotocol/server-postgres","transport":"stdio","suggested_env":{"DATABASE_URL":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-upstash",
            name: "upstash",
            label: "Upstash",
            color: "#00E9A3",
            icon_url: "/icons/connectors/upstash.svg",
            category: "database",
            fields: r#"[{"key":"redis_url","label":"REST URL","type":"url","required":true,"placeholder":"https://xxx.upstash.io","helpText":"From Upstash Console -> Database -> Details -> REST API -> URL"},{"key":"redis_token","label":"REST Token","type":"password","required":true,"placeholder":"","helpText":"From Upstash Console -> Database -> Details -> REST API -> Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{redis_url}}/ping","method":"GET","headers":{"Authorization":"Bearer {{redis_token}}"},"description":"Validates REST token via Upstash Redis PING command"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Upstash serverless Redis and Kafka for low-latency data at the edge.","auth_type":"api_token","auth_type_label":"REST Token","docs_url":"https://upstash.com/docs/redis/features/restapi","auth_methods":[{"id":"api_token","label":"REST Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-planetscale",
            name: "planetscale",
            label: "PlanetScale",
            color: "#000000",
            icon_url: "/icons/connectors/planetscale.svg",
            category: "database",
            fields: r#"[{"key":"service_token_id","label":"Service Token ID","type":"text","required":true,"placeholder":"","helpText":"From PlanetScale -> Organization -> Settings -> Service Tokens"},{"key":"service_token","label":"Service Token","type":"password","required":true,"placeholder":"","helpText":"The service token secret paired with the token ID"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.planetscale.com/v1/organizations","method":"GET","headers":{"Authorization":"{{service_token_id}}:{{service_token}}"},"description":"Validates service token via PlanetScale organizations endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"PlanetScale serverless MySQL platform with branching and non-blocking schema changes.","auth_type":"service_token","auth_type_label":"Service Token","docs_url":"https://planetscale.com/docs/concepts/service-tokens","auth_methods":[{"id":"service_token","label":"Service Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-dropbox",
            name: "dropbox",
            label: "Dropbox",
            color: "#0061FF",
            icon_url: "/icons/connectors/dropbox.svg",
            category: "storage",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"sl.u...","helpText":"From Dropbox App Console -> Generate Access Token (or use OAuth flow)"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.dropboxapi.com/2/users/get_current_account","method":"POST","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Dropbox current account endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Dropbox cloud storage for file sync, sharing, and collaboration.","auth_type":"pat","auth_type_label":"Access Token","docs_url":"https://www.dropbox.com/developers/apps","auth_methods":[{"id":"pat","label":"Access Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-postgres",
            name: "postgres",
            label: "PostgreSQL",
            color: "#336791",
            icon_url: "/icons/connectors/postgres.svg",
            category: "database",
            fields: r#"[{"key":"connection_string","label":"Connection String","type":"password","required":true,"placeholder":"postgresql://user:password@host:5432/dbname","helpText":"Full PostgreSQL connection URI including credentials"},{"key":"host","label":"Host","type":"text","required":false,"placeholder":"localhost","helpText":"Alternative: provide host/port/db separately instead of connection string"},{"key":"port","label":"Port","type":"text","required":false,"placeholder":"5432","helpText":"PostgreSQL port (default 5432)"},{"key":"database","label":"Database","type":"text","required":false,"placeholder":"mydb","helpText":"Database name"},{"key":"username","label":"Username","type":"text","required":false,"placeholder":"postgres","helpText":"Database user"},{"key":"password","label":"Password","type":"password","required":false,"placeholder":"","helpText":"Database password"},{"key":"ssl_mode","label":"SSL Mode","type":"text","required":false,"placeholder":"prefer","helpText":"SSL mode: disable, allow, prefer, require, verify-ca, verify-full"}]"#,
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"summary":"PostgreSQL open-source relational database with advanced SQL, JSONB, and extensibility.","auth_type":"connection_string","auth_type_label":"Connection String","docs_url":"https://www.postgresql.org/docs/current/libpq-connect.html","auth_variants":[{"id":"connection_string","label":"Connection String","fields":["connection_string"],"auth_type_label":"Connection String"},{"id":"individual","label":"Individual Fields","fields":["host","port","database","username","password","ssl_mode"],"auth_type_label":"Host/Port"}],"auth_methods":[{"id":"connection_string","label":"Connection String","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-mongodb",
            name: "mongodb",
            label: "MongoDB",
            color: "#47A248",
            icon_url: "/icons/connectors/mongodb.svg",
            category: "database",
            fields: r#"[{"key":"connection_string","label":"Connection String","type":"password","required":true,"placeholder":"mongodb+srv://user:password@cluster.xxxxx.mongodb.net/dbname","helpText":"MongoDB connection URI from Atlas or your self-hosted instance"},{"key":"database_name","label":"Database Name","type":"text","required":false,"placeholder":"mydb","helpText":"Default database to connect to (can also be in connection string)"}]"#,
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"summary":"MongoDB document database with flexible schemas, aggregation pipelines, and Atlas cloud.","auth_type":"connection_string","auth_type_label":"Connection String","docs_url":"https://www.mongodb.com/docs/manual/reference/connection-string/","auth_methods":[{"id":"connection_string","label":"Connection String","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-redis",
            name: "redis",
            label: "Redis",
            color: "#DC382D",
            icon_url: "/icons/connectors/redis.svg",
            category: "database",
            fields: r#"[{"key":"connection_url","label":"Connection URL","type":"password","required":true,"placeholder":"redis://default:password@host:6379","helpText":"Redis connection URL (redis:// or rediss:// for TLS)"},{"key":"host","label":"Host","type":"text","required":false,"placeholder":"localhost","helpText":"Alternative: provide host/port/password separately"},{"key":"port","label":"Port","type":"text","required":false,"placeholder":"6379","helpText":"Redis port (default 6379)"},{"key":"password","label":"Password","type":"password","required":false,"placeholder":"","helpText":"Redis AUTH password"}]"#,
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"summary":"Redis in-memory data store for caching, queues, sessions, and real-time pub/sub.","auth_type":"connection_string","auth_type_label":"Connection URL","docs_url":"https://redis.io/docs/latest/develop/connect/","auth_variants":[{"id":"connection_url","label":"Connection URL","fields":["connection_url"],"auth_type_label":"Connection URL"},{"id":"individual","label":"Individual Fields","fields":["host","port","password"],"auth_type_label":"Host/Port"}],"auth_methods":[{"id":"connection_url","label":"Connection URL","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-duckdb",
            name: "duckdb",
            label: "DuckDB",
            color: "#FFC107",
            icon_url: "/icons/connectors/duckdb.svg",
            category: "database",
            fields: r#"[{"key":"database_path","label":"Database Path","type":"text","required":true,"placeholder":"/path/to/data.duckdb","helpText":"File path to the DuckDB database (or :memory: for in-memory)"},{"key":"motherduck_token","label":"MotherDuck Token","type":"password","required":false,"placeholder":"eyJ...","helpText":"Optional: MotherDuck service token for cloud-hosted DuckDB"}]"#,
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"summary":"DuckDB embedded analytical database for OLAP workloads, Parquet, CSV, and JSON.","auth_type":"file_path","auth_type_label":"Database Path","docs_url":"https://duckdb.org/docs/connect/overview","auth_variants":[{"id":"local","label":"Local File","fields":["database_path"],"auth_type_label":"Database Path"},{"id":"motherduck","label":"MotherDuck Cloud","fields":["database_path","motherduck_token"],"auth_type_label":"MotherDuck Token"}],"auth_methods":[{"id":"file_path","label":"Database Path","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-twilio-sms",
            name: "twilio_sms",
            label: "Twilio",
            color: "#F22F46",
            icon_url: "/icons/connectors/twilio.svg",
            category: "messaging",
            fields: r#"[{"key":"account_sid","label":"Account SID","type":"text","required":true,"placeholder":"AC...","helpText":"From Twilio Console -> Account -> Account SID"},{"key":"auth_token","label":"Auth Token","type":"password","required":true,"placeholder":"","helpText":"From Twilio Console -> Account -> Auth Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.twilio.com/2010-04-01/Accounts/{{account_sid}}.json","method":"GET","headers":{"Authorization":"Basic {{base64(account_sid:auth_token)}}"},"description":"Validates credentials via Twilio account endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Twilio SMS, voice, WhatsApp, and communication APIs.","auth_type":"basic","auth_type_label":"Account SID","docs_url":"https://www.twilio.com/docs/usage/api","auth_methods":[{"id":"basic","label":"Account SID","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-n8n",
            name: "n8n",
            label: "n8n",
            color: "#EA4B71",
            icon_url: "/icons/connectors/n8n.svg",
            category: "automation",
            fields: r#"[{"key":"base_url","label":"Instance URL","type":"url","required":true,"placeholder":"https://your-instance.n8n.cloud","helpText":"Your n8n instance URL (cloud or self-hosted)"},{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"n8n_api_...","helpText":"Generate at Settings -> API -> Create API Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{base_url}}/api/v1/workflows?limit=1","method":"GET","headers":{"X-N8N-API-KEY":"{{api_key}}"},"description":"Validates API key by listing workflows"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"n8n workflow automation platform -- connect to push, activate, and trigger workflows directly from your agent.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://docs.n8n.io/api/","is_platform":true,"platform_type":"n8n","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-zapier",
            name: "zapier",
            label: "Zapier",
            color: "#FF4A00",
            icon_url: "/icons/connectors/zapier.svg",
            category: "automation",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"","helpText":"From zapier.com/app/developer -> API Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.zapier.com/v1/profiles/me","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via Zapier profiles endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Zapier automation platform -- trigger Zaps via webhooks and manage workflows from your agent.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://platform.zapier.com/reference/introduction","is_platform":true,"platform_type":"zapier","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-github-actions",
            name: "github_actions",
            label: "GitHub Actions",
            color: "#2088FF",
            icon_url: "/icons/connectors/github.svg",
            category: "automation",
            fields: r#"[{"key":"personal_access_token","label":"Personal Access Token","type":"password","required":true,"placeholder":"ghp_...","helpText":"Generate at github.com/settings/tokens -- needs 'repo' and 'workflow' scopes"},{"key":"default_repo","label":"Default Repository","type":"text","required":false,"placeholder":"owner/repo","helpText":"Optional: default repository for workflow dispatches"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.github.com/user","method":"GET","headers":{"Authorization":"Bearer {{personal_access_token}}","Accept":"application/vnd.github+json","User-Agent":"personas-desktop"},"description":"Validates PAT via GitHub user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"GitHub Actions CI/CD -- dispatch workflows, check run status, and manage automations from your agent.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://github.com/settings/tokens","is_platform":true,"platform_type":"github_actions","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        // -- Desktop App Connectors ------------------------------------
        BuiltinConnector {
            id: "builtin-desktop-vscode",
            name: "desktop_vscode",
            label: "VS Code",
            color: "#007ACC",
            icon_url: "/icons/connectors/vscode.svg",
            category: "desktop",
            fields: r#"[{"key":"binary_path","label":"Binary Path","type":"text","required":false,"placeholder":"code","helpText":"Auto-detected. Override if VS Code is installed in a custom location."},{"key":"workspace_path","label":"Workspace Path","type":"text","required":false,"placeholder":"/path/to/project","helpText":"Optional: default workspace for file operations"}]"#,
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"summary":"VS Code desktop integration -- open files, run tasks, manage extensions, and navigate code from your agent.","auth_type":"local","auth_type_label":"Local App","is_desktop":true,"required_capabilities":["process_spawn","file_read","network_local"],"auth_methods":[{"id":"local","label":"Local App","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-desktop-docker",
            name: "desktop_docker",
            label: "Docker",
            color: "#2496ED",
            icon_url: "/icons/connectors/docker.svg",
            category: "desktop",
            fields: r#"[{"key":"binary_path","label":"Binary Path","type":"text","required":false,"placeholder":"docker","helpText":"Auto-detected. Override if Docker is installed in a custom location."},{"key":"default_compose_path","label":"Docker Compose Path","type":"text","required":false,"placeholder":"./docker-compose.yml","helpText":"Optional: default compose file for stack operations"}]"#,
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"summary":"Docker desktop integration -- manage containers, images, volumes, and compose stacks from your agent.","auth_type":"local","auth_type_label":"Local App","is_desktop":true,"required_capabilities":["process_spawn","network_local"],"auth_methods":[{"id":"local","label":"Local App","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-desktop-terminal",
            name: "desktop_terminal",
            label: "Terminal",
            color: "#4D4D4D",
            icon_url: "/icons/connectors/terminal.svg",
            category: "desktop",
            fields: r#"[{"key":"shell","label":"Shell","type":"text","required":false,"placeholder":"bash","helpText":"Auto-detected. Override to use a specific shell (bash, zsh, powershell, etc.)"},{"key":"working_directory","label":"Working Directory","type":"text","required":false,"placeholder":"/home/user/projects","helpText":"Optional: default directory for command execution"}]"#,
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"summary":"Terminal integration -- execute shell commands, run scripts, and interact with CLI tools from your agent.","auth_type":"local","auth_type_label":"Local App","is_desktop":true,"required_capabilities":["process_spawn","file_read","file_write","env_read"],"auth_methods":[{"id":"local","label":"Local App","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-desktop-obsidian",
            name: "desktop_obsidian",
            label: "Obsidian",
            color: "#7C3AED",
            icon_url: "/icons/connectors/obsidian.svg",
            category: "desktop",
            fields: r#"[{"key":"vault_path","label":"Vault Path","type":"text","required":true,"placeholder":"/path/to/vault","helpText":"Path to your Obsidian vault directory"},{"key":"api_port","label":"Local REST API Port","type":"text","required":false,"placeholder":"27123","helpText":"Port for Obsidian Local REST API plugin (default: 27123)"},{"key":"api_key","label":"API Key","type":"password","required":false,"placeholder":"","helpText":"API key from Obsidian Local REST API plugin settings"}]"#,
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"summary":"Obsidian desktop integration -- read, create, and search notes in your vault from your agent.","auth_type":"local","auth_type_label":"Local App","is_desktop":true,"required_capabilities":["file_read","file_write","network_local"],"auth_methods":[{"id":"local","label":"Local App","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-desktop-browser",
            name: "desktop_browser",
            label: "Browser (Chrome/Edge)",
            color: "#4285F4",
            icon_url: "/icons/connectors/chrome.svg",
            category: "desktop",
            fields: r#"[{"key":"binary_path","label":"Browser Path","type":"text","required":false,"placeholder":"chrome","helpText":"Auto-detected. Path to Chrome or Edge binary."},{"key":"cdp_port","label":"DevTools Port","type":"text","required":false,"placeholder":"9222","helpText":"Chrome DevTools Protocol port (default: 9222)"}]"#,
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"summary":"Browser automation via Chrome DevTools Protocol -- navigate pages, extract data, and automate web tasks.","auth_type":"local","auth_type_label":"Local App","is_desktop":true,"required_capabilities":["process_spawn","network_local"],"auth_methods":[{"id":"local","label":"Local App","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-personas-database",
            name: "personas_database",
            label: "Built-in Database",
            color: "#06B6D4",
            icon_url: "",
            category: "database",
            fields: "[]",
            healthcheck_config: None,
            metadata: Some(r#"{"template_enabled":true,"is_builtin":true,"always_active":true,"summary":"Local SQLite database managed by Personas. Available on first launch -- agents can create tables, store data, and run SQL queries without any external service.","auth_type":"builtin","auth_type_label":"Built-in","auth_methods":[{"id":"builtin","label":"Built-in","type":"credential","is_default":true}]}"#),
        },
        // -- Microsoft 365 --
        BuiltinConnector {
            id: "builtin-microsoft-excel",
            name: "microsoft_excel",
            label: "Microsoft Excel",
            color: "#217346",
            icon_url: "/icons/connectors/microsoft-excel.svg",
            category: "database",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://graph.microsoft.com/v1.0/me","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Microsoft OAuth token via Graph /me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Microsoft Excel spreadsheet automation for reading, writing, and managing workbook data via the Microsoft Graph API.","auth_type":"oauth","auth_type_label":"OAuth","oauth_type":"microsoft","docs_url":"https://learn.microsoft.com/en-us/graph/api/resources/excel","pricing_tier":"freemium","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-microsoft-calendar",
            name: "microsoft_calendar",
            label: "Microsoft Outlook Calendar",
            color: "#0078D4",
            icon_url: "/icons/connectors/microsoft-calendar.svg",
            category: "scheduling",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://graph.microsoft.com/v1.0/me","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Microsoft OAuth token via Graph /me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Microsoft Outlook Calendar scheduling for creating, reading, and managing calendar events via the Microsoft Graph API.","auth_type":"oauth","auth_type_label":"OAuth","oauth_type":"microsoft","docs_url":"https://learn.microsoft.com/en-us/graph/api/resources/calendar","pricing_tier":"freemium","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-microsoft-teams",
            name: "microsoft_teams",
            label: "Microsoft Teams",
            color: "#6264A7",
            icon_url: "/icons/connectors/microsoft-teams.svg",
            category: "messaging",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://graph.microsoft.com/v1.0/me","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Microsoft OAuth token via Graph /me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Microsoft Teams messaging for sending messages, managing channels, and team collaboration via the Microsoft Graph API.","auth_type":"oauth","auth_type_label":"OAuth","oauth_type":"microsoft","docs_url":"https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview","pricing_tier":"freemium","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-onedrive",
            name: "onedrive",
            label: "OneDrive",
            color: "#0078D4",
            icon_url: "/icons/connectors/onedrive.svg",
            category: "productivity",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://graph.microsoft.com/v1.0/me/drive","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Microsoft OAuth token via Graph /me/drive endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"OneDrive file storage and document management for uploading, downloading, and organizing files via the Microsoft Graph API.","auth_type":"oauth","auth_type_label":"OAuth","oauth_type":"microsoft","docs_url":"https://learn.microsoft.com/en-us/graph/api/resources/onedrive","pricing_tier":"freemium","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-sharepoint",
            name: "sharepoint",
            label: "SharePoint",
            color: "#038387",
            icon_url: "/icons/connectors/sharepoint.svg",
            category: "productivity",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://graph.microsoft.com/v1.0/me","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Microsoft OAuth token via Graph /me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"SharePoint document management and team sites for storing, organizing, and collaborating on content via the Microsoft Graph API.","auth_type":"oauth","auth_type_label":"OAuth","oauth_type":"microsoft","docs_url":"https://learn.microsoft.com/en-us/graph/api/resources/sharepoint","pricing_tier":"freemium","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true}]}"#),
        },
        // -- Google Calendar --
        BuiltinConnector {
            id: "builtin-google-calendar",
            name: "google_calendar",
            label: "Google Calendar",
            color: "#4285F4",
            icon_url: "/icons/connectors/google-calendar.svg",
            category: "scheduling",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://www.googleapis.com/oauth2/v1/userinfo?alt=json","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Google OAuth identity access"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Google Calendar scheduling for creating, reading, and managing calendar events via the Calendar API v3.","auth_type":"oauth","auth_type_label":"OAuth","oauth_type":"google","docs_url":"https://developers.google.com/calendar/api/v3/reference","pricing_tier":"freemium","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true}]}"#),
        },
        // -- Design --
        BuiltinConnector {
            id: "builtin-canva",
            name: "canva",
            label: "Canva",
            color: "#00C4CC",
            icon_url: "/icons/connectors/canva.svg",
            category: "design",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"CNV...","helpText":"Generate at canva.com/developers -> Your Apps -> Generate Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.canva.com/rest/v1/users/me","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Canva /users/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Canva design platform for creating, managing, and exporting designs via the Canva Connect API.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://www.canva.dev/docs/connect/","pricing_tier":"freemium","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-penpot",
            name: "penpot",
            label: "Penpot",
            color: "#0D1117",
            icon_url: "/icons/connectors/penpot.svg",
            category: "design",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"","helpText":"Generate at your Penpot instance -> Profile -> Access Tokens"},{"key":"base_url","label":"Instance URL","type":"url","required":false,"placeholder":"https://design.penpot.app","helpText":"Your Penpot instance URL (defaults to penpot.app cloud)"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{base_url|https://design.penpot.app}}/api/rpc/command/get-profile","method":"GET","headers":{"Authorization":"Token {{access_token}}"},"description":"Validates access token via Penpot get-profile endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Penpot open-source design platform for prototyping, components, and design tokens.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://penpot.app/developers","pricing_tier":"free","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        // -- CRM --
        BuiltinConnector {
            id: "builtin-pipedrive",
            name: "pipedrive",
            label: "Pipedrive",
            color: "#017737",
            icon_url: "/icons/connectors/pipedrive.svg",
            category: "crm",
            fields: r#"[{"key":"api_token","label":"API Token","type":"password","required":true,"placeholder":"","helpText":"Go to Pipedrive -> Settings -> Personal preferences -> API -> Your personal API token"},{"key":"domain","label":"Company Domain","type":"text","required":true,"placeholder":"yourcompany","helpText":"Your Pipedrive subdomain (e.g., 'yourcompany' from yourcompany.pipedrive.com)"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://{{domain}}.pipedrive.com/api/v1/users/me?api_token={{api_token}}","method":"GET","headers":{},"description":"Validates API token via Pipedrive /users/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Pipedrive CRM for managing deals, contacts, activities, and sales pipelines via the Pipedrive REST API.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://developers.pipedrive.com/docs/api/v1","pricing_tier":"paid","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-attio",
            name: "attio",
            label: "Attio",
            color: "#4F46E5",
            icon_url: "/icons/connectors/attio.svg",
            category: "crm",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"","helpText":"Go to Attio -> Settings -> Developers -> API Access -> Generate a new token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.attio.com/v2/self","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Attio /v2/self endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Attio next-gen CRM for managing people, companies, deals, and custom objects via the Attio API v2.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://developers.attio.com/reference","pricing_tier":"freemium","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        // -- Support --
        BuiltinConnector {
            id: "builtin-crisp",
            name: "crisp",
            label: "Crisp",
            color: "#4B60F5",
            icon_url: "/icons/connectors/crisp.svg",
            category: "support",
            fields: r#"[{"key":"token_id","label":"Token ID","type":"text","required":true,"placeholder":"","helpText":"From Crisp -> Settings -> API Tokens -> Token Identifier"},{"key":"token_key","label":"Token Key","type":"password","required":true,"placeholder":"","helpText":"From Crisp -> Settings -> API Tokens -> Token Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.crisp.chat/v1/website","method":"GET","headers":{"Authorization":"Basic {{base64(token_id:token_key)}}","X-Crisp-Tier":"plugin"},"description":"Validates API token via Crisp website list endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Crisp customer messaging platform for live chat, helpdesk, and knowledge base via the Crisp REST API.","auth_type":"basic","auth_type_label":"Token Pair","docs_url":"https://docs.crisp.chat/references/rest-api/v1/","pricing_tier":"freemium","auth_methods":[{"id":"basic","label":"Token Pair","type":"credential","is_default":true}]}"#),
        },
        // -- E-Commerce --
        BuiltinConnector {
            id: "builtin-woocommerce",
            name: "woocommerce",
            label: "WooCommerce",
            color: "#96588A",
            icon_url: "/icons/connectors/woocommerce.svg",
            category: "commerce",
            fields: r#"[{"key":"base_url","label":"Store URL","type":"url","required":true,"placeholder":"https://yourstore.com","helpText":"Your WooCommerce store URL"},{"key":"consumer_key","label":"Consumer Key","type":"text","required":true,"placeholder":"ck_...","helpText":"From WooCommerce -> Settings -> Advanced -> REST API -> Add Key"},{"key":"consumer_secret","label":"Consumer Secret","type":"password","required":true,"placeholder":"cs_...","helpText":"From the same REST API key page"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{base_url}}/wp-json/wc/v3/system_status?consumer_key={{consumer_key}}&consumer_secret={{consumer_secret}}","method":"GET","headers":{},"description":"Validates API keys via WooCommerce system status endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"WooCommerce open-source e-commerce platform for managing orders, products, and customers via the WooCommerce REST API v3.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://woocommerce.github.io/woocommerce-rest-api-docs/","pricing_tier":"free","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-lemonsqueezy",
            name: "lemonsqueezy",
            label: "Lemon Squeezy",
            color: "#FFC233",
            icon_url: "/icons/connectors/lemonsqueezy.svg",
            category: "commerce",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"","helpText":"Go to app.lemonsqueezy.com -> Settings -> API -> Create API Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.lemonsqueezy.com/v1/users/me","method":"GET","headers":{"Accept":"application/vnd.api+json","Authorization":"Bearer {{api_key}}"},"description":"Validates API key via Lemon Squeezy /users/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Lemon Squeezy digital commerce platform for selling digital products, subscriptions, and SaaS via the Lemon Squeezy API v1.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://docs.lemonsqueezy.com/api","pricing_tier":"freemium","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        // -- Storage --
        BuiltinConnector {
            id: "builtin-aws-s3",
            name: "aws_s3",
            label: "AWS S3",
            color: "#569A31",
            icon_url: "/icons/connectors/aws-s3.svg",
            category: "storage",
            fields: r#"[{"key":"access_key_id","label":"Access Key ID","type":"text","required":true,"placeholder":"AKIA...","helpText":"From AWS IAM -> Users -> Security credentials -> Access keys"},{"key":"secret_access_key","label":"Secret Access Key","type":"password","required":true,"placeholder":"","helpText":"From the same IAM access key creation page"},{"key":"region","label":"Region","type":"text","required":true,"placeholder":"us-east-1","helpText":"AWS region for your S3 bucket"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://s3.{{region}}.amazonaws.com/","method":"GET","headers":{"Authorization":"AWS4-HMAC-SHA256 {{access_key_id}}"},"description":"Validates S3 credentials via bucket listing"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"AWS S3 object storage for uploading, downloading, and managing files and buckets.","auth_type":"api_key","auth_type_label":"Access Key","docs_url":"https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html","pricing_tier":"freemium","auth_methods":[{"id":"api_key","label":"Access Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-cloudflare-r2",
            name: "cloudflare_r2",
            label: "Cloudflare R2",
            color: "#F38020",
            icon_url: "/icons/connectors/cloudflare-r2.svg",
            category: "storage",
            fields: r#"[{"key":"account_id","label":"Account ID","type":"text","required":true,"placeholder":"","helpText":"From Cloudflare dashboard -> Overview -> Account ID"},{"key":"access_key_id","label":"R2 Access Key ID","type":"text","required":true,"placeholder":"","helpText":"From Cloudflare -> R2 -> Manage R2 API Tokens"},{"key":"secret_access_key","label":"R2 Secret Access Key","type":"password","required":true,"placeholder":"","helpText":"From the same R2 API Token creation page"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.cloudflare.com/client/v4/accounts/{{account_id}}/r2/buckets","method":"GET","headers":{"Authorization":"Bearer {{secret_access_key}}"},"description":"Validates R2 credentials via bucket listing"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Cloudflare R2 S3-compatible object storage with zero egress fees for storing and serving files.","auth_type":"api_key","auth_type_label":"API Token","docs_url":"https://developers.cloudflare.com/r2/api/","pricing_tier":"freemium","auth_methods":[{"id":"api_key","label":"API Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-backblaze-b2",
            name: "backblaze_b2",
            label: "Backblaze B2",
            color: "#E21E29",
            icon_url: "/icons/connectors/backblaze-b2.svg",
            category: "storage",
            fields: r#"[{"key":"application_key_id","label":"Application Key ID","type":"text","required":true,"placeholder":"","helpText":"From Backblaze -> App Keys -> Add a New Application Key"},{"key":"application_key","label":"Application Key","type":"password","required":true,"placeholder":"","helpText":"Shown once when creating the key -- copy immediately"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.backblazeb2.com/b2api/v3/b2_authorize_account","method":"GET","headers":{"Authorization":"Basic {{base64(application_key_id:application_key)}}"},"description":"Validates credentials via B2 authorize_account endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Backblaze B2 affordable S3-compatible cloud object storage for backups, archives, and media.","auth_type":"basic","auth_type_label":"Application Key","docs_url":"https://www.backblaze.com/docs/cloud-storage","pricing_tier":"freemium","auth_methods":[{"id":"basic","label":"Application Key","type":"credential","is_default":true}]}"#),
        },
        // -- Forms --
        BuiltinConnector {
            id: "builtin-tally",
            name: "tally",
            label: "Tally",
            color: "#3CCF91",
            icon_url: "/icons/connectors/tally.svg",
            category: "forms",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"","helpText":"Go to tally.so -> Settings -> Integrations -> API -> Generate access token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.tally.so/me","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Tally /me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Tally free-first form builder for creating forms, surveys, and collecting responses via the Tally API.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://tally.so/help/developer-resources","pricing_tier":"freemium","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-formbricks",
            name: "formbricks",
            label: "Formbricks",
            color: "#00C4B8",
            icon_url: "/icons/connectors/formbricks.svg",
            category: "forms",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"","helpText":"Go to Formbricks -> Settings -> API Keys -> Add API Key"},{"key":"base_url","label":"Instance URL","type":"url","required":false,"placeholder":"https://app.formbricks.com","helpText":"Your Formbricks instance URL (defaults to formbricks.com cloud)"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{base_url|https://app.formbricks.com}}/api/v1/me","method":"GET","headers":{"x-api-key":"{{api_key}}"},"description":"Validates API key via Formbricks /me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Formbricks open-source survey and feedback platform for in-app surveys, links, and website pop-ups.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://formbricks.com/docs/api/overview","pricing_tier":"free","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        // -- Notifications --
        BuiltinConnector {
            id: "builtin-novu",
            name: "novu",
            label: "Novu",
            color: "#FF4981",
            icon_url: "/icons/connectors/novu.svg",
            category: "notifications",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"","helpText":"From Novu dashboard -> Settings -> API Keys"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.novu.co/v1/environments/me","method":"GET","headers":{"Authorization":"ApiKey {{api_key}}"},"description":"Validates API key via Novu environment endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Novu open-source notification infrastructure for in-app, email, SMS, push, and chat notifications via the Novu API.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://docs.novu.co/api-reference/overview","pricing_tier":"freemium","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-knock",
            name: "knock",
            label: "Knock",
            color: "#6C47FF",
            icon_url: "/icons/connectors/knock.svg",
            category: "notifications",
            fields: r#"[{"key":"api_key","label":"Secret API Key","type":"password","required":true,"placeholder":"sk_...","helpText":"From Knock dashboard -> Developers -> API Keys -> Secret key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.knock.app/v1/users?page_size=1","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via Knock users list endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Knock notification infrastructure for orchestrating cross-channel notifications with preferences and workflows.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://docs.knock.app/reference","pricing_tier":"freemium","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-ntfy",
            name: "ntfy",
            label: "ntfy",
            color: "#317F6E",
            icon_url: "/icons/connectors/ntfy.svg",
            category: "notifications",
            fields: r#"[{"key":"base_url","label":"Server URL","type":"url","required":false,"placeholder":"https://ntfy.sh","helpText":"Your ntfy server URL (defaults to ntfy.sh public server)"},{"key":"access_token","label":"Access Token","type":"password","required":false,"placeholder":"tk_...","helpText":"Optional -- only needed for access-controlled topics"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{base_url|https://ntfy.sh}}/v1/health","method":"GET","headers":{},"description":"Validates ntfy server availability via health endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"ntfy open-source push notification service for sending notifications to phones and desktops via simple HTTP.","auth_type":"pat","auth_type_label":"Access Token","docs_url":"https://docs.ntfy.sh/","pricing_tier":"free","auth_methods":[{"id":"pat","label":"Access Token","type":"credential","is_default":true}]}"#),
        },
    ];

    for c in connectors {
        conn.execute(
            "INSERT OR IGNORE INTO connector_definitions
             (id, name, label, icon_url, color, category, fields,
              healthcheck_config, services, events, metadata, is_builtin,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12)",
            params![c.id, c.name, c.label, c.icon_url, c.color, c.category, c.fields,
                    c.healthcheck_config, "[]", "[]", c.metadata, now],
        )?;

        // Update existing rows to refresh fields/metadata/category on app upgrade
        conn.execute(
            "UPDATE connector_definitions
             SET label = ?1, icon_url = ?2, fields = ?3, healthcheck_config = ?4, metadata = ?5, category = ?6, updated_at = ?7
             WHERE name = ?8 AND is_builtin = 1",
            params![c.label, c.icon_url, c.fields, c.healthcheck_config, c.metadata, c.category, now, c.name],
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
