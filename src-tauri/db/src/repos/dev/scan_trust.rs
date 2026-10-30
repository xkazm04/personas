//! `scan-finding/1` on the backlog: the contract fields a scan filing carries,
//! the decision memory a scanner reads before it predicts, and the autonomy
//! ladder whose gate lives HERE, in the store, never in the scanner's prompt.
//!
//! Contract: `ai-registry/docs/skill-clauses/finding-contract.md`. Seam: the
//! backlog-scan-family spark's Seam A (A1 fields, A3 decisions, A4 trust).
//!
//! **The ladder, as this store computes it.**
//! - A *slice* is `<category>|<lens>|<risk_class>|<size>`, an absent part `-`.
//!   `category` is the contract's two-word vocabulary read from the row's
//!   four-word one ([`contract_category`]); `risk_class` is `-` because no
//!   producer sends one (scan-sweep matches slices by exact string). The class
//!   [`risk_class_for`] derives from the lens is used for the ceiling only.
//! - *Start* level: `technical` 2, `product` 0, capped by the ceiling.
//! - *Ceiling*: `secret|authz|money` 1, everything else 3.
//! - *Current* level: the newest [`scan_trust_events`] row's `to_level` for the
//!   slice, else the start. Levels are never stored anywhere else.
//! - *Window*: the slice's items with a predicted verdict AND a human verdict,
//!   decided after the slice's newest event (a transition resets the window),
//!   newest 20.
//! - *Earn*: agreement >= 0.9 over a window of n >= 20 -> up one level.
//! - *Lose*: a human reversal of a machine decision, or a proof re-measured
//!   `not-better` after a `better` -> down one level. At level 0 a 0 -> 0 event
//!   is still appended: it is the window reset the contract asks for.
use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use ts_rs::TS;

use crate::models::DevIdea;
use crate::DbPool;
use personas_core::error::AppError;

/// The actor an L1 auto-triage writes into `decided_by` and the memory ledger.
pub const MACHINE_SCAN_SWEEP: &str = "machine:scan-sweep";
/// The veto window a machine decision is shown with.
pub const VETO_HOURS: i64 = 24;
/// Promotion needs this many human-decided items in the window...
pub const TRUST_WINDOW: usize = 20;
/// ...agreeing with the predicted verdict at least this often.
pub const PROMOTE_AGREEMENT: f64 = 0.9;
/// The highest rung of the ladder (L3 auto-merge).
pub const MAX_LEVEL: i32 = 3;

// ============================================================================
// Contract fields on a filing
// ============================================================================

/// The `scan-finding/1` fields a filing may carry beyond the legacy columns.
/// Every field is optional; `None` writes nothing (absent stays absent).
#[derive(Debug, Clone, Default)]
pub struct ScanFindingFields {
    pub lens: Option<String>,
    pub impact_why: Option<String>,
    pub confidence: Option<String>,
    pub score: Option<f64>,
    /// Already-serialised JSON.
    pub score_parts: Option<String>,
    pub band: Option<String>,
    pub mvp: Option<bool>,
    pub mvp_rule: Option<String>,
    pub mvp_why: Option<String>,
    pub predicted_verdict: Option<String>,
    pub predicted_why: Option<String>,
    pub predicted_by: Option<String>,
    pub size: Option<String>,
    /// Already-serialised JSON `{lane, result, method, gate, disposition}`.
    pub routing: Option<String>,
    pub sweep_run_id: Option<String>,
    pub proof: Option<ProofReading>,
}

/// A `proof` object, its verdict already validated.
#[derive(Debug, Clone)]
pub struct ProofReading {
    /// `better` | `not-better` | `inconclusive`.
    pub verdict: String,
    /// The proof object as JSON, stored verbatim in `verify_evidence`.
    pub json: String,
}

