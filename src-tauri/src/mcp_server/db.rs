//! DB pool for the MCP binary.
//!
//! Wraps the app's real [`crate::db::DbPool`] (an r2d2 SQLite pool) so the MCP
//! server can route persona create/execute and API-key auth through the SAME
//! repository layer the windowed app uses — no forked SQL, no parallel auth.
//!
//! The pool attaches to an **already-initialized** `personas.db` (the windowed
//! app owns migrations/seeds); [`open_pool`] only verifies the expected schema
//! is present. Existing raw-SQL tool handlers keep working via [`McpDbPool::get`],
//! which yields a pooled connection (deref-compatible with the old single-conn
//! guard); repo-routed handlers reach the pool via [`McpDbPool::pool`].

use std::path::Path;

use crate::db::DbPool;

pub struct McpDbPool {
    pool: DbPool,
}

impl McpDbPool {
    /// A pooled connection for raw-SQL tool handlers. Returns a `String` error to
    /// preserve the handlers' `Result<_, String>` signatures.
    pub fn get(
        &self,
    ) -> Result<r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>, String> {
        self.pool.get().map_err(|e| format!("DB pool error: {e}"))
    }

    /// The underlying app `DbPool`, for handlers that route through the shared
    /// repository layer (`personas::create`, `executions::create`,
    /// `external_api_keys::find_by_token`, `api_key_audit::insert`, …).
    pub fn pool(&self) -> &DbPool {
        &self.pool
    }

    /// Wrap an existing pool. Used by tests to attach an in-memory/temp pool.
    #[cfg(test)]
    pub fn from_pool(pool: DbPool) -> Self {
        McpDbPool { pool }
    }
}

pub fn open_pool(path: &Path) -> Result<McpDbPool, String> {
    let pool = crate::db::open_pool_at(path)
        .map_err(|e| format!("Failed to open DB at {}: {e}", path.display()))?;

    {
        let conn = pool.get().map_err(|e| format!("DB pool error: {e}"))?;
        verify_schema(&conn, path)?;
    }

    Ok(McpDbPool { pool })
}

fn verify_schema(conn: &rusqlite::Connection, path: &Path) -> Result<(), String> {
    let has_personas: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='personas'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Schema check failed: {e}"))?;

    if !has_personas {
        return Err(format!(
            "Database at {} does not contain the expected schema (missing 'personas' table). \
             Ensure the Personas desktop app has been launched at least once.",
            path.display(),
        ));
    }
    Ok(())
}
