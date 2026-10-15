//! Repository for the **mandate envelope** (migration `e67_mandate_envelope`):
//! the signed part of a project's App Master charter, read and written on its
//! `persona_responsibilities` row, and the envelope doors that change it.
//!
//! A mandate is a charter with `domain = 'software_engineering'` and a
//! `project_id` (the definition `personas_engine::responsibility` documents).
//! Every door here - sign, amend, suspend, resume, revert - changes the row and
//! appends its [`CharterAct`] in ONE immediate transaction, so the log can
//! never miss a change and a change can never land without its act. Every act
//! an envelope door writes carries the before/after ([`EnvelopeChange`]).
//!
//! This module never answers "may the steward decide this?": that verdict is
//! `personas_engine::autonomy`'s. It only stores what the operator signed.

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};

use crate::models::{
    CharterAct, CharterActRevertError, CharterActRevertRefusal, CharterActor, DecideScope,
    EnvelopeChange, EnvelopeOp, EnvelopeSnapshot, MandateChange, MandateEnvelope, MandateLoad,
    MandateOrigin, MandateSignInput, MandateSummary, MergePolicy, NewCharterAct,
    ResponsibilityStatus, ACT_KIND_MANDATE, ACT_KIND_REVERT, ALL_DECIDE_SCOPES,
};
use crate::repos::core::charter_acts;
use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// The domain whose project-bound charters ARE mandates. Mirrors
/// `personas_engine::responsibility::DOMAIN_SOFTWARE_ENGINEERING`, which this
/// crate cannot import (the engine depends on it, not the reverse).
pub const MANDATE_DOMAIN: &str = "software_engineering";

/// `context_data.source` of an App Master ask in `persona_manual_reviews`.
/// Mirrors `attention_decide::ASK_SOURCE` in the app crate.
pub const APP_MASTER_ASK_SOURCE: &str = "app_master_ask";

const SELECT: &str = "SELECT r.id, r.persona_id, r.title, r.project_id, r.domain, r.status, \
     r.scope_rung, r.source, r.budget_monthly_usd, r.decide_scopes, r.merge_policy, \
     r.envelope_version, r.kept_at_acts, r.updated_at, \
     CASE WHEN json_valid(r.spec) THEN json_extract(r.spec, '$.mandateOrigin') END AS origin_json, \
     p.name AS project_name, pe.name AS steward_name \
     FROM persona_responsibilities r \
     LEFT JOIN dev_projects p ON p.id = r.project_id \
     LEFT JOIN personas pe ON pe.id = r.persona_id";

struct CharterRow {
    id: String,
    persona_id: String,
    title: String,
    project_id: Option<String>,
    domain: String,
    status: String,
    scope_rung: i64,
    source: String,
    budget_monthly_usd: Option<f64>,
    decide_scopes: String,
    merge_policy: String,
    envelope_version: i64,
    kept_at_acts: Option<i64>,
    updated_at: String,
    origin_json: Option<String>,
    project_name: Option<String>,
    steward_name: Option<String>,
}

row_mapper!(row_to_charter -> CharterRow {
    id, persona_id, title, project_id, domain, status, scope_rung, source, budget_monthly_usd,
    decide_scopes, merge_policy, envelope_version, kept_at_acts, updated_at, origin_json,
    project_name, steward_name,
});

/// `spec.mandateOrigin`, leniently: unreadable reads as absent (logged).
fn origin_of(row: &CharterRow) -> Option<MandateOrigin> {
    let raw = row.origin_json.as_deref()?;
    serde_json::from_str(raw)
        .map_err(|e| {
            tracing::warn!(charter_id = %row.id, error = %e,
                "mandates: unreadable mandateOrigin, read as absent")
        })
        .ok()
}

/// Lenient read of `decide_scopes`: an unknown token or unparsable JSON is
/// DROPPED with a warning. Dropping narrows the envelope, which is the safe
/// direction - a scope nobody can name must not be delegated.
fn parse_scopes(raw: &str, charter_id: &str) -> Vec<DecideScope> {
    let tokens: Vec<String> = match serde_json::from_str(raw) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(charter_id, error = %e,
                "mandates: unparsable decide_scopes, read as empty");
            return Vec::new();
        }
    };
    let mut out = Vec::new();
    for t in tokens {
        match DecideScope::parse(&t) {
            Some(s) if !out.contains(&s) => out.push(s),
            Some(_) => {}
            None => tracing::warn!(charter_id, scope = %t,
                "mandates: unknown decide scope dropped from the envelope"),
        }
    }
    canonical(out)
}

