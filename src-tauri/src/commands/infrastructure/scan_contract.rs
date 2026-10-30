//! `scan-finding/1` at the backlog's doors (spark backlog-scan-family, Seam A).
//!
//! The scan-sweep skill files through two doors - `POST /dev-tools/ideas`
//! ([`super::app_master_writeback::file_backlog_idea`]) and the memory outbox
//! ([`super::memory_ledger`]) - and both now carry the contract's fields. This
//! module is where those fields are validated, written, and where the autonomy
//! ladder's gate is applied. The ladder itself (slices, levels, events) lives in
//! the store: `personas_db::repos::dev::scan_trust`.
//!
//! **Order of business on a filing** (documented because the brief asks that
//! mechanical triage never override a machine decision silently):
//! 1. the row is filed (or the dedup guard hands back the existing one);
//! 2. the contract fields are written ([`record_finding`]); a proof that read
//!    `better` and is now re-measured `not-better` demotes the slice;
//! 3. `autoDecide` ([`auto_decide`]): the door looks up the slice's level, and
//!    at L1+ records the predicted verdict through the ONE verdict door,
//!    `decided_by: machine:scan-sweep`, veto window 24 h;
//! 4. only then do the project's mechanical triage rules run - and they read
//!    `pending` rows only, so a machine-decided item is out of their reach.
//!
//! **On every verdict** ([`on_verdict`], called by `apply_idea_verdict_cas`):
//! the decision is stamped (`decided_by`, `decided_at`, `veto_until`); a human
//! verdict on a machine-decided item is a reversal and demotes its slice (the
//! same verdict is a no-op at the door and never reaches here); a human verdict
//! on a predicted item re-evaluates promotion.
use serde_json::{Map, Value};

use crate::commands::infrastructure::dev_tools::{
    actor_is_human, apply_idea_verdict_cas, IdeaVerdict,
};
use crate::db::models::DevIdea;
use crate::db::repos::dev::scan_trust::{
    self as trust, ProofChange, ProofReading, ScanFindingFields, MACHINE_SCAN_SWEEP,
};
use crate::db::DbPool;
use crate::error::AppError;

const MAX_WHY_CHARS: usize = 200;
const MAX_PREDICTED_WHY_CHARS: usize = 300;
const MAX_WORD_CHARS: usize = 120;

/// The raw contract fields, as either door received them.
#[derive(Debug, Default, Clone)]
pub struct RawFinding<'a> {
    pub lens: Option<&'a str>,
    pub impact_why: Option<&'a str>,
    pub confidence: Option<&'a str>,
    pub score: Option<f64>,
    pub score_parts: Option<&'a Value>,
    pub band: Option<&'a str>,
    pub mvp: Option<bool>,
    pub mvp_rule: Option<&'a str>,
    pub mvp_why: Option<&'a str>,
    pub predicted_verdict: Option<&'a str>,
    pub predicted_why: Option<&'a str>,
    pub predicted_by: Option<&'a str>,
    pub proof: Option<&'a Value>,
    pub size: Option<&'a str>,
    pub lane: Option<&'a str>,
    pub result: Option<&'a str>,
    pub method: Option<&'a str>,
    pub gate: Option<&'a str>,
    pub disposition: Option<&'a str>,
    pub sweep_run_id: Option<&'a str>,
}

/// A lens id as both doors key it: lowercase `[a-z0-9_-]`, at most 60 chars.
pub fn sanitize_lens(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .map(|c| c.to_ascii_lowercase())
        .take(60)
        .collect()
}

/// The contract's `category` in the row's vocabulary. `product` has no column
/// token of its own (`IdeaCategory` is technical/user/business/mastermind and
/// would collapse it to `technical`, the opposite autonomy start), so it is
/// stored as `user`; `scan_trust::contract_category` reads it back as product.
pub fn row_category(category: Option<&str>) -> Option<&str> {
    match category {
        Some("product") => Some("user"),
        other => other,
    }
}

fn text(v: Option<&str>) -> Option<&str> {
    v.map(str::trim).filter(|s| !s.is_empty())
}

fn capped(v: Option<&str>, max: usize) -> Option<String> {
    text(v).map(|s| s.chars().take(max).collect())
}

