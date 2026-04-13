//! Lightweight DB pool for the MCP binary (no Tauri dependency).

use std::path::Path;
use std::sync::Mutex;

pub struct McpDbPool {
    conn: Mutex<rusqlite::Connection>,
}

impl McpDbPool {
    pub fn get(&self) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
        self.conn.lock().map_err(|e| format!("DB lock error: {e}"))
    }
}

pub fn open_pool(path: &Path) -> Result<McpDbPool, String> {
    let conn = rusqlite::Connection::open(path)
        .map_err(|e| format!("Failed to open DB at {}: {e}", path.display()))?;

    // Enable WAL for concurrent reads
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
        .map_err(|e| format!("PRAGMA error: {e}"))?;

    verify_schema(&conn, path)?;

    Ok(McpDbPool {
        conn: Mutex::new(conn),
    })
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