/// Scopes deduplicated, in the vocabulary's order.
fn canonical(scopes: Vec<DecideScope>) -> Vec<DecideScope> {
    ALL_DECIDE_SCOPES
        .into_iter()
        .filter(|s| scopes.contains(s))
        .collect()
}

fn merge_policy_of(row: &CharterRow) -> MergePolicy {
    MergePolicy::parse(&row.merge_policy).unwrap_or_else(|| {
        // The DB CHECK makes this unreachable for rows written after e67.
        tracing::warn!(charter_id = %row.id, policy = %row.merge_policy,
            "mandates: unknown merge policy read as `never`");
        MergePolicy::Never
    })
}

fn envelope_of(row: &CharterRow) -> MandateEnvelope {
    MandateEnvelope {
        decide_scopes: parse_scopes(&row.decide_scopes, &row.id),
        merge_policy: merge_policy_of(row),
        budget_monthly_usd: row.budget_monthly_usd,
        envelope_version: row.envelope_version,
        kept_at_acts: row.kept_at_acts,
    }
}

fn snapshot_of(row: &CharterRow) -> EnvelopeSnapshot {
    EnvelopeSnapshot {
        decide_scopes: parse_scopes(&row.decide_scopes, &row.id),
        merge_policy: merge_policy_of(row),
        budget_monthly_usd: row.budget_monthly_usd,
        status: row.status.clone(),
    }
}

fn is_mandate(row: &CharterRow) -> bool {
    row.domain == MANDATE_DOMAIN && row.project_id.as_deref().is_some_and(|p| !p.is_empty())
}

fn read_in(conn: &Connection, id: &str) -> Result<Option<CharterRow>, AppError> {
    let mut stmt = conn.prepare_cached(&format!("{SELECT} WHERE r.id = ?1"))?;
    Ok(stmt.query_row([id], row_to_charter).optional()?)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// The envelope stored on one charter row (any domain, any status).
/// `Ok(None)` when no such charter exists.
pub fn get_envelope(pool: &DbPool, charter_id: &str) -> Result<Option<MandateEnvelope>, AppError> {
    timed_query!("persona_responsibilities", "mandates::get_envelope", {
        let conn = pool.conn("mandates::get_envelope")?;
        Ok(read_in(&conn, charter_id)?.as_ref().map(envelope_of))
    })
}

/// Pending App Master asks of this steward on this project.
fn open_asks_in(conn: &Connection, persona_id: &str, project_id: &str) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) AS n FROM persona_manual_reviews
         WHERE persona_id = ?1 AND status = 'pending'
           AND CASE WHEN json_valid(context_data)
                    THEN json_extract(context_data, '$.source') END = ?2
           AND COALESCE(CASE WHEN json_valid(context_data)
                             THEN json_extract(context_data, '$.projectId') END, ?3) = ?3",
        params![persona_id, APP_MASTER_ASK_SOURCE, project_id],
        |r| r.get("n"),
    )?)
}

fn load_of(pool: &DbPool, conn: &Connection, row: &CharterRow) -> MandateLoad {
    let project_id = row.project_id.as_deref().unwrap_or_default();
    MandateLoad {
        spend_used_usd: crate::repos::execution::executions::get_monthly_spend(
            pool,
            &row.persona_id,
        )
        .map_err(|e| tracing::warn!(charter_id = %row.id, error = %e, "mandates: spend unreadable"))
        .ok(),
        budget_usd: row.budget_monthly_usd,
        acts_count: charter_acts::count_for_charter_in(conn, &row.id)
            .map_err(
                |e| tracing::warn!(charter_id = %row.id, error = %e, "mandates: acts unreadable"),
            )
            .ok(),
        open_asks: open_asks_in(conn, &row.persona_id, project_id)
            .map_err(
                |e| tracing::warn!(charter_id = %row.id, error = %e, "mandates: asks unreadable"),
            )
            .ok(),
    }
}

