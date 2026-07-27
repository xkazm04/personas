//! "Send to Athena" — the command surface for batch backlog triage.
//!
//! Two commands, one durable artifact between them:
//!
//! ```text
//!   dev_tools_athena_triage_batch(idea_ids)
//!        → one headless Athena turn (companion::proactive::backlog_triage)
//!        → PENDING companion_approval row (action `backlog_apply_triage`)
//!        → { approvalId, summary, items, skipped }   ← the verdict card
//!
//!   dev_tools_apply_triage_verdicts(approval_id, overrides)
//!        → idea writes FIRST (idempotent, via apply_idea_verdict_by)
//!        → approval row marked approved LAST
//! ```
//!
//! The approval row is the point. Athena's verdicts are a *proposal*: they are
//! persisted where every other Athena proposal lives, they survive a restart,
//! they expire through the same consent-freshness window, and they can be
//! confirmed through EITHER door — the normal Approvals card (which runs
//! `execute_backlog_apply_triage` verbatim) or the Backlog's verdict card,
//! which lets the user flip individual items first.
//!
//! **Pool-split safety.** Ideas live in `state.db`; approvals live in
//! `state.user_db`. There is no transaction spanning both, so the write order
//! is fixed: ideas first, approval status last. A crash in between leaves the
//! approval `pending` and replaying it is a no-op, because `apply_idea_verdict`
//! is idempotent. The reverse order would lose verdicts silently.

use std::collections::HashMap;
use std::sync::Arc;

use rusqlite::params;
use tauri::State;

use crate::commands::infrastructure::dev_tools::{apply_idea_verdict_by, IdeaVerdict};
use crate::companion::proactive::backlog_triage::{
    run_backlog_triage_batch, BacklogVerdict, MAX_BATCH_IDEAS,
};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The approval action this batch persists as. Registered in
/// `dispatcher::ALLOWED_ACTIONS`, matched in `approval_lifecycle`, and
/// deliberately absent from `AUTOAPPROVE_ALLOWLIST`.
pub const BACKLOG_APPLY_TRIAGE: &str = "backlog_apply_triage";

/// An id the batch could not judge, and why. Surfaced per item rather than
/// dropped, so "I selected 12 and got 9 verdicts" is always explained.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkippedIdea {
    pub idea_id: String,
    /// Human-readable reason (`already accepted`, `not found`, …).
    pub reason: String,
}

/// What the verdict card renders.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaTriageBatch {
    /// The pending `companion_approval` row holding these verdicts.
    pub approval_id: String,
    /// Athena's one-line batch summary (also the approval's rationale).
    pub summary: String,
    pub items: Vec<BacklogVerdict>,
    pub skipped: Vec<SkippedIdea>,
}

/// One per-item human override applied on top of Athena's verdict.
/// `verdict = "skip"` means "leave this idea exactly as it is".
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriageOverride {
    pub idea_id: String,
    /// `accept` | `reject` | `skip`.
    pub verdict: String,
    pub reason: Option<String>,
}

/// Outcome of confirming a triage batch.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AppliedTriage {
    pub accepted: u32,
    pub rejected: u32,
    pub skipped: u32,
    /// How many items the human flipped away from Athena's verdict.
    pub overridden: u32,
    /// Ids that could not be written (already deleted, etc.) — reported, never
    /// swallowed.
    pub failed: Vec<SkippedIdea>,
}

// ── command 1: ask Athena ──────────────────────────────────────────────────

