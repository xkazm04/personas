//! Reply register: how long Athena's layer-one reply may be.
//!
//! Layer one of the layered voice is a short reply of at most N sentences,
//! with natural-language reference links into layer two (reports, decisions,
//! cards, sessions, jobs, memories). N starts at [`LAYER_ONE_BASE_SENTENCES`]
//! and adapts: the operator can pin it, and the reflection pass can move it
//! (`adjust_register` op), per scope. `scope = "default"` is the global
//! register; any other scope is a topic override.
//!
//! Contract: `docs/features/companion/layered-voice.md`. Storage:
//! `companion_reply_register` in the companion USER database (`COMPANION_SCHEMA`
//! in `src-tauri/db/src/lib.rs`), next to `companion_chat_card`.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::UserDbPool;
use crate::error::AppError;

/// The register a fresh install starts with, and the fallback when the
/// `default` row is missing or unreadable.
pub const LAYER_ONE_BASE_SENTENCES: u8 = 3;

/// Inclusive bounds the table's CHECK constraint also enforces.
pub const MIN_SENTENCES: u8 = 1;
pub const MAX_SENTENCES: u8 = 8;

/// The scope name of the global register.
pub const DEFAULT_SCOPE: &str = "default";

/// Who set a register row.
pub const VALID_SOURCES: &[&str] = &["operator", "reflection"];

/// Longest scope name accepted. A topic is a short label, not a sentence.
const MAX_SCOPE_CHARS: usize = 64;

/// Longest stored reason.
const MAX_REASON_CHARS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReplyRegisterRow {
    pub scope: String,
    #[ts(type = "number")]
    pub sentences: u8,
    /// `operator` | `reflection`.
    pub source: String,
    pub reason: Option<String>,
    pub updated_at: String,
}

/// The register the prompt composer applies this turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveRegister {
    /// The `default` row's value, or [`LAYER_ONE_BASE_SENTENCES`].
    pub default_sentences: u8,
    /// Every non-default scope, as `(scope, sentences)`, sorted by scope.
    pub overrides: Vec<(String, u8)>,
}