fn summary_of(pool: &DbPool, conn: &Connection, row: &CharterRow) -> MandateSummary {
    MandateSummary {
        charter_id: row.id.clone(),
        title: row.title.clone(),
        project_id: row.project_id.clone().unwrap_or_default(),
        project_name: row.project_name.clone(),
        steward_persona_id: row.persona_id.clone(),
        steward_name: row.steward_name.clone(),
        status: row.status.clone(),
        scope_rung: row.scope_rung.clamp(0, i64::from(u8::MAX)) as u8,
        source: row.source.clone(),
        envelope: envelope_of(row),
        load: load_of(pool, conn, row),
        updated_at: row.updated_at.clone(),
        reread: None,
        origin: origin_of(row),
        mirror: None,
    }
}

/// Every mandate that is not retired (draft, active, suspended), by project
/// name then newest first.
pub fn list(pool: &DbPool) -> Result<Vec<MandateSummary>, AppError> {
    timed_query!("persona_responsibilities", "mandates::list", {
        let conn = pool.conn("mandates::list")?;
        let rows: Vec<CharterRow> = {
            let mut stmt = conn.prepare_cached(&format!(
                "{SELECT} WHERE r.domain = ?1 AND r.project_id IS NOT NULL AND r.project_id != ''
                   AND r.status != 'retired'
                 ORDER BY COALESCE(p.name, r.project_id) COLLATE NOCASE, r.created_at DESC, r.id DESC"
            ))?;
            let mapped = stmt.query_map([MANDATE_DOMAIN], row_to_charter)?;
            collect_rows(mapped, "mandates::list")
        };
        Ok(rows.iter().map(|r| summary_of(pool, &conn, r)).collect())
    })
}

/// One mandate, any status. `Ok(None)` when no such charter exists; a
/// `Validation` error when the charter exists but is not a mandate.
pub fn get(pool: &DbPool, charter_id: &str) -> Result<Option<MandateSummary>, AppError> {
    timed_query!("persona_responsibilities", "mandates::get", {
        let conn = pool.conn("mandates::get")?;
        let Some(row) = read_in(&conn, charter_id)? else {
            return Ok(None);
        };
        if !is_mandate(&row) {
            return Err(not_a_mandate(&row.id));
        }
        Ok(Some(summary_of(pool, &conn, &row)))
    })
}

// ---------------------------------------------------------------------------
// The envelope doors
// ---------------------------------------------------------------------------

fn not_a_mandate(id: &str) -> AppError {
    AppError::Validation(format!(
        "Charter {id} is not a mandate: a mandate is a project-bound software_engineering charter"
    ))
}

/// The charter a door may write: it exists, it is a mandate, it is not retired.
fn writable_in(tx: &Transaction<'_>, id: &str) -> Result<CharterRow, AppError> {
    let row = read_in(tx, id)?.ok_or_else(|| AppError::NotFound(format!("Charter {id}")))?;
    if !is_mandate(&row) {
        return Err(not_a_mandate(id));
    }
    if row.status == ResponsibilityStatus::Retired.as_str() {
        return Err(AppError::Validation(format!(
            "Mandate {id} is retired; a retired mandate cannot be signed or amended"
        )));
    }
    Ok(row)
}

/// Refuse to make a charter active while another active mandate holds its
/// project: one project, one mandate (a hire REPLACES).
fn require_sole_active(tx: &Transaction<'_>, row: &CharterRow) -> Result<(), AppError> {
    let other: Option<String> = tx
        .query_row(
            "SELECT id FROM persona_responsibilities
             WHERE project_id = ?1 AND domain = ?2 AND status = 'active' AND id != ?3
             LIMIT 1",
            params![row.project_id, MANDATE_DOMAIN, row.id],
            |r| r.get("id"),
        )
        .optional()?;
    match other {
        Some(o) => Err(AppError::Validation(format!(
            "Project {} already has an active mandate ({o}); suspend or retire it first",
            row.project_id.as_deref().unwrap_or_default()
        ))),
        None => Ok(()),
    }
}

fn validate_budget(usd: Option<f64>) -> Result<(), AppError> {
    match usd {
        Some(b) if !b.is_finite() || b <= 0.0 => Err(AppError::Validation(format!(
            "A mandate budget must be a positive amount, or none; got {b}"
        ))),
        _ => Ok(()),
    }
}