/// `proof.verdict` -> the nearest existing `VERIFY_STATES` token. The column's
/// vocabulary is the findings spine's (`pending|cleared|moved|unchanged|
/// regressed`): `better` moved the signal, `not-better` left it unchanged,
/// `inconclusive` is still pending a verdict.
pub fn verify_state_for_proof(verdict: &str) -> Option<&'static str> {
    match verdict {
        "better" => Some("moved"),
        "not-better" => Some("unchanged"),
        "inconclusive" => Some("pending"),
        _ => None,
    }
}

/// What writing a filing's proof did to the item's measured state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProofChange {
    /// Nothing the ladder cares about.
    None,
    /// A proof that read `better` was re-measured `not-better`.
    RemeasuredNotBetter,
}

/// Write the contract fields onto an idea. A present value replaces the stored
/// one (a re-sweep re-scores); an absent one keeps it. The predicted verdict is
/// the exception: it is written only while the item is still `pending`,
/// because a prediction recorded after a human decided is not a prediction and
/// would contaminate the agreement the ladder is earned on.
pub fn record_scan_finding(
    pool: &DbPool,
    idea_id: &str,
    f: &ScanFindingFields,
) -> Result<ProofChange, AppError> {
    timed_query!("dev_ideas", "dev_ideas::record_scan_finding", {
        let conn = pool.get()?;
        let previous_verify: Option<String> = conn
            .query_row(
                "SELECT verify_state FROM dev_ideas WHERE id = ?1",
                params![idea_id],
                |r| r.get("verify_state"),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("Dev idea {idea_id}")))?;

        conn.execute(
            "UPDATE dev_ideas SET
                 lens         = COALESCE(?1, lens),
                 impact_why   = COALESCE(?2, impact_why),
                 confidence   = COALESCE(?3, confidence),
                 score        = COALESCE(?4, score),
                 score_parts  = COALESCE(?5, score_parts),
                 band         = COALESCE(?6, band),
                 mvp          = COALESCE(?7, mvp),
                 mvp_rule     = COALESCE(?8, mvp_rule),
                 mvp_why      = COALESCE(?9, mvp_why),
                 predicted_verdict = CASE WHEN status = 'pending'
                     THEN COALESCE(?10, predicted_verdict) ELSE predicted_verdict END,
                 predicted_why = CASE WHEN status = 'pending'
                     THEN COALESCE(?11, predicted_why) ELSE predicted_why END,
                 predicted_by = CASE WHEN status = 'pending'
                     THEN COALESCE(?12, predicted_by) ELSE predicted_by END,
                 size         = COALESCE(?13, size),
                 routing      = COALESCE(?14, routing),
                 sweep_run_id = COALESCE(?15, sweep_run_id)
             WHERE id = ?16",
            params![
                f.lens,
                f.impact_why,
                f.confidence,
                f.score,
                f.score_parts,
                f.band,
                f.mvp.map(i64::from),
                f.mvp_rule,
                f.mvp_why,
                f.predicted_verdict,
                f.predicted_why,
                f.predicted_by,
                f.size,
                f.routing,
                f.sweep_run_id,
                idea_id
            ],
        )?;

        let mut change = ProofChange::None;
        if let Some(proof) = f.proof.as_ref() {
            let state = verify_state_for_proof(&proof.verdict).ok_or_else(|| {
                AppError::Validation(format!(
                    "proof.verdict `{}` is not better | not-better | inconclusive",
                    proof.verdict
                ))
            })?;
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE dev_ideas SET verify_state = ?1, verify_evidence = ?2,
                        verify_checked_at = ?3
                  WHERE id = ?4",
                params![state, proof.json, now, idea_id],
            )?;
            if previous_verify.as_deref() == Some("moved") && proof.verdict == "not-better" {
                change = ProofChange::RemeasuredNotBetter;
            }
        }
        Ok(change)
    })
}

