//! Per-turn sidecar persistence — the durable half of the companion's
//! rich per-turn layers.
//!
//! Every assistant turn produces four side channels that the FRONTEND
//! parses out of the Claude CLI stream: the narration / tool trail, the
//! TodoWrite plan, the dispatcher turn summary, and the recall preview.
//! Until now they lived only in the Zustand store, so an app restart
//! stripped every older bubble back to bare text and the dev
//! conversation-log export lost the side channels for pre-restart turns.
//!
//! These commands are a dumb key-value sidecar keyed by assistant episode
//! id. The backend never parses the payloads — each column is an opaque
//! JSON blob whose shape is owned by the frontend types
//! (`StoredNarration`, `TodoStep[]`, `StoredTurnSummary`,
//! `CompanionRecallPreview`). Writes are upserts that COALESCE, so the
//! two separate write moments (the `finished` stream event and the later
//! `turn-summary` event) layer onto one row without clobbering each
//! other.
//!
//! Plain rusqlite on the user DB, same convention as the sibling
//! companion command modules.

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::UserDbPool;
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

/// Hard cap on ids per batch read. A transcript page is 50 messages and
/// the export walks pages, so this is far above any real call; it exists
/// to keep a malformed caller from building a 100k-placeholder statement.
const MAX_BATCH_IDS: usize = 500;

/// Hard cap on a single JSON blob (chars). A narration trail is capped at
/// ~100 entries frontend-side; this is the backstop that keeps a runaway
/// stream from writing megabytes into the user DB.
const MAX_JSON_CHARS: usize = 200_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompanionTurnSidecar {
    pub episode_id: String,
    pub narration_json: Option<String>,
    pub steps_json: Option<String>,
    pub summary_json: Option<String>,
    pub recall_json: Option<String>,
}

fn clamp_blob(value: Option<String>) -> Option<String> {
    // Over-long blobs are dropped rather than truncated: a truncated JSON
    // document fails to parse on the way back out, which would render as a
    // silently broken trail. Dropping degrades to "no sidecar", which the
    // UI already handles (it's the pre-persistence behaviour).
    value.filter(|v| !v.is_empty() && v.chars().count() <= MAX_JSON_CHARS)
}

/// Upsert one episode's sidecars. `None` for a field leaves whatever was
/// already stored in place (COALESCE) — the `finished` event writes the
/// trail/plan/recall, and the later `turn-summary` event layers the
/// summary onto the same row.
pub fn save_sidecar(
    pool: &UserDbPool,
    episode_id: &str,
    narration_json: Option<String>,
    steps_json: Option<String>,
    summary_json: Option<String>,
    recall_json: Option<String>,
) -> Result<(), AppError> {
    let episode_id = episode_id.trim();
    if episode_id.is_empty() {
        return Err(AppError::Validation(
            "turn sidecar: episode id is required".into(),
        ));
    }
    let narration = clamp_blob(narration_json);
    let steps = clamp_blob(steps_json);
    let summary = clamp_blob(summary_json);
    let recall = clamp_blob(recall_json);
    if narration.is_none() && steps.is_none() && summary.is_none() && recall.is_none() {
        // Nothing worth a row. Not an error — a plain conversational turn
        // has no side channels at all and the frontend fires this
        // unconditionally.
        return Ok(());
    }
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_turn_sidecar
             (episode_id, narration_json, steps_json, summary_json, recall_json)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(episode_id) DO UPDATE SET
             narration_json = COALESCE(excluded.narration_json, companion_turn_sidecar.narration_json),
             steps_json     = COALESCE(excluded.steps_json,     companion_turn_sidecar.steps_json),
             summary_json   = COALESCE(excluded.summary_json,   companion_turn_sidecar.summary_json),
             recall_json    = COALESCE(excluded.recall_json,    companion_turn_sidecar.recall_json)",
        params![episode_id, narration, steps, summary, recall],
    )?;
    Ok(())
}