fn one_of(name: &str, v: Option<&str>, allowed: &[&str]) -> Result<Option<String>, AppError> {
    match text(v) {
        None => Ok(None),
        Some(s) if allowed.contains(&s) => Ok(Some(s.to_string())),
        Some(s) => Err(AppError::Validation(format!(
            "{name} `{s}` is not one of {}",
            allowed.join(" | ")
        ))),
    }
}

/// A `carry` finding is owed to the sweep's next round; the contract says a
/// consumer must never present it for a decision.
pub fn is_carry(disposition: Option<&str>) -> bool {
    text(disposition) == Some("carry")
}

/// Validate the contract fields and shape them for the store. A closed-set
/// value outside its set is a 400 naming the field; free text is trimmed and
/// capped; an absent field stays absent.
pub fn finding_fields(raw: &RawFinding<'_>) -> Result<ScanFindingFields, AppError> {
    if let Some(score) = raw.score {
        if !score.is_finite() || !(0.0..=100.0).contains(&score) {
            return Err(AppError::Validation(format!(
                "score {score} is outside scan-score/1's range (0-100)"
            )));
        }
    }
    let score_parts = match raw.score_parts {
        None | Some(Value::Null) => None,
        Some(v @ Value::Object(_)) => Some(v.to_string()),
        Some(_) => return Err(AppError::Validation("scoreParts must be an object".into())),
    };
    let proof = match raw.proof {
        None | Some(Value::Null) => None,
        Some(v @ Value::Object(o)) => {
            let verdict = o
                .get("verdict")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Validation("proof.verdict is required".into()))?;
            if trust::verify_state_for_proof(verdict).is_none() {
                return Err(AppError::Validation(format!(
                    "proof.verdict `{verdict}` is not better | not-better | inconclusive"
                )));
            }
            // scan-finding/1: a red control without its reading is an
            // unverifiable claim, so `control_value` is required with it.
            if o.get("control").and_then(Value::as_str) == Some("red")
                && o.get("control_value").map_or(true, Value::is_null)
            {
                return Err(AppError::Validation(
                    "proof.control `red` requires proof.control_value".into(),
                ));
            }
            Some(ProofReading {
                verdict: verdict.to_string(),
                json: v.to_string(),
            })
        }
        Some(_) => return Err(AppError::Validation("proof must be an object".into())),
    };
    let mvp_rule = one_of("mvpRule", raw.mvp_rule, &["top-score", "override"])?;
    let mvp_why = capped(raw.mvp_why, MAX_WHY_CHARS);
    if mvp_rule.as_deref() == Some("override") && mvp_why.is_none() {
        return Err(AppError::Validation(
            "mvpRule `override` requires mvpWhy".into(),
        ));
    }

    let mut routing = Map::new();
    for (key, value) in [
        ("lane", raw.lane),
        ("result", raw.result),
        ("method", raw.method),
        ("gate", raw.gate),
        ("disposition", raw.disposition),
    ] {
        if let Some(v) = capped(value, MAX_WORD_CHARS) {
            routing.insert(key.to_string(), Value::String(v));
        }
    }

    Ok(ScanFindingFields {
        lens: raw.lens.map(sanitize_lens).filter(|l| !l.is_empty()),
        impact_why: capped(raw.impact_why, MAX_WHY_CHARS),
        confidence: one_of("confidence", raw.confidence, &["low", "medium", "high"])?,
        score: raw.score.map(|s| (s * 10.0).round() / 10.0),
        score_parts,
        band: one_of("band", raw.band, &["ranked", "reserve"])?,
        mvp: raw.mvp,
        mvp_rule,
        mvp_why,
        predicted_verdict: one_of(
            "predictedVerdict",
            raw.predicted_verdict,
            &["accept", "reject", "defer"],
        )?,
        predicted_why: capped(raw.predicted_why, MAX_PREDICTED_WHY_CHARS),
        predicted_by: capped(raw.predicted_by, MAX_WORD_CHARS),
        size: one_of("size", raw.size, &["XS", "S", "M", "L", "XL"])?,
        routing: (!routing.is_empty()).then(|| Value::Object(routing).to_string()),
        sweep_run_id: capped(raw.sweep_run_id, MAX_WORD_CHARS),
        proof,
    })
}