/// Stamp who passed an idea's current verdict, and when. A machine actor
/// (`machine:*`) opens a [`VETO_HOURS`] veto window; any other actor closes it.
pub fn stamp_idea_decision(pool: &DbPool, idea_id: &str, actor: &str) -> Result<(), AppError> {
    timed_query!("dev_ideas", "dev_ideas::stamp_idea_decision", {
        let now = chrono::Utc::now();
        let veto_until = actor_is_machine(actor)
            .then(|| (now + chrono::Duration::hours(VETO_HOURS)).to_rfc3339());
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE dev_ideas SET decided_by = ?1, decided_at = ?2, veto_until = ?3 WHERE id = ?4",
            params![actor, now.to_rfc3339(), veto_until, idea_id],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("Dev idea {idea_id}")));
        }
        Ok(())
    })
}

/// A `machine:<skill>` actor - the only actors the ladder lets decide.
pub fn actor_is_machine(actor: &str) -> bool {
    actor.trim().starts_with("machine:")
}

// ============================================================================
// Slices
// ============================================================================

/// The contract's `category` (`technical` | `product`) read from the row's
/// own vocabulary (`technical` | `user` | `business` | `mastermind`). A filing
/// that says `product` is stored as `user` - see the door.
pub fn contract_category(category: &str) -> &'static str {
    if category == "technical" {
        "technical"
    } else {
        "product"
    }
}

/// The lens-scan `risk_class` vocabulary, derived from a scan-sweep lens id.
///
/// No producer sends a risk class to this store, so the lens decides it. The
/// mapping is deliberately pessimistic where a ceiling is at stake: every lens
/// whose findings touch credentials, permissions or money lands on a capped
/// class. `None` for a lens this table does not know; the slice spells it `-`.
pub fn risk_class_for(lens: Option<&str>) -> Option<&'static str> {
    let lens = lens?.trim();
    let class = match lens {
        "security-auditor" => "authz",
        "monetization-advisor" | "business-strategist" => "money",
        "code-optimizer" => "perf",
        "error-handler"
        | "observability-auditor"
        | "risk-assessor"
        | "test-strategist"
        | "devops-optimizer"
        | "bounty-hunter" => "reliability",
        "ux-reviewer"
        | "accessibility-checker"
        | "mobile-specialist"
        | "onboarding-designer"
        | "visual-craft"
        | "state-coverage"
        | "copy-auditor"
        | "ux-elevation"
        | "feature-scout"
        | "growth-hacker"
        | "innovation-catalyst" => "ux",
        "analytics-planner" => "data",
        "tech-debt-tracker"
        | "architecture-analyst"
        | "dependency-auditor"
        | "documentation-auditor"
        | "parity-auditor"
        | "registry-conformance"
        | "architecture-challenger"
        | "integration-planner" => "debt",
        // lens-scan's own ids are its risk classes, so a lens named for one is one.
        "secret" => "secret",
        "authz" => "authz",
        "money" => "money",
        "data" => "data",
        "llm" => "llm",
        "perf" => "perf",
        "reliability" => "reliability",
        "ux" => "ux",
        "debt" => "debt",
        other if other.contains("secret") || other.contains("credential") => "secret",
        other if other.contains("auth") || other.contains("permission") => "authz",
        other if other.contains("billing") || other.contains("payment") => "money",
        _ => return None,
    };
    Some(class)
}

/// The lens a row was found by: the `lens` column, else (rows filed before it
/// existed) the `scan:<lens>:` prefix of a scan-sweep dedup key.
pub fn idea_lens(idea: &DevIdea) -> Option<String> {
    if let Some(l) = idea
        .lens
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        return Some(l.to_string());
    }
    if idea.scan_type != "scan_sweep" {
        return None;
    }
    lens_from_dedup_key(idea.dedup_key.as_deref()?)
}

fn lens_from_dedup_key(key: &str) -> Option<String> {
    let rest = key.strip_prefix("scan:")?;
    let lens = rest.split(':').next()?;
    (!lens.is_empty() && lens != "scan_sweep" && lens != "escalation").then(|| lens.to_string())
}