/// Judge a selected batch of pending backlog ideas in ONE headless Athena turn
/// and persist the verdicts as a pending approval.
///
/// Non-pending ids are skipped with a per-item reason rather than silently
/// re-decided — a batch triage must never overwrite a verdict a human already
/// gave.
#[tauri::command]
pub async fn dev_tools_athena_triage_batch(
    state: State<'_, Arc<AppState>>,
    idea_ids: Vec<String>,
) -> Result<AthenaTriageBatch, AppError> {
    require_auth(&state).await?;

    if idea_ids.is_empty() {
        return Err(AppError::Validation(
            "Select at least one backlog item to send to Athena.".into(),
        ));
    }
    if idea_ids.len() > MAX_BATCH_IDEAS {
        return Err(AppError::Validation(format!(
            "Athena judges at most {MAX_BATCH_IDEAS} items per batch (got {}).",
            idea_ids.len()
        )));
    }

    // Load + partition. Deduplicate ids first: the same idea listed twice would
    // otherwise appear twice in the prompt and twice in the approval params.
    let mut seen = std::collections::HashSet::new();
    let mut ideas = Vec::new();
    let mut skipped = Vec::new();
    for id in idea_ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        match repo::get_idea_by_id(&state.db, &id) {
            Ok(idea) if idea.status == "pending" => ideas.push(idea),
            Ok(idea) => skipped.push(SkippedIdea {
                idea_id: id,
                reason: format!("already {}", idea.status),
            }),
            Err(_) => skipped.push(SkippedIdea {
                idea_id: id,
                reason: "not found".into(),
            }),
        }
    }
    if ideas.is_empty() {
        return Err(AppError::Validation(
            "None of the selected items are still pending — nothing to triage.".into(),
        ));
    }

    // Project display names (the prompt groups memories per project).
    let project_name: HashMap<String, String> = repo::list_projects(&state.db, None)
        .unwrap_or_default()
        .into_iter()
        .map(|p| (p.id, p.name))
        .collect();

    let batch = run_backlog_triage_batch(&state.db, &state.user_db, &ideas, &project_name).await?;

    let approval_id = insert_triage_approval(&state, &batch.summary, &batch.items)?;

    Ok(AthenaTriageBatch {
        approval_id,
        summary: batch.summary,
        items: batch.items,
        skipped,
    })
}

/// Persist the batch as a pending `companion_approval` row, mirroring
/// `dispatcher::insert_approval`'s payload shape exactly (`{action, params,
/// rationale}`) so `companion_list_pending_approvals` and
/// `companion_approve_action` can read it without a special case.
fn insert_triage_approval(
    state: &State<'_, Arc<AppState>>,
    summary: &str,
    items: &[BacklogVerdict],
) -> Result<String, AppError> {
    let id = format!("appr_{}", crate::companion::util::short_id(12));
    let payload = serde_json::json!({
        "action": BACKLOG_APPLY_TRIAGE,
        "params": { "items": items },
        "rationale": summary,
    })
    .to_string();

    let conn = state.user_db.get()?;
    conn.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', NULL, datetime('now'))",
        params![id, crate::companion::session::DEFAULT_SESSION_ID, payload],
    )?;
    Ok(id)
}

// ── command 2: confirm, with per-item overrides ────────────────────────────

/// Apply a triage batch, merging human overrides over Athena's verdicts.
///
/// This is the Backlog verdict card's confirm button. The plain Approvals card
/// takes the other door (`execute_backlog_apply_triage`), which is this without
/// the overrides.
#[tauri::command]
pub async fn dev_tools_apply_triage_verdicts(
    state: State<'_, Arc<AppState>>,
    approval_id: String,
    overrides: Vec<TriageOverride>,
) -> Result<AppliedTriage, AppError> {
    require_auth(&state).await?;

    // Reuses the lifecycle's own loader: it enforces `pending`, enforces the
    // consent-freshness window (an expired batch must be re-run, not applied to
    // ideas that may have moved on), and flips the row to `running` atomically.
    let (action, params) =
        crate::commands::companion::approvals::load_pending(&state, &approval_id)?;
    if action != BACKLOG_APPLY_TRIAGE {
        return Err(AppError::Validation(format!(
            "approval `{approval_id}` is a `{action}`, not a backlog triage batch"
        )));
    }

    let verdicts = parse_items(&params)?;
    let override_by_id: HashMap<&str, &TriageOverride> = overrides
        .iter()
        .map(|o| (o.idea_id.as_str(), o))
        .collect();

    let mut applied = AppliedTriage {
        accepted: 0,
        rejected: 0,
        skipped: 0,
        overridden: 0,
        failed: Vec::new(),
    };

    // IDEA WRITES FIRST — see the module header on pool-split safety.
    for item in &verdicts {
        let (verdict, reason) = match override_by_id.get(item.idea_id.as_str()) {
            Some(o) => {
                let v = o.verdict.trim().to_ascii_lowercase();
                if v != item.verdict {
                    applied.overridden += 1;
                }
                (v, o.reason.clone().or_else(|| Some(item.reason.clone())))
            }
            None => (item.verdict.clone(), Some(item.reason.clone())),
        };

        match verdict.as_str() {
            "accept" => {
                match apply_idea_verdict_by(&state.db, &item.idea_id, IdeaVerdict::Accept, "Athena")
                {
                    Ok(_) => applied.accepted += 1,
                    Err(e) => applied.failed.push(SkippedIdea {
                        idea_id: item.idea_id.clone(),
                        reason: e.to_string(),
                    }),
                }
            }
            "reject" => {
                let v = IdeaVerdict::Reject {
                    reason: reason.filter(|r| !r.trim().is_empty()),
                };
                match apply_idea_verdict_by(&state.db, &item.idea_id, v, "Athena") {
                    Ok(_) => applied.rejected += 1,
                    Err(e) => applied.failed.push(SkippedIdea {
                        idea_id: item.idea_id.clone(),
                        reason: e.to_string(),
                    }),
                }
            }
            // "skip" (and any unknown token, defensively) leaves the idea alone.
            _ => applied.skipped += 1,
        }
    }

    // APPROVAL STATUS LAST. Annotate the payload with what actually happened so
    // the ledger row is auditable after the fact — the verdicts alone don't say
    // how many the human flipped.
    note_applied(&state, &approval_id, &applied);
    crate::commands::companion::approvals::finalize_approval(&state, &approval_id, "approved")?;

    Ok(applied)
}