fn write_envelope_in(
    tx: &Transaction<'_>,
    id: &str,
    snap: &EnvelopeSnapshot,
    version: i64,
) -> Result<(), AppError> {
    let scopes: Vec<&str> = snap.decide_scopes.iter().map(|s| s.as_str()).collect();
    tx.execute(
        "UPDATE persona_responsibilities
         SET decide_scopes = ?1, merge_policy = ?2, budget_monthly_usd = ?3, status = ?4,
             envelope_version = ?5, updated_at = ?6
         WHERE id = ?7",
        params![
            serde_json::to_string(&scopes)?,
            snap.merge_policy.as_str(),
            snap.budget_monthly_usd,
            snap.status,
            version,
            chrono::Utc::now().to_rfc3339(),
            id,
        ],
    )?;
    Ok(())
}

/// Move the re-read marker to the decision acts the mandate holds now.
fn stamp_read_in(tx: &Transaction<'_>, charter_id: &str) -> Result<i64, AppError> {
    let acts = charter_acts::decision_count_in(tx, charter_id)?;
    tx.execute(
        "UPDATE persona_responsibilities SET kept_at_acts = ?1 WHERE id = ?2",
        params![acts, charter_id],
    )?;
    Ok(acts)
}

/// The act an envelope door writes. Reversible: an envelope act can be undone
/// by restoring its `before` (see [`revert`]).
fn envelope_act(row: &CharterRow, verdict: &str, origin_device: Option<&str>) -> NewCharterAct {
    NewCharterAct {
        charter_id: row.id.clone(),
        item_kind: ACT_KIND_MANDATE.to_string(),
        item_id: row.id.clone(),
        verdict: verdict.to_string(),
        actor: CharterActor::Operator,
        scope: None,
        reversible: true,
        cost_usd: None,
        shown_json: None,
        origin_device: origin_device.map(str::to_string),
    }
}