/// `<category>|<lens>|<risk_class>|<size>`, an absent part written `-`.
///
/// The risk_class part is the one the ROW carries, and no Personas producer
/// sends one, so it is `-` here (Director seam clarification 2026-10-30:
/// scan-sweep matches slices by exact string, e.g. `technical|error-handler|-|S`).
/// The derived class from [`risk_class_for`] is used only for the ceiling.
pub fn slice_key(idea: &DevIdea) -> String {
    let lens = idea_lens(idea);
    format!(
        "{}|{}|-|{}",
        contract_category(&idea.category),
        lens.as_deref().unwrap_or("-"),
        idea.size.as_deref().unwrap_or("-")
    )
}

/// `secret|authz|money` never above L1; everything else may reach L3. The
/// class is the slice's own risk_class part when it names one, else the one
/// [`risk_class_for`] derives from the slice's lens part.
pub fn ceiling_for_slice(slice: &str) -> i32 {
    let mut parts = slice.split('|');
    let lens = parts.nth(1).filter(|l| *l != "-");
    let class = match parts.next() {
        Some(c) if c != "-" && !c.is_empty() => Some(c),
        _ => risk_class_for(lens),
    };
    match class {
        Some("secret" | "authz" | "money") => 1,
        _ => MAX_LEVEL,
    }
}

/// `technical` starts at L2, `product` at L0, never above the ceiling.
pub fn start_for_slice(slice: &str) -> i32 {
    let start = match slice.split('|').next() {
        Some("technical") => 2,
        _ => 0,
    };
    start.min(ceiling_for_slice(slice))
}

/// The human verdict a status carries, in the contract's three words.
fn human_verdict(status: &str) -> Option<&'static str> {
    match status {
        "accepted" | "delivered" => Some("accept"),
        "rejected" => Some("reject"),
        "archived" | "expired" => Some("defer"),
        _ => None,
    }
}

// ============================================================================
// Events and levels
// ============================================================================

/// One append-only transition of a slice.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScanTrustEvent {
    pub slice: String,
    pub from: i32,
    pub to: i32,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agreement: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub n: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub item_id: Option<String>,
    pub at: String,
}

/// A slice's current standing.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScanTrustSlice {
    pub slice: String,
    pub level: i32,
    pub ceiling: i32,
    pub start: i32,
    /// Agreement over the current window; omitted when the window is empty.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agreement: Option<f64>,
    pub n: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub changed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
}

/// `GET /dev-tools/scan/trust` and the backlog's Trust panel.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScanTrustReport {
    pub slices: Vec<ScanTrustSlice>,
    pub events: Vec<ScanTrustEvent>,
}

fn map_event(r: &rusqlite::Row) -> rusqlite::Result<ScanTrustEvent> {
    Ok(ScanTrustEvent {
        slice: r.get("slice")?,
        from: r.get("from_level")?,
        to: r.get("to_level")?,
        reason: r.get("reason")?,
        agreement: r.get("agreement")?,
        n: r.get("n")?,
        item_id: r.get("idea_id")?,
        at: r.get("at")?,
    })
}

const EVENT_COLUMNS: &str = "slice, from_level, to_level, reason, agreement, n, idea_id, at";

fn last_event(
    conn: &rusqlite::Connection,
    project_id: &str,
    slice: &str,
) -> Result<Option<ScanTrustEvent>, AppError> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {EVENT_COLUMNS} FROM scan_trust_events
                  WHERE project_id = ?1 AND slice = ?2
                  ORDER BY at DESC, rowid DESC LIMIT 1"
            ),
            params![project_id, slice],
            map_event,
        )
        .optional()?)
}

/// A slice's current level: its newest event's `to`, else its start.
pub fn slice_level(pool: &DbPool, project_id: &str, slice: &str) -> Result<i32, AppError> {
    timed_query!("scan_trust_events", "scan_trust::slice_level", {
        let conn = pool.get()?;
        Ok(last_event(&conn, project_id, slice)?
            .map(|e| e.to)
            .unwrap_or_else(|| start_for_slice(slice)))
    })
}

