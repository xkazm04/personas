//! **The Scopes section** of the mandate page (spark `mandate-lanes`, WP6):
//! per scope the envelope holds, the acts taken under it; per scope it does
//! not hold, how many of the asks reaching the operator now it would have
//! absorbed and which ones - computed by routing each ask again through the
//! router with the scope added ([`super::mandate_reread_view::absorbed`]),
//! never estimated. The merge policy and the spend cap are rows of their own.
//!
//! **Arming.** A widen that touches merge or spend arms twice (the operator
//! sees what will no longer reach them before the second press): the merge
//! policy, the cap, and `dispatch` (dispatching accepted work starts paid
//! runs). The flag ships on the payload so no client copies the rule.
//!
//! Widening and narrowing go through the existing `mandate_amend` door
//! (`WidenScope` / `NarrowScope` / `SetMergePolicy` / `SetBudget`), which
//! bumps the envelope version and writes the act with its before / after.
//!
//! **Agreement** (would the steward have decided the way the operator did?)
//! is not measured anywhere yet: no record pairs the two verdicts. The page
//! labels it as a design figure rather than invent one.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use personas_engine::mandate_router::{CharterStatus, CharterView};

use crate::db::models::{DecideScope, MandateSummary, MergePolicy, ALL_DECIDE_SCOPES};
use crate::db::repos::core::{charter_acts, mandates};
use crate::db::{DbPool, UserDbPool};
use crate::engine::mandate_lanes::{routed, RoutedItem};
use crate::engine::mandate_reread_view::{absorbed, absorbed_by, asks_of};
use crate::error::AppError;

/// A spend widen or narrow moves the cap in whole steps of this many dollars.
pub(crate) const SPEND_STEP_USD: f64 = 5.0;
/// ... and a widen raises a cap by at least this share of it.
pub(crate) const SPEND_WIDEN_SHARE: f64 = 0.25;

/// One item a widen would take off the operator's desk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScopeItem {
    /// The `DecisionItem.id`.
    pub item_id: String,
    pub item_kind: String,
    pub title: Option<String>,
}

/// One decide scope on one mandate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScopeRow {
    pub scope: DecideScope,
    pub held: bool,
    /// Standing acts taken under this scope (held or not: a narrowed scope
    /// keeps its history).
    pub acts: u32,
    /// Asks it would absorb if widened; 0 when held.
    pub absorbs: u32,
    /// Those asks, oldest first.
    pub absorbed: Vec<ScopeItem>,
    /// A widen arms twice (it touches merge or spend).
    pub arms: bool,
}

/// The merge policy as a row: what a widen to the next policy would release.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MergeScope {
    pub policy: MergePolicy,
    /// The next wider policy (never -> council-ready -> gate-green); `None` at the widest.
    pub widen_to: Option<MergePolicy>,
    /// The next narrower policy; `None` at `never`.
    pub narrow_to: Option<MergePolicy>,
    pub absorbs: u32,
    pub absorbed: Vec<ScopeItem>,
}

/// The spend cap as a row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SpendScope {
    /// `None` = no cap: no spend is delegated.
    pub cap_usd: Option<f64>,
    pub used_usd: Option<f64>,
    pub widen_to_usd: f64,
    /// `None` when the cap cannot go lower (no cap, or one step already).
    pub narrow_to_usd: Option<f64>,
    pub absorbs: u32,
    pub absorbed: Vec<ScopeItem>,
}

/// The Scopes section of one mandate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MandateScopes {
    pub charter_id: String,
    /// Widen and narrow need a signed envelope (`mandate_amend` refuses one
    /// that never was): an unsigned mandate's absorption reads "if signed with it".
    pub signed: bool,
    /// Asks on this mandate now (Breach and Accept, valves aside).
    pub asks: u32,
    pub rows: Vec<ScopeRow>,
    pub merge: MergeScope,
    pub spend: SpendScope,
    /// Sources that failed to load: their items are absent, never zero.
    pub failed_sources: Vec<String>,
}

fn items(of: &[&RoutedItem]) -> Vec<ScopeItem> {
    let mut v: Vec<&RoutedItem> = of.to_vec();
    v.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    v.into_iter()
        .map(|i| ScopeItem {
            item_id: i.id.clone(),
            item_kind: i.input.kind.wire().to_string(),
            title: i.title.clone(),
        })
        .collect()
}

