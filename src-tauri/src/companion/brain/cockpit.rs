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
///
/// This is the LOW-LEVEL write — it overwrites everything. The compose
/// path (Athena's `compose_cockpit`) should call
/// [`save_cockpit_preserving_pinned`] instead, which extracts any
/// user-pinned widgets from the existing spec and merges them into the
/// new one. Direct callers (the pin flow itself, which already merges
/// against the loaded spec) use this function.
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

/// Save a cockpit spec while preserving any user-pinned widgets from the
/// previous spec. Used by Athena's `compose_cockpit` op so a user who
/// pins a widget doesn't lose it the next time Athena composes anything.
///
/// "Pinned" widgets are detected by a top-level `"pinned": true` field
/// on the widget object — `companion_pin_widget_to_cockpit` stamps this
/// flag. Athena's own `compose_cockpit` payloads never carry `pinned`,
/// so freshly-composed widgets stay non-pinned (and remain overwritable
/// by subsequent composes).
///
/// Pinned widgets are APPENDED after Athena's freshly-composed ones so
/// the layout Athena designed reads first; the user's persistent pins
/// follow as a tail section. Dedupes pinned widgets that already
/// appear in the new spec (same `kind` + same `config`) to avoid
/// rendering the same surface twice when Athena's compose happens to
/// match a pin.
pub fn save_cockpit_preserving_pinned(
    pool: &UserDbPool,
    new_spec_json: &str,
) -> Result<(), AppError> {
    let merged_json = match merge_with_pinned(pool, new_spec_json)? {
        Some(merged) => merged,
        None => new_spec_json.to_string(),
    };
    save_cockpit(pool, &merged_json)
}

/// Pure helper: load existing cockpit, extract pinned widgets, append
/// them to `new_spec_json`'s widgets array (dropping duplicates), return
/// the merged JSON. Returns `None` if no merge was needed (no current
/// spec, no pinned widgets, or new spec malformed — falls back to plain
/// save with the new spec as-is).
fn merge_with_pinned(
    pool: &UserDbPool,
    new_spec_json: &str,
) -> Result<Option<String>, AppError> {
    let prior = match load_cockpit(pool)? {
        Some(c) => c,
        None => return Ok(None),
    };
    let prior_spec: serde_json::Value = match serde_json::from_str(&prior.spec_json) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let pinned: Vec<serde_json::Value> = prior_spec
        .get("widgets")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|w| w.get("pinned").and_then(|p| p.as_bool()).unwrap_or(false))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    if pinned.is_empty() {
        return Ok(None);
    }
    let mut new_spec: serde_json::Value = match serde_json::from_str(new_spec_json) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let new_widgets = match new_spec
        .get_mut("widgets")
        .and_then(|v| v.as_array_mut())
    {
        Some(arr) => arr,
        None => return Ok(None),
    };
    // Dedupe — skip pinned widgets whose (kind, config) is already in the
    // freshly-composed spec. Athena re-composing a surface she's pinned
    // to shouldn't render it twice.
    for pin in pinned {
        let pin_kind = pin.get("kind").and_then(|v| v.as_str());
        let pin_config = pin.get("config").unwrap_or(&serde_json::Value::Null);
        let dup = new_widgets.iter().any(|w| {
            w.get("kind").and_then(|v| v.as_str()) == pin_kind
                && w.get("config").unwrap_or(&serde_json::Value::Null) == pin_config
        });
        if !dup {
            new_widgets.push(pin);
        }
    }
    Ok(Some(new_spec.to_string()))
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