fn append_event(
    conn: &rusqlite::Connection,
    project_id: &str,
    event: &ScanTrustEvent,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO scan_trust_events
             (id, project_id, slice, from_level, to_level, reason, agreement, n, idea_id, at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            uuid::Uuid::new_v4().to_string(),
            project_id,
            event.slice,
            event.from,
            event.to,
            event.reason,
            event.agreement,
            event.n,
            event.item_id,
            event.at
        ],
    )?;
    Ok(())
}

/// Every idea of the project that carries a predicted verdict, read once.
fn predicted_ideas(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<Vec<DevIdea>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM dev_ideas WHERE project_id = ?1 AND predicted_verdict IS NOT NULL",
        super::ideas::IDEA_COLUMNS
    ))?;
    let rows = stmt
        .query_map(params![project_id], super::ideas::row_to_idea)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// The window of one slice: `(agreement, n)` over the newest [`TRUST_WINDOW`]
/// human-decided items decided after `since`.
fn window(ideas: &[DevIdea], slice: &str, since: Option<&str>) -> (Option<f64>, usize) {
    let mut decided: Vec<(&str, bool)> = ideas
        .iter()
        .filter(|i| i.decided_by.as_deref() == Some("Human"))
        .filter(|i| slice_key(i) == slice)
        .filter_map(|i| {
            let at = i.decided_at.as_deref()?;
            if since.is_some_and(|s| at <= s) {
                return None;
            }
            let human = human_verdict(&i.status)?;
            let agrees = i.predicted_verdict.as_deref() == Some(human);
            Some((at, agrees))
        })
        .collect();
    decided.sort_by(|a, b| b.0.cmp(a.0));
    decided.truncate(TRUST_WINDOW);
    let n = decided.len();
    if n == 0 {
        return (None, 0);
    }
    let agree = decided.iter().filter(|(_, a)| *a).count();
    (Some(agree as f64 / n as f64), n)
}

/// After a human decision on a predicted item: promote its slice one level if
/// the window has earned it. Returns the event appended, if any.
pub fn evaluate_promotion(
    pool: &DbPool,
    project_id: &str,
    slice: &str,
    idea_id: Option<&str>,
) -> Result<Option<ScanTrustEvent>, AppError> {
    timed_query!("scan_trust_events", "scan_trust::evaluate_promotion", {
        let conn = pool.get()?;
        let last = last_event(&conn, project_id, slice)?;
        let level = last
            .as_ref()
            .map(|e| e.to)
            .unwrap_or_else(|| start_for_slice(slice));
        let ceiling = ceiling_for_slice(slice);
        if level >= ceiling {
            return Ok(None);
        }
        let ideas = predicted_ideas(&conn, project_id)?;
        let (agreement, n) = window(&ideas, slice, last.as_ref().map(|e| e.at.as_str()));
        let Some(agreement) = agreement else {
            return Ok(None);
        };
        if n < TRUST_WINDOW || agreement < PROMOTE_AGREEMENT {
            return Ok(None);
        }
        let event = ScanTrustEvent {
            slice: slice.to_string(),
            from: level,
            to: level + 1,
            reason: format!(
                "earned: predicted verdicts agreed with {} of the last {n} human decisions",
                (agreement * n as f64).round() as i64
            ),
            agreement: Some(agreement),
            n: Some(n as i32),
            item_id: idea_id.map(str::to_string),
            at: chrono::Utc::now().to_rfc3339(),
        };
        append_event(&conn, project_id, &event)?;
        Ok(Some(event))
    })
}

/// Drop a slice one level (never below 0) and reset its window. Always
/// appends an event, a 0 -> 0 one included: that row IS the window reset.
pub fn demote_slice(
    pool: &DbPool,
    project_id: &str,
    slice: &str,
    reason: &str,
    idea_id: Option<&str>,
) -> Result<ScanTrustEvent, AppError> {
    timed_query!("scan_trust_events", "scan_trust::demote_slice", {
        let conn = pool.get()?;
        let last = last_event(&conn, project_id, slice)?;
        let level = last
            .as_ref()
            .map(|e| e.to)
            .unwrap_or_else(|| start_for_slice(slice));
        let ideas = predicted_ideas(&conn, project_id)?;
        let (agreement, n) = window(&ideas, slice, last.as_ref().map(|e| e.at.as_str()));
        let event = ScanTrustEvent {
            slice: slice.to_string(),
            from: level,
            to: (level - 1).max(0),
            reason: reason.to_string(),
            agreement,
            n: Some(n as i32),
            item_id: idea_id.map(str::to_string),
            at: chrono::Utc::now().to_rfc3339(),
        };
        append_event(&conn, project_id, &event)?;
        Ok(event)
    })
}