/// Write the fields onto the filed row; a `better` proof re-measured
/// `not-better` demotes the row's slice. Returns the row as stored.
pub fn record_finding(
    db: &DbPool,
    idea_id: &str,
    fields: &ScanFindingFields,
) -> Result<DevIdea, AppError> {
    let change = trust::record_scan_finding(db, idea_id, fields)?;
    let idea = crate::db::repos::dev_tools::get_idea_by_id(db, idea_id)?;
    if change == ProofChange::RemeasuredNotBetter {
        if let Some(project_id) = idea.project_id.as_deref() {
            trust::demote_slice(
                db,
                project_id,
                &trust::slice_key(&idea),
                "proof re-measured not-better",
                Some(&idea.id),
            )?;
        }
    }
    Ok(idea)
}

/// The level of the slice an idea belongs to, looked up in the store.
pub fn slice_level(db: &DbPool, idea: &DevIdea) -> Result<i32, AppError> {
    let project_id = idea
        .project_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("a slice level needs a project".into()))?;
    trust::slice_level(db, project_id, &trust::slice_key(idea))
}

/// The L1 gate. Looks up the slice's level itself; at L1 or above records the
/// predicted verdict as the decision. Returns `(auto_decided, level)`.
///
/// Not decided, whatever the level: an item no longer `pending`, an item with
/// no predicted verdict, and a `defer` (this backlog has no deferred state to
/// record; the item stays pending for a human).
pub fn auto_decide(db: &DbPool, idea: &DevIdea) -> Result<(bool, i32), AppError> {
    let project_id = idea
        .project_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("autoDecide needs a project".into()))?;
    let level = trust::slice_level(db, project_id, &trust::slice_key(idea))?;
    if level < 1 || idea.status != "pending" {
        return Ok((false, level));
    }
    let verdict = match idea.predicted_verdict.as_deref() {
        Some("accept") => IdeaVerdict::Accept,
        Some("reject") => IdeaVerdict::Reject {
            reason: Some(match idea.predicted_why.as_deref() {
                Some(why) => format!("{MACHINE_SCAN_SWEEP} predicted reject: {why}"),
                None => format!("{MACHINE_SCAN_SWEEP} predicted reject"),
            }),
        },
        _ => return Ok((false, level)),
    };
    apply_idea_verdict_cas(db, &idea.id, verdict, MACHINE_SCAN_SWEEP, Some("pending"))?;
    Ok((true, level))
}

/// The backlog's Trust panel: every slice's level, agreement and newest event.
#[tauri::command]
pub async fn dev_tools_scan_trust(
    state: tauri::State<'_, std::sync::Arc<crate::AppState>>,
    project_id: String,
) -> Result<trust::ScanTrustReport, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let db = state.db.clone();
    crate::commands::blocking::run_blocking("dev_tools_scan_trust", move || {
        trust::trust_report(&db, &project_id, None)
    })
    .await
}

/// Called by the verdict door after a verdict landed: stamp it, and feed the
/// ladder. Best effort - the verdict is already recorded, so a failure here is
/// logged rather than turned into a refusal of the decision.
pub fn on_verdict(db: &DbPool, before: &DevIdea, actor: &str) {
    if let Err(e) = feed_ladder(db, before, actor) {
        tracing::warn!(idea_id = %before.id, error = %e, "scan trust: could not record the verdict");
    }
}

fn feed_ladder(db: &DbPool, before: &DevIdea, actor: &str) -> Result<(), AppError> {
    trust::stamp_idea_decision(db, &before.id, actor)?;
    if !actor_is_human(actor) {
        return Ok(());
    }
    let Some(project_id) = before.project_id.as_deref() else {
        return Ok(());
    };
    let after = crate::db::repos::dev_tools::get_idea_by_id(db, &before.id)?;
    let slice = trust::slice_key(&after);
    if before
        .decided_by
        .as_deref()
        .is_some_and(trust::actor_is_machine)
    {
        let inside = before
            .veto_until
            .as_deref()
            .is_some_and(|until| chrono::Utc::now().to_rfc3339().as_str() < until);
        let reason = if inside {
            "human reversal of a machine decision (inside the veto window)"
        } else {
            "human reversal of a machine decision (after the veto window)"
        };
        trust::demote_slice(db, project_id, &slice, reason, Some(&after.id))?;
    }
    if after.predicted_verdict.is_some() {
        trust::evaluate_promotion(db, project_id, &slice, Some(&after.id))?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "scan_contract_tests.rs"]
mod tests;
