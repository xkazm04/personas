//! Cockpit composition. A singleton spec stored as a markdown body on a single
//! `companion_node` row (`kind='cockpit'`, `id='cockpit'`). Athena's
//! `compose_cockpit` op overwrites the spec; the frontend re-reads on next
//! Home → Cockpit open.
//!
//! Storage layout mirrors `dashboard.rs` — the spec is the metadata, so
//! `companion_node` alone plus the markdown file under `cockpit.md` is enough.

use std::fs;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::companion::disk;
use crate::db::UserDbPool;
use crate::error::AppError;

const COCKPIT_ID: &str = "cockpit";
const COCKPIT_REL_PATH: &str = "cockpit.md";

/// Save (insert or replace) the cockpit spec. `spec_json` is the
/// already-serialized JSON body the frontend will parse.
pub fn save_cockpit(pool: &UserDbPool, spec_json: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let abs_path = disk::brain_root()?.join(COCKPIT_REL_PATH);
    fs::write(&abs_path, spec_json)?;
    let hash = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(spec_json.as_bytes()))
    );
    let excerpt = excerpt_500(spec_json);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'cockpit', ?2, ?3, 3, ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET
             content_hash = excluded.content_hash,
             body_excerpt = excluded.body_excerpt,
             updated_at = excluded.updated_at",
        params![COCKPIT_ID, COCKPIT_REL_PATH, hash, excerpt, now],
    )?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct Cockpit {
    pub spec_json: String,
    pub updated_at: String,
}

/// Read the current cockpit spec. Returns `None` if Athena hasn't composed one
/// yet (the Cockpit page will show an empty state).
pub fn load_cockpit(pool: &UserDbPool) -> Result<Option<Cockpit>, AppError> {
    let conn = pool.get()?;
    let row: Option<String> = conn
        .query_row(
            "SELECT updated_at FROM companion_node WHERE id = ?1 AND kind = 'cockpit'",
            params![COCKPIT_ID],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    let Some(updated_at) = row else {
        return Ok(None);
    };
    let path = disk::brain_root()?.join(COCKPIT_REL_PATH);
    let spec_json = fs::read_to_string(&path).unwrap_or_default();
    if spec_json.is_empty() {
        return Ok(None);
    }
    Ok(Some(Cockpit {
        spec_json,
        updated_at,
    }))
}

fn excerpt_500(s: &str) -> String {
    if s.len() <= 500 {
        return s.to_string();
    }
    let mut end = 500;
    while !s.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    s[..end].to_string()
}