/// How many events the trust report lists, newest first.
const TRUST_EVENTS_LISTED: i64 = 100;

/// Every slice with history (an event, or a predicted item), plus `also` when
/// asked for by name even without history; and the newest events.
pub fn trust_report(
    pool: &DbPool,
    project_id: &str,
    also: Option<&str>,
) -> Result<ScanTrustReport, AppError> {
    timed_query!("scan_trust_events", "scan_trust::trust_report", {
        let conn = pool.get()?;
        let ideas = predicted_ideas(&conn, project_id)?;
        let mut keys: BTreeMap<String, ()> = BTreeMap::new();
        for i in &ideas {
            keys.insert(slice_key(i), ());
        }
        {
            let mut stmt =
                conn.prepare("SELECT DISTINCT slice FROM scan_trust_events WHERE project_id = ?1")?;
            for s in stmt.query_map(params![project_id], |r| r.get::<_, String>("slice"))? {
                keys.insert(s?, ());
            }
        }
        if let Some(s) = also.map(str::trim).filter(|s| !s.is_empty()) {
            keys.insert(s.to_string(), ());
        }

        let mut slices = Vec::with_capacity(keys.len());
        for slice in keys.into_keys() {
            let last = last_event(&conn, project_id, &slice)?;
            let start = start_for_slice(&slice);
            let (agreement, n) = window(&ideas, &slice, last.as_ref().map(|e| e.at.as_str()));
            slices.push(ScanTrustSlice {
                level: last.as_ref().map(|e| e.to).unwrap_or(start),
                ceiling: ceiling_for_slice(&slice),
                start,
                agreement,
                n: n as i32,
                changed_at: last.as_ref().map(|e| e.at.clone()),
                reason: last.map(|e| e.reason),
                slice,
            });
        }

        let mut stmt = conn.prepare(&format!(
            "SELECT {EVENT_COLUMNS} FROM scan_trust_events WHERE project_id = ?1
              ORDER BY at DESC, rowid DESC LIMIT {TRUST_EVENTS_LISTED}"
        ))?;
        let events = stmt
            .query_map(params![project_id], map_event)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ScanTrustReport { slices, events })
    })
}

// ============================================================================
// Decision memory (A3)
// ============================================================================

/// One recorded decision, as a scanner reads it before predicting.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScanDecision {
    pub idea_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lens: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub context_id: Option<String>,
    /// `accepted` | `rejected` | `deferred`.
    pub verdict: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub decided_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub decided_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScanDecisionList {
    pub decisions: Vec<ScanDecision>,
}

pub const DECISIONS_DEFAULT_LIMIT: i64 = 20;
pub const DECISIONS_MAX_LIMIT: i64 = 100;