/// Apply one envelope change in one immediate transaction: compute `after`
/// from the row, write it, append the act.
fn apply<F>(
    pool: &DbPool,
    charter_id: &str,
    label: &'static str,
    origin_device: Option<&str>,
    f: F,
) -> Result<CharterAct, AppError>
where
    F: FnOnce(&Transaction<'_>, &CharterRow) -> Result<EnvelopeEdit, AppError>,
{
    timed_query!("persona_responsibilities", label, {
        let mut conn = pool.conn(label)?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row = writable_in(&tx, charter_id)?;
        let edit = f(&tx, &row)?;
        let before = snapshot_of(&row);
        let version = if edit.bump {
            row.envelope_version + 1
        } else {
            row.envelope_version
        };
        write_envelope_in(&tx, &row.id, &edit.after, version)?;
        let mut act = envelope_act(&row, edit.verdict, origin_device);
        act.shown_json = edit.shown_json;
        act.reversible = edit.reversible;
        let change = EnvelopeChange {
            op: edit.op,
            change: edit.change,
            before,
            after: edit.after,
        };
        let created = charter_acts::insert_in(&tx, &act, version, Some(&change))?;
        tx.commit()?;
        Ok(created)
    })
}

struct EnvelopeEdit {
    op: EnvelopeOp,
    change: Option<MandateChange>,
    after: EnvelopeSnapshot,
    bump: bool,
    verdict: &'static str,
    shown_json: Option<String>,
    /// Every envelope act can be reverted by restoring its `before`, except a
    /// drop (a retired charter takes no door; drafting again is the undo).
    reversible: bool,
}

/// Sign the whole envelope. A draft mandate becomes active (refused while
/// another active mandate holds the project); a suspended one stays
/// suspended. Bumps `envelope_version`.
pub fn sign(
    pool: &DbPool,
    charter_id: &str,
    input: &MandateSignInput,
    origin_device: Option<&str>,
) -> Result<CharterAct, AppError> {
    validate_budget(input.budget_monthly_usd)?;
    apply(
        pool,
        charter_id,
        "mandates::sign",
        origin_device,
        |tx, row| {
            let status = if row.status == ResponsibilityStatus::Draft.as_str() {
                require_sole_active(tx, row)?;
                ResponsibilityStatus::Active.as_str().to_string()
            } else {
                row.status.clone()
            };
            // Re-signing a signed envelope IS re-reading it: the re-read
            // marker moves to the acts it was read at, as Keep moves it.
            if row.envelope_version > 0 {
                stamp_read_in(tx, &row.id)?;
            }
            Ok(EnvelopeEdit {
                op: EnvelopeOp::Sign,
                change: None,
                after: EnvelopeSnapshot {
                    decide_scopes: canonical(input.decide_scopes.clone()),
                    merge_policy: input.merge_policy,
                    budget_monthly_usd: input.budget_monthly_usd,
                    status,
                },
                bump: true,
                verdict: "signed",
                shown_json: Some(serde_json::to_string(input)?),
                reversible: true,
            })
        },
    )
}

/// Amend a signed envelope. Refuses an unsigned one (sign it first) and a
/// change that changes nothing (a no-op act is noise in the log).
pub fn amend(
    pool: &DbPool,
    charter_id: &str,
    change: &MandateChange,
    origin_device: Option<&str>,
) -> Result<CharterAct, AppError> {
    apply(
        pool,
        charter_id,
        "mandates::amend",
        origin_device,
        |_tx, row| {
            if row.envelope_version <= 0 {
                return Err(AppError::Validation(format!(
                    "Mandate {} has never been signed; sign it before amending it",
                    row.id
                )));
            }
            let mut after = snapshot_of(row);
            let verdict = match change {
                MandateChange::WidenScope { scopes } => {
                    if !scopes.iter().any(|s| !after.decide_scopes.contains(s)) {
                        return Err(AppError::Validation(
                            "Widen adds no scope the envelope does not already hold".into(),
                        ));
                    }
                    let mut all = after.decide_scopes.clone();
                    all.extend(scopes.iter().copied());
                    after.decide_scopes = canonical(all);
                    "widened"
                }
                MandateChange::NarrowScope { scopes } => {
                    if !scopes.iter().any(|s| after.decide_scopes.contains(s)) {
                        return Err(AppError::Validation(
                            "Narrow removes no scope the envelope holds".into(),
                        ));
                    }
                    after.decide_scopes.retain(|s| !scopes.contains(s));
                    "narrowed"
                }
                MandateChange::SetMergePolicy { policy } => {
                    if *policy == after.merge_policy {
                        return Err(AppError::Validation(format!(
                            "The merge policy is already `{}`",
                            policy.as_str()
                        )));
                    }
                    after.merge_policy = *policy;
                    "merge-policy-set"
                }
                MandateChange::SetBudget { usd } => {
                    validate_budget(*usd)?;
                    if *usd == after.budget_monthly_usd {
                        return Err(AppError::Validation("The budget is unchanged".into()));
                    }
                    after.budget_monthly_usd = *usd;
                    "budget-set"
                }
            };
            Ok(EnvelopeEdit {
                op: EnvelopeOp::Amend,
                change: Some(change.clone()),
                after,
                bump: true,
                verdict,
                shown_json: None,
                reversible: true,
            })
        },
    )
}

/// The longest drop reason stored; longer text is cut, never refused.
pub const MAX_DROP_REASON_CHARS: usize = 2000;

/// A drop reason as stored: trimmed, blank as none, cut at the cap.
fn stored_reason(reason: Option<&str>) -> Option<String> {
    reason
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(|r| r.chars().take(MAX_DROP_REASON_CHARS).collect())
}

/// Drop a DRAFT mandate: the charter is retired and one act records the drop
/// with the operator's reason (`shown_json = {"reason": ...}`; `null` when
/// none was given). Refuses an active or suspended mandate (suspend it, or
/// retire it from its charter page) and a retired one. The act is final.
pub fn drop_draft(
    pool: &DbPool,
    charter_id: &str,
    reason: Option<&str>,
    origin_device: Option<&str>,
) -> Result<CharterAct, AppError> {
    let reason = stored_reason(reason);
    apply(
        pool,
        charter_id,
        "mandates::drop_draft",
        origin_device,
        |_tx, row| {
            if row.status != ResponsibilityStatus::Draft.as_str() {
                return Err(AppError::Validation(format!(
                    "Mandate {} is {}; only a draft can be dropped",
                    row.id, row.status
                )));
            }
            let mut after = snapshot_of(row);
            after.status = ResponsibilityStatus::Retired.as_str().to_string();
            Ok(EnvelopeEdit {
                op: EnvelopeOp::Drop,
                change: None,
                after,
                bump: false,
                verdict: "dropped",
                shown_json: Some(serde_json::json!({ "reason": reason }).to_string()),
                reversible: false,
            })
        },
    )
}

/// Keep a signed, active mandate as signed after a re-read: sets the re-read
/// marker (`kept_at_acts`) to the decision acts it holds now, so the re-read
/// does not come back until its use has grown past that, and records one act
/// carrying the re-read `reason` code it answered. The envelope does not move.
pub fn keep(
    pool: &DbPool,
    charter_id: &str,
    reason: &str,
    origin_device: Option<&str>,
) -> Result<CharterAct, AppError> {
    timed_query!("persona_responsibilities", "mandates::keep", {
        let mut conn = pool.conn("mandates::keep")?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row = writable_in(&tx, charter_id)?;
        if row.status != ResponsibilityStatus::Active.as_str() || row.envelope_version <= 0 {
            return Err(AppError::Validation(format!(
                "Mandate {} is {} and {}; only a signed, active mandate is re-read",
                row.id,
                row.status,
                if row.envelope_version > 0 {
                    "signed"
                } else {
                    "unsigned"
                }
            )));
        }
        let acts = stamp_read_in(&tx, &row.id)?;
        let mut act = envelope_act(&row, "kept", origin_device);
        act.reversible = false;
        act.shown_json =
            Some(serde_json::json!({ "reread": reason.trim(), "keptAtActs": acts }).to_string());
        let snap = snapshot_of(&row);
        let change = EnvelopeChange {
            op: EnvelopeOp::Keep,
            change: None,
            before: snap.clone(),
            after: snap,
        };
        let created = charter_acts::insert_in(&tx, &act, row.envelope_version, Some(&change))?;
        tx.execute(
            "UPDATE persona_responsibilities SET updated_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().to_rfc3339(), row.id],
        )?;
        tx.commit()?;
        Ok(created)
    })
}

/// Suspend an active mandate: it grants nothing until resumed. The envelope
/// is kept as signed, so `envelope_version` does not move.
pub fn suspend(
    pool: &DbPool,
    charter_id: &str,
    origin_device: Option<&str>,
) -> Result<CharterAct, AppError> {
    apply(
        pool,
        charter_id,
        "mandates::suspend",
        origin_device,
        |_tx, row| {
            if row.status != ResponsibilityStatus::Active.as_str() {
                return Err(AppError::Validation(format!(
                    "Mandate {} is {}; only an active mandate can be suspended",
                    row.id, row.status
                )));
            }
            let mut after = snapshot_of(row);
            after.status = ResponsibilityStatus::Suspended.as_str().to_string();
            Ok(EnvelopeEdit {
                op: EnvelopeOp::Suspend,
                change: None,
                after,
                bump: false,
                verdict: "suspended",
                shown_json: None,
                reversible: true,
            })
        },
    )
}

/// Resume a suspended mandate (refused while another active mandate holds
/// the project).
pub fn resume(
    pool: &DbPool,
    charter_id: &str,
    origin_device: Option<&str>,
) -> Result<CharterAct, AppError> {
    apply(
        pool,
        charter_id,
        "mandates::resume",
        origin_device,
        |tx, row| {
            if row.status != ResponsibilityStatus::Suspended.as_str() {
                return Err(AppError::Validation(format!(
                    "Mandate {} is {}; only a suspended mandate can be resumed",
                    row.id, row.status
                )));
            }
            require_sole_active(tx, row)?;
            let mut after = snapshot_of(row);
            after.status = ResponsibilityStatus::Active.as_str().to_string();
            Ok(EnvelopeEdit {
                op: EnvelopeOp::Resume,
                change: None,
                after,
                bump: false,
                verdict: "resumed",
                shown_json: None,
                reversible: true,
            })
        },
    )
}

fn same_snapshot(a: &EnvelopeSnapshot, b: &EnvelopeSnapshot) -> bool {
    canonical(a.decide_scopes.clone()) == canonical(b.decide_scopes.clone())
        && a.merge_policy == b.merge_policy
        && a.budget_monthly_usd == b.budget_monthly_usd
        && a.status == b.status
}

/// Revert one act. Refuses (typed) an unknown act, an irreversible one and one
/// already reverted. Writes a new `act.revert` act by the operator and stamps
/// the original's `reverted_at` / `revert_act_id`, in one transaction.
///
/// * An **envelope** act is undone here: its `before` is restored, provided
///   the envelope still reads exactly as that act left it (otherwise a later
///   change superseded it and restoring would undo that change too:
///   [`CharterActRevertRefusal::Superseded`]). Restoring scopes, policy or
///   budget bumps `envelope_version`.
/// * Any **other** act is recorded as reverted; undoing its effect on the
///   item (an idea, a review) belongs to the code that owns that item, which
///   reads the `act.revert` act.
///
/// The revert act itself is irreversible: a revert is undone by deciding
/// again, not by reverting the revert.
pub fn revert(
    pool: &DbPool,
    act_id: &str,
    origin_device: Option<&str>,
) -> Result<CharterAct, CharterActRevertError> {
    let refused = |r| Err(CharterActRevertError::Refused(r));
    let mut conn = pool.conn("mandates::revert").map_err(AppError::from)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let Some(original) = charter_acts::get_in(&tx, act_id)? else {
        return refused(CharterActRevertRefusal::NotFound {
            act_id: act_id.to_string(),
        });
    };
    if let Some(at) = &original.reverted_at {
        return refused(CharterActRevertRefusal::AlreadyReverted {
            act_id: act_id.to_string(),
            reverted_at: at.clone(),
        });
    }
    if !original.reversible {
        return refused(CharterActRevertRefusal::Irreversible {
            act_id: act_id.to_string(),
            item_kind: original.item_kind.clone(),
        });
    }

    let mut revert_act = NewCharterAct {
        charter_id: original.charter_id.clone(),
        item_kind: ACT_KIND_REVERT.to_string(),
        item_id: original.id.clone(),
        verdict: "reverted".to_string(),
        actor: CharterActor::Operator,
        scope: None,
        reversible: false,
        cost_usd: None,
        shown_json: None,
        origin_device: origin_device.map(str::to_string),
    };

    let (version, env_change) = match &original.env_change {
        Some(change) => {
            let row = writable_in(&tx, &original.charter_id)?;
            let current = snapshot_of(&row);
            if !same_snapshot(&current, &change.after) {
                return refused(CharterActRevertRefusal::Superseded {
                    act_id: act_id.to_string(),
                });
            }
            let restore = change.before.clone();
            if restore.status == ResponsibilityStatus::Active.as_str()
                && current.status != restore.status
            {
                require_sole_active(&tx, &row)?;
            }
            let envelope_moves = canonical(restore.decide_scopes.clone())
                != canonical(current.decide_scopes.clone())
                || restore.merge_policy != current.merge_policy
                || restore.budget_monthly_usd != current.budget_monthly_usd;
            let version = if envelope_moves {
                row.envelope_version + 1
            } else {
                row.envelope_version
            };
            write_envelope_in(&tx, &row.id, &restore, version)?;
            let undo = EnvelopeChange {
                op: EnvelopeOp::Revert,
                change: None,
                before: current,
                after: restore,
            };
            (version, Some(undo))
        }
        None => {
            let version: Option<i64> = tx
                .query_row(
                    "SELECT envelope_version FROM persona_responsibilities WHERE id = ?1",
                    [&original.charter_id],
                    |r| r.get("envelope_version"),
                )
                .optional()?;
            (version.unwrap_or(original.envelope_version), None)
        }
    };
    revert_act.shown_json = Some(
        serde_json::json!({ "revertedAct": original.id, "verdict": original.verdict }).to_string(),
    );
    let created = charter_acts::insert_in(&tx, &revert_act, version, env_change.as_ref())?;
    let now = chrono::Utc::now().to_rfc3339();
    if !charter_acts::mark_reverted_in(&tx, &original.id, &created.id, &now)? {
        return refused(CharterActRevertRefusal::AlreadyReverted {
            act_id: act_id.to_string(),
            reverted_at: now,
        });
    }
    tx.commit()?;
    Ok(created)
}

mod orphans;
pub use orphans::{adopt_project, draft_for_orphans, OrphanDraft};

#[cfg(test)]
mod tests;