/// Read `{"items": [...]}` out of an approval's params. Tolerates both the
/// camelCase shape this module writes and a snake_case hand-written one.
pub(crate) fn parse_items(params: &serde_json::Value) -> Result<Vec<BacklogVerdict>, AppError> {
    let arr = params
        .get("items")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Validation("triage batch: params has no `items` array".into()))?;
    if arr.is_empty() {
        return Err(AppError::Validation(
            "triage batch: `items` is empty — nothing to apply".into(),
        ));
    }
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        let idea_id = v
            .get("ideaId")
            .or_else(|| v.get("idea_id"))
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Validation("triage batch: item missing `ideaId`".into()))?;
        let verdict = v
            .get("verdict")
            .and_then(|x| x.as_str())
            .unwrap_or("reject")
            .trim()
            .to_ascii_lowercase();
        out.push(BacklogVerdict {
            idea_id: idea_id.to_string(),
            title: v
                .get("title")
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string(),
            verdict: if verdict == "accept" { "accept" } else { "reject" }.to_string(),
            reason: v
                .get("reason")
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string(),
        });
    }
    Ok(out)
}

/// Best-effort audit annotation on the approval payload. A failure here must
/// never fail an apply that already wrote the ideas.
fn note_applied(state: &State<'_, Arc<AppState>>, approval_id: &str, applied: &AppliedTriage) {
    let note = serde_json::json!({
        "accepted": applied.accepted,
        "rejected": applied.rejected,
        "skipped": applied.skipped,
        "overridden": applied.overridden,
    });
    let res = (|| -> Result<(), AppError> {
        let conn = state.user_db.get()?;
        let payload: String = conn.query_row(
            "SELECT payload FROM companion_approval WHERE id = ?1",
            params![approval_id],
            |r| r.get(0),
        )?;
        let mut v: serde_json::Value = serde_json::from_str(&payload)
            .map_err(|e| AppError::Internal(format!("payload parse: {e}")))?;
        if let Some(obj) = v.as_object_mut() {
            obj.insert("applied".into(), note);
        }
        conn.execute(
            "UPDATE companion_approval SET payload = ?1 WHERE id = ?2",
            params![v.to_string(), approval_id],
        )?;
        Ok(())
    })();
    if let Err(e) = res {
        tracing::warn!(approval_id, error = %e, "backlog triage: could not annotate approval payload");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_items_accepts_camel_and_snake_case() {
        let v = serde_json::json!({
            "items": [
                {"ideaId": "a", "title": "A", "verdict": "accept", "reason": "clear"},
                {"idea_id": "b", "title": "B", "verdict": "reject", "reason": "vague"}
            ]
        });
        let items = parse_items(&v).expect("parses");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].idea_id, "a");
        assert_eq!(items[1].idea_id, "b");
    }

    #[test]
    fn parse_items_rejects_empty_and_missing() {
        assert!(parse_items(&serde_json::json!({})).is_err());
        assert!(parse_items(&serde_json::json!({"items": []})).is_err());
    }

    #[test]
    fn parse_items_defaults_unknown_verdict_to_reject() {
        let v = serde_json::json!({"items": [{"ideaId": "a", "verdict": "probably"}]});
        let items = parse_items(&v).expect("parses");
        assert_eq!(items[0].verdict, "reject", "an ambiguous token is not consent");
    }
}