/// Batch-read sidecars for the given episode ids. Ids without a row are
/// simply absent from the result — the caller keys by `episodeId`.
pub fn get_sidecars(
    pool: &UserDbPool,
    episode_ids: &[String],
) -> Result<Vec<CompanionTurnSidecar>, AppError> {
    let ids: Vec<&str> = episode_ids
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .take(MAX_BATCH_IDS)
        .collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!(
        "SELECT episode_id, narration_json, steps_json, summary_json, recall_json
         FROM companion_turn_sidecar WHERE episode_id IN ({placeholders})"
    );
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok(CompanionTurnSidecar {
                episode_id: r.get(0)?,
                narration_json: r.get(1)?,
                steps_json: r.get(2)?,
                summary_json: r.get(3)?,
                recall_json: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn companion_save_turn_sidecar(
    state: State<'_, Arc<AppState>>,
    episode_id: String,
    narration_json: Option<String>,
    steps_json: Option<String>,
    summary_json: Option<String>,
    recall_json: Option<String>,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    save_sidecar(
        &state.user_db,
        &episode_id,
        narration_json,
        steps_json,
        summary_json,
        recall_json,
    )
}

#[tauri::command]
pub fn companion_get_turn_sidecars(
    state: State<'_, Arc<AppState>>,
    episode_ids: Vec<String>,
) -> Result<Vec<CompanionTurnSidecar>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    get_sidecars(&state.user_db, &episode_ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_pool() -> UserDbPool {
        use r2d2_sqlite::SqliteConnectionManager;
        let manager = SqliteConnectionManager::memory();
        let pool = r2d2::Pool::builder().max_size(1).build(manager).unwrap();
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE companion_turn_sidecar (
                    episode_id     TEXT PRIMARY KEY,
                    narration_json TEXT,
                    steps_json     TEXT,
                    summary_json   TEXT,
                    recall_json    TEXT,
                    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
                );",
            )
            .unwrap();
        pool
    }

    fn fetch_one(pool: &UserDbPool, id: &str) -> Option<CompanionTurnSidecar> {
        get_sidecars(pool, &[id.to_string()])
            .unwrap()
            .into_iter()
            .next()
    }

    #[test]
    fn round_trips_all_four_channels() {
        let pool = test_pool();
        save_sidecar(
            &pool,
            "ep_1",
            Some(r#"{"startedAt":1,"endedAt":2,"entries":[]}"#.into()),
            Some(r#"[{"content":"step","status":"completed"}]"#.into()),
            Some(r#"{"approvals":1}"#.into()),
            Some(r#"{"episodeCount":3}"#.into()),
        )
        .unwrap();
        let got = fetch_one(&pool, "ep_1").unwrap();
        assert_eq!(got.episode_id, "ep_1");
        assert_eq!(
            got.narration_json.as_deref(),
            Some(r#"{"startedAt":1,"endedAt":2,"entries":[]}"#)
        );
        assert_eq!(
            got.steps_json.as_deref(),
            Some(r#"[{"content":"step","status":"completed"}]"#)
        );
        assert_eq!(got.summary_json.as_deref(), Some(r#"{"approvals":1}"#));
        assert_eq!(got.recall_json.as_deref(), Some(r#"{"episodeCount":3}"#));
    }

    #[test]
    fn later_write_layers_without_clobbering() {
        let pool = test_pool();
        // `finished` writes trail + plan + recall…
        save_sidecar(
            &pool,
            "ep_2",
            Some("N".into()),
            Some("S".into()),
            None,
            Some("R".into()),
        )
        .unwrap();
        // …then the turn-summary event lands with only the summary.
        save_sidecar(&pool, "ep_2", None, None, Some("T".into()), None).unwrap();
        let got = fetch_one(&pool, "ep_2").unwrap();
        assert_eq!(got.narration_json.as_deref(), Some("N"));
        assert_eq!(got.steps_json.as_deref(), Some("S"));
        assert_eq!(got.summary_json.as_deref(), Some("T"));
        assert_eq!(got.recall_json.as_deref(), Some("R"));

        // A later non-null value DOES replace (a re-emitted trail wins).
        save_sidecar(&pool, "ep_2", Some("N2".into()), None, None, None).unwrap();
        assert_eq!(
            fetch_one(&pool, "ep_2").unwrap().narration_json.as_deref(),
            Some("N2")
        );
    }

    #[test]
    fn empty_write_is_a_noop_and_batch_read_skips_unknown_ids() {
        let pool = test_pool();
        save_sidecar(&pool, "ep_3", None, None, None, None).unwrap();
        assert!(
            fetch_one(&pool, "ep_3").is_none(),
            "no row for an empty write"
        );

        save_sidecar(&pool, "ep_4", Some("N".into()), None, None, None).unwrap();
        let got = get_sidecars(
            &pool,
            &["ep_3".into(), "ep_4".into(), "  ".into(), "nope".into()],
        )
        .unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].episode_id, "ep_4");

        assert!(get_sidecars(&pool, &[]).unwrap().is_empty());
    }

    #[test]
    fn rejects_blank_episode_id_and_drops_oversized_blobs() {
        let pool = test_pool();
        assert!(save_sidecar(&pool, "   ", Some("N".into()), None, None, None).is_err());

        let huge = "x".repeat(MAX_JSON_CHARS + 1);
        save_sidecar(&pool, "ep_5", Some(huge), Some("S".into()), None, None).unwrap();
        let got = fetch_one(&pool, "ep_5").unwrap();
        assert!(
            got.narration_json.is_none(),
            "oversized blob dropped, not truncated"
        );
        assert_eq!(got.steps_json.as_deref(), Some("S"));
    }
}
