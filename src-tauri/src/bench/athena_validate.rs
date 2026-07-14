//! Athena turn-text validator for the model/effort bench (Track B of
//! `docs/plans/athena-live-conversation-layer.md`).
//!
//! Runs the REAL `companion::dispatcher::dispatch` over one turn's raw
//! assistant text against a throwaway, fully-migrated user DB, then reports
//! everything the turn did — approvals created, jobs enqueued, cards fired,
//! rejections warned — as one JSON object. The bench harness
//! (`scripts/test/athena-model-bench.mjs`) scores decision ability from this
//! report, so op parsing and param/enum validation can never drift from
//! production: they ARE production.

use crate::error::AppError;

/// Session id every bench dispatch runs under. Arbitrary — the throwaway DB
/// exists for exactly one validation.
const BENCH_SESSION: &str = "bench";

/// Validate one turn's raw assistant text. `pinned_connectors` seeds
/// `companion_active_connector` (enabled) so `use_connector` scenarios can
/// exercise the pin gate both ways — a fixture that pins `sentry` expects the
/// auto-fire path; one that doesn't expects the rejection warning.
pub fn validate(text: &str, pinned_connectors: &[String]) -> Result<serde_json::Value, AppError> {
    // Order matters for drop: the pool must die before the TempDir tries to
    // delete the DB file under it (Windows holds open files hostage).
    let tmp = tempfile::tempdir()
        .map_err(|e| AppError::Internal(format!("bench validate: temp dir: {e}")))?;
    let pool = crate::db::init_user_db(tmp.path())?;

    {
        let conn = pool.get()?;
        for name in pinned_connectors {
            conn.execute(
                "INSERT OR REPLACE INTO companion_active_connector
                 (connector_name, enabled, created_at, updated_at)
                 VALUES (?1, 1, datetime('now'), datetime('now'))",
                [name],
            )?;
        }
    }

    let d = crate::companion::dispatcher::dispatch(&pool, BENCH_SESSION, text)?;

    // Auto-fired background jobs land in the DB, not on `Dispatched` — read
    // them back so the harness sees what `use_connector` (and friends)
    // actually enqueued.
    let jobs: Vec<serde_json::Value> = {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT kind, short_title, params_json FROM companion_background_job
             ORDER BY rowid",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(serde_json::json!({
                "kind": r.get::<_, String>(0)?,
                "shortTitle": r.get::<_, Option<String>>(1)?,
                "params": serde_json::from_str::<serde_json::Value>(
                    &r.get::<_, String>(2)?
                ).unwrap_or(serde_json::Value::Null),
            }))
        })?;
        rows.filter_map(|r| r.ok()).collect()
    };

    // Machine grammar surviving into display text is a format-contract
    // violation the frontend would render verbatim.
    let leak = d
        .cleaned_text
        .lines()
        .map(str::trim_start)
        .any(|l| {
            l.starts_with("OP:")
                || l.starts_with("{\"op\"")
                || l.starts_with("QR:")
                || l.starts_with("TTS:")
                || l.starts_with("PROGRESS:")
        });

    Ok(serde_json::json!({
        "cleanedText": d.cleaned_text,
        "approvals": d.approvals,
        "navigations": d.navigations,
        "labOpens": d.lab_opens,
        "dashboards": d.dashboards.len(),
        "cockpits": d.cockpits.len(),
        "explainCockpits": d.explain_cockpits.len(),
        "chatCards": d.chat_cards,
        "guideWalkthroughs": d.guide_walkthroughs,
        "pointAts": d.point_ats,
        "composedWalkthroughs": d.composed_walkthroughs,
        "quickReplies": d.quick_replies,
        "ttsText": d.tts_text,
        "requestsContinuation": d.requests_continuation,
        "progressBeats": d.progress_beats,
        "warnings": d.warnings,
        "backgroundJobs": jobs,
        "machineGrammarLeak": leak,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_gated_op_lands_as_approval_not_job() {
        let text = "I'll log that.\nOP: {\"op\":\"propose_action\",\"action\":\"write_fact\",\"params\":{\"content\":\"user prefers dark mode\",\"sources\":[\"ep_current\"]},\"rationale\":\"stated directly\"}\nDone.";
        let v = validate(text, &[]).expect("validate ok");
        assert_eq!(v["approvals"].as_array().unwrap().len(), 1);
        assert_eq!(v["approvals"][0]["action"], "write_fact");
        assert_eq!(v["backgroundJobs"].as_array().unwrap().len(), 0);
        assert_eq!(v["machineGrammarLeak"], false);
    }

    #[test]
    fn unpinned_connector_is_rejected_with_warning() {
        let text = "Checking Sentry.\nOP: {\"op\":\"propose_action\",\"action\":\"use_connector\",\"params\":{\"connector_name\":\"sentry\",\"capability\":\"list_issues\"},\"rationale\":\"user asked\"}";
        let v = validate(text, &[]).expect("validate ok");
        assert_eq!(v["backgroundJobs"].as_array().unwrap().len(), 0);
        assert!(v["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w.as_str().unwrap_or_default().contains("not pinned")));
    }

    #[test]
    fn pinned_connector_read_capability_enqueues_job() {
        let text = "Checking Sentry.\nOP: {\"op\":\"propose_action\",\"action\":\"use_connector\",\"params\":{\"connector_name\":\"sentry\",\"capability\":\"list_issues\"},\"rationale\":\"user asked\"}";
        let v = validate(text, &["sentry".to_string()]).expect("validate ok");
        let jobs = v["backgroundJobs"].as_array().unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0]["kind"], "connector_use");
    }

    #[test]
    fn plain_prose_produces_nothing() {
        let v = validate("Sounds good — nice weekend plan!", &[]).expect("validate ok");
        assert_eq!(v["approvals"].as_array().unwrap().len(), 0);
        assert_eq!(v["backgroundJobs"].as_array().unwrap().len(), 0);
        assert_eq!(v["warnings"].as_array().unwrap().len(), 0);
    }
}