/// A project's decided items, newest first: verdict, the human's note (or the
/// decision memory's text), who decided and when. `lens` matches the column,
/// or for rows filed before it existed the `scan:<lens>:` dedup-key prefix.
pub fn list_scan_decisions(
    pool: &DbPool,
    project_id: &str,
    context_id: Option<&str>,
    lens: Option<&str>,
    limit: Option<i64>,
) -> Result<ScanDecisionList, AppError> {
    let limit = limit
        .unwrap_or(DECISIONS_DEFAULT_LIMIT)
        .clamp(1, DECISIONS_MAX_LIMIT);
    let context_id = context_id.map(str::trim).filter(|s| !s.is_empty());
    let lens = lens.map(str::trim).filter(|s| !s.is_empty());
    // A prefix compared with substr, not LIKE: `_` is a legal lens character
    // and a LIKE wildcard.
    let lens_prefix = lens.map(|l| format!("scan:{l}:"));
    timed_query!("dev_ideas", "scan_trust::list_scan_decisions", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT i.id, i.title, i.lens, i.scan_type, i.dedup_key, i.context_id, i.status,
                    i.rejection_reason, i.decided_by, i.decided_at,
                    (SELECT m.title FROM dev_memories m
                      WHERE m.source_kind = 'idea_decision' AND m.source_id = i.id
                      ORDER BY m.updated_at DESC, m.id DESC LIMIT 1) AS mem_title,
                    (SELECT m.content FROM dev_memories m
                      WHERE m.source_kind = 'idea_decision' AND m.source_id = i.id
                      ORDER BY m.updated_at DESC, m.id DESC LIMIT 1) AS mem_content,
                    (SELECT m.updated_at FROM dev_memories m
                      WHERE m.source_kind = 'idea_decision' AND m.source_id = i.id
                      ORDER BY m.updated_at DESC, m.id DESC LIMIT 1) AS mem_at
               FROM dev_ideas i
              WHERE i.project_id = ?1
                AND i.status IN ('accepted', 'delivered', 'rejected', 'archived')
                AND (?2 IS NULL OR i.context_id = ?2)
                AND (?3 IS NULL OR i.lens = ?3
                     OR (i.lens IS NULL AND substr(i.dedup_key, 1, length(?4)) = ?4))
              ORDER BY COALESCE(i.decided_at, mem_at, i.updated_at) DESC",
        )?;
        let rows = stmt.query_map(params![project_id, context_id, lens, lens_prefix], |r| {
            Ok((
                r.get::<_, String>("id")?,
                r.get::<_, String>("title")?,
                r.get::<_, Option<String>>("lens")?,
                r.get::<_, String>("scan_type")?,
                r.get::<_, Option<String>>("dedup_key")?,
                r.get::<_, Option<String>>("context_id")?,
                r.get::<_, String>("status")?,
                r.get::<_, Option<String>>("rejection_reason")?,
                r.get::<_, Option<String>>("decided_by")?,
                r.get::<_, Option<String>>("decided_at")?,
                r.get::<_, Option<String>>("mem_title")?,
                r.get::<_, Option<String>>("mem_content")?,
                r.get::<_, Option<String>>("mem_at")?,
            ))
        })?;

        let mut decisions = Vec::new();
        for row in rows {
            let (
                id,
                title,
                lens_col,
                scan_type,
                dedup_key,
                context,
                status,
                rejection,
                decided_by,
                decided_at,
                mem_title,
                mem_content,
                mem_at,
            ) = row?;
            // A row nobody decided (an aged-out archive, a legacy accept with no
            // memory) is not a decision a scanner can learn from.
            if decided_by.is_none() && mem_title.is_none() {
                continue;
            }
            let verdict = match status.as_str() {
                "accepted" | "delivered" => "accepted",
                "rejected" => "rejected",
                _ => "deferred",
            };
            let nonempty = |s: Option<String>| s.filter(|v| !v.trim().is_empty());
            let lens_value = nonempty(lens_col).or_else(|| {
                (scan_type == "scan_sweep")
                    .then(|| dedup_key.as_deref().and_then(lens_from_dedup_key))
                    .flatten()
            });
            decisions.push(ScanDecision {
                idea_id: id,
                title,
                lens: lens_value,
                context_id: context,
                verdict: verdict.to_string(),
                reason: nonempty(rejection).or_else(|| nonempty(mem_content)),
                decided_by: decided_by.or_else(|| {
                    mem_title
                        .as_deref()
                        .and_then(|t| t.split_whitespace().next())
                        .map(str::to_string)
                }),
                decided_at: decided_at.or(mem_at),
            });
            if decisions.len() as i64 >= limit {
                break;
            }
        }
        Ok(ScanDecisionList { decisions })
    })
}

#[cfg(test)]
#[path = "scan_trust_tests.rs"]
mod tests;