fn wider(p: MergePolicy) -> Option<MergePolicy> {
    match p {
        MergePolicy::Never => Some(MergePolicy::GateGreenCouncilReady),
        MergePolicy::GateGreenCouncilReady => Some(MergePolicy::GateGreen),
        MergePolicy::GateGreen => None,
    }
}

fn narrower(p: MergePolicy) -> Option<MergePolicy> {
    match p {
        MergePolicy::Never => None,
        MergePolicy::GateGreenCouncilReady => Some(MergePolicy::Never),
        MergePolicy::GateGreen => Some(MergePolicy::GateGreenCouncilReady),
    }
}

fn round_up(usd: f64) -> f64 {
    (usd / SPEND_STEP_USD).ceil().max(1.0) * SPEND_STEP_USD
}

/// The cap a spend widen proposes.
pub(crate) fn spend_widen_to(cap: Option<f64>, used: Option<f64>) -> f64 {
    match cap {
        None => round_up(used.unwrap_or(0.0) + SPEND_STEP_USD),
        Some(c) => round_up(c + (c * SPEND_WIDEN_SHARE).max(SPEND_STEP_USD)),
    }
}

/// The cap a spend narrow proposes; `None` when there is nothing to lower.
pub(crate) fn spend_narrow_to(cap: Option<f64>) -> Option<f64> {
    cap.filter(|c| *c > SPEND_STEP_USD)
        .map(|c| (round_up(c) - SPEND_STEP_USD).max(SPEND_STEP_USD))
}

fn view_from(s: &MandateSummary) -> CharterView {
    CharterView {
        charter_id: s.charter_id.clone(),
        status: CharterStatus::parse(&s.status).unwrap_or(CharterStatus::Draft),
        envelope: s.envelope.clone(),
        spend_used_usd: s.load.spend_used_usd,
    }
}

/// Build one mandate's Scopes section.
pub(crate) fn scopes_of(
    pool: &DbPool,
    user_db: &UserDbPool,
    charter_id: &str,
) -> Result<MandateScopes, AppError> {
    let s = mandates::get(pool, charter_id)?
        .ok_or_else(|| AppError::NotFound(format!("Mandate {charter_id}")))?;
    let r = routed(pool, user_db)?;
    let tally = charter_acts::tallies(pool)?
        .remove(charter_id)
        .unwrap_or_default();
    let view = view_from(&s);
    let asks = asks_of(&r, charter_id);

    let rows = ALL_DECIDE_SCOPES
        .into_iter()
        .map(|scope| {
            let held = s.envelope.decide_scopes.contains(&scope);
            let took = if held {
                Vec::new()
            } else {
                absorbed(&asks, &view, scope)
            };
            ScopeRow {
                scope,
                held,
                acts: tally
                    .by_scope
                    .get(scope.as_str())
                    .copied()
                    .unwrap_or(0)
                    .max(0) as u32,
                absorbs: took.len() as u32,
                absorbed: items(&took),
                arms: scope == DecideScope::Dispatch,
            }
        })
        .collect();

    let policy = s.envelope.merge_policy;
    let merge_took = match wider(policy) {
        Some(p) => {
            let mut v = view.clone();
            v.envelope.merge_policy = p;
            absorbed_by(&asks, &v)
                .into_iter()
                .filter(|i| absorbed_by(&[*i], &view).is_empty())
                .collect()
        }
        None => Vec::new(),
    };
    let widen_to_usd = spend_widen_to(s.envelope.budget_monthly_usd, s.load.spend_used_usd);
    let spend_took: Vec<&RoutedItem> = {
        let mut v = view.clone();
        v.envelope.budget_monthly_usd = Some(widen_to_usd);
        absorbed_by(&asks, &v)
            .into_iter()
            .filter(|i| absorbed_by(&[*i], &view).is_empty())
            .collect()
    };

    Ok(MandateScopes {
        charter_id: s.charter_id.clone(),
        signed: s.envelope.envelope_version > 0,
        asks: asks.len() as u32,
        rows,
        merge: MergeScope {
            policy,
            widen_to: wider(policy),
            narrow_to: narrower(policy),
            absorbs: merge_took.len() as u32,
            absorbed: items(&merge_took),
        },
        spend: SpendScope {
            cap_usd: s.envelope.budget_monthly_usd,
            used_usd: s.load.spend_used_usd,
            widen_to_usd,
            narrow_to_usd: spend_narrow_to(s.envelope.budget_monthly_usd),
            absorbs: spend_took.len() as u32,
            absorbed: items(&spend_took),
        },
        failed_sources: r.failed,
    })
}

#[cfg(test)]
mod tests;