/// All register rows, `default` first, then topics alphabetically.
pub fn list(pool: &UserDbPool) -> Result<Vec<ReplyRegisterRow>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT scope, sentences, source, reason, updated_at
           FROM companion_reply_register
          ORDER BY CASE WHEN scope = 'default' THEN 0 ELSE 1 END, scope",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let sentences: i64 = r.get("sentences")?;
            Ok(ReplyRegisterRow {
                scope: r.get("scope")?,
                // The CHECK constraint holds it to 1..=8; clamp rather than
                // trust, so a hand-edited row cannot wrap.
                sentences: sentences.clamp(MIN_SENTENCES as i64, MAX_SENTENCES as i64) as u8,
                source: r.get("source")?,
                reason: r.get("reason")?,
                updated_at: r.get("updated_at")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert or replace one scope's register.
pub fn upsert(
    pool: &UserDbPool,
    scope: &str,
    sentences: u8,
    source: &str,
    reason: Option<&str>,
) -> Result<(), AppError> {
    let scope = scope.trim();
    if scope.is_empty() {
        return Err(AppError::Validation(
            "reply register: scope is required".into(),
        ));
    }
    if scope.chars().count() > MAX_SCOPE_CHARS {
        return Err(AppError::Validation(format!(
            "reply register: scope exceeds {MAX_SCOPE_CHARS} characters"
        )));
    }
    if !(MIN_SENTENCES..=MAX_SENTENCES).contains(&sentences) {
        return Err(AppError::Validation(format!(
            "reply register: sentences must be {MIN_SENTENCES}..={MAX_SENTENCES}, got {sentences}"
        )));
    }
    if !VALID_SOURCES.contains(&source) {
        return Err(AppError::Validation(format!(
            "reply register: unknown source `{source}`"
        )));
    }
    let reason: Option<String> = reason
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(|r| r.chars().take(MAX_REASON_CHARS).collect());

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_reply_register (scope, sentences, source, reason, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(scope) DO UPDATE SET
             sentences  = excluded.sentences,
             source     = excluded.source,
             reason     = excluded.reason,
             updated_at = excluded.updated_at",
        params![scope, sentences as i64, source, reason],
    )?;
    Ok(())
}

/// The register to apply. Never fails: an unreadable table degrades to the
/// base register with no overrides, because a reply must still be composed.
pub fn effective(pool: &UserDbPool) -> EffectiveRegister {
    let rows = match list(pool) {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "reply register unreadable; using the base register");
            Vec::new()
        }
    };
    let mut default_sentences = LAYER_ONE_BASE_SENTENCES;
    let mut overrides = Vec::new();
    for row in rows {
        if row.scope == DEFAULT_SCOPE {
            default_sentences = row.sentences;
        } else {
            overrides.push((row.scope, row.sentences));
        }
    }
    overrides.sort_by(|a, b| a.0.cmp(&b.0));
    EffectiveRegister {
        default_sentences,
        overrides,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool() -> Result<UserDbPool, AppError> {
        crate::db::init_test_user_db()
    }

    #[test]
    fn register_is_base_when_empty() -> Result<(), AppError> {
        let pool = pool()?;
        assert!(list(&pool)?.is_empty());
        assert_eq!(
            effective(&pool),
            EffectiveRegister {
                default_sentences: LAYER_ONE_BASE_SENTENCES,
                overrides: Vec::new(),
            }
        );
        Ok(())
    }

    #[test]
    fn register_upsert_replaces_and_orders_default_first() -> Result<(), AppError> {
        let pool = pool()?;
        upsert(&pool, "zeta", 5, "reflection", Some("long answers wanted"))?;
        upsert(&pool, "default", 2, "operator", None)?;
        upsert(&pool, "alpha", 4, "operator", Some("  "))?;
        upsert(&pool, "default", 3, "reflection", Some("back to base"))?;

        let rows = list(&pool)?;
        let scopes: Vec<&str> = rows.iter().map(|r| r.scope.as_str()).collect();
        assert_eq!(scopes, ["default", "alpha", "zeta"]);
        assert_eq!(rows[0].sentences, 3);
        assert_eq!(rows[0].source, "reflection");
        assert_eq!(rows[0].reason.as_deref(), Some("back to base"));
        // A blank reason is stored as absent, not as an empty string.
        assert_eq!(rows[1].reason, None);

        let eff = effective(&pool);
        assert_eq!(eff.default_sentences, 3);
        assert_eq!(
            eff.overrides,
            vec![("alpha".to_string(), 4), ("zeta".to_string(), 5)]
        );
        Ok(())
    }

    #[test]
    fn register_upsert_rejects_out_of_contract_values() -> Result<(), AppError> {
        let pool = pool()?;
        assert!(upsert(&pool, "default", 0, "operator", None).is_err());
        assert!(upsert(&pool, "default", 9, "operator", None).is_err());
        assert!(upsert(&pool, "default", 3, "athena", None).is_err());
        assert!(upsert(&pool, "   ", 3, "operator", None).is_err());
        assert!(upsert(&pool, &"x".repeat(65), 3, "operator", None).is_err());
        assert!(list(&pool)?.is_empty());
        Ok(())
    }

    #[test]
    fn register_table_check_constraint_holds_without_the_validator() -> Result<(), AppError> {
        let pool = pool()?;
        let conn = pool.get()?;
        let bad_count = conn.execute(
            "INSERT INTO companion_reply_register (scope, sentences, source) VALUES ('x', 12, 'operator')",
            [],
        );
        assert!(bad_count.is_err());
        let bad_source = conn.execute(
            "INSERT INTO companion_reply_register (scope, sentences, source) VALUES ('x', 3, 'athena')",
            [],
        );
        assert!(bad_source.is_err());
        Ok(())
    }
}
