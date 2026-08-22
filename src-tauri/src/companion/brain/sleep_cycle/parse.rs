//! Small shared helpers: reading an LLM reply as JSON, pulling typed fields
//! out of it, normalising a tag, and parsing a timestamp.
//!
//! Moved verbatim out of the former single-file `sleep_cycle.rs`.

use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::companion::brain::oneshot;
use crate::db::UserDbPool;
use crate::error::AppError;

// ── Small helpers ──────────────────────────────────────────────────────────

/// Parse an LLM reply into a JSON object, tolerant of a fence or preface.
/// An unparseable reply is a hard error: the cycle would otherwise report a
/// clean pass over a leg that returned nothing usable.
pub(super) fn parse_object(text: &str, label: &str) -> Result<Value, AppError> {
    let span = oneshot::extract_json_span(text, label)?;
    let v: Value = serde_json::from_str(span).map_err(|e| {
        AppError::Internal(format!(
            "{label} is not valid JSON: {e}; got: {}",
            oneshot::preview(span, 400)
        ))
    })?;
    if !v.is_object() {
        return Err(AppError::Internal(format!(
            "{label} must be a JSON object; got: {}",
            oneshot::preview(span, 200)
        )));
    }
    Ok(v)
}

pub(super) fn str_field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(super) fn str_opt(v: &Value, key: &str) -> Option<String> {
    let s = str_field(v, key);
    (!s.is_empty()).then_some(s)
}

/// Scope of a LIVE fact (`kind='fact'`, `importance > 0`), or `None`.
/// The gate every model-supplied fact id passes before it can move anything.
pub(super) fn live_fact_scope(
    pool: &UserDbPool,
    fact_id: &str,
) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let scope: Option<String> = conn
        .query_row(
            "SELECT f.scope FROM companion_fact f
             JOIN companion_node n ON n.id = f.id
             WHERE f.id = ?1 AND n.kind = 'fact' AND n.importance > 0",
            params![fact_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(scope)
}

/// Lowercase `[a-z0-9_]` slug, capped. Applied to BOTH sides of every tag
/// comparison so "Preference" and "preference" are one tag rather than two.
pub(super) fn normalize_tag(raw: &str) -> String {
    let mut out = String::new();
    let mut prev_us = false;
    for ch in raw.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_us = false;
        } else if !prev_us && !out.is_empty() {
            out.push('_');
            prev_us = true;
        }
        if out.len() >= 32 {
            break;
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    out
}

/// Collapse to one line and cap, for report bullets and prompt summaries.
pub(super) fn one_line(s: &str, cap: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= cap {
        flat
    } else {
        format!("{}…", flat.chars().take(cap).collect::<String>())
    }
}

/// RFC3339 first, then SQLite's `datetime('now')` shape. A `companion_cycle`
/// row can carry either: `begin_cycle` writes RFC3339, the column default
/// writes the other, and the interval gate must not silently fail open on the
/// second one.
pub(super) fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .ok()
        .and_then(|n| Utc.from_local_datetime(&n).single())
}
