//! The re-read, assembled (spark `mandate-lanes`, WP6): the figures the pure
//! law (`personas_engine::mandate_reread`) reads, counted from the routed
//! items and the act log, never estimated.
//!
//! * **asks** - this mandate's items that reach the operator now to be decided
//!   or read (Breach and Accept), valves excluded (a valve reaches the operator
//!   whatever the envelope says, so no widening absorbs it);
//! * **absorb** - per scope the envelope does not hold: how many of those asks
//!   would no longer reach the operator with that scope added, by routing each
//!   one again through the router ([`absorbed`], shared with the Scopes
//!   section). The envelope is read as SIGNED and ACTIVE for this: on an
//!   unsigned or held mandate the figure answers "signing with this scope".
//! * **acts / merges** - the act log's [`CharterTally`].
//!
//! The re-read reaches the operator twice from here: as a `mandate-reread:`
//! Sign entry in the lanes snapshot, and on `mandate_list` / `mandate_get`
//! ([`annotate`]) so the Sign card can title itself with the reason.

use std::collections::{HashMap, HashSet};

use personas_engine::mandate_reread::{fleet_ratio, reread_of, RereadInput};
use personas_engine::mandate_router::{
    self, CharterStatus, CharterView, Irreversible, Lane, LaneClause,
};

use crate::db::models::{DecideScope, MandateReread, MandateSummary, ALL_DECIDE_SCOPES};
use crate::db::repos::core::charter_acts::{self, CharterTally};
use crate::db::{DbPool, UserDbPool};
use crate::engine::mandate_lanes::{routed, Routed, RoutedItem};

/// Lanes in which an item waits on the operator to decide or read it.
fn asks_operator(lane: Lane) -> bool {
    matches!(lane, Lane::Breach | Lane::Accept | Lane::Sign | Lane::Talk)
}

/// This charter's items that reach the operator now (Breach and Accept),
/// valves aside.
pub(crate) fn asks_of<'a>(r: &'a Routed, charter_id: &str) -> Vec<&'a RoutedItem> {
    r.items
        .iter()
        .filter(|i| {
            i.route.charter_id.as_deref() == Some(charter_id)
                && matches!(i.route.lane, Lane::Breach | Lane::Accept)
                && i.route.clause != LaneClause::Valve
                && !i.input.irreversible.is_some_and(Irreversible::is_valve)
        })
        .collect()
}

/// The view read as signed and active: what the envelope would do once it binds.
pub(crate) fn binding(view: &CharterView) -> CharterView {
    let mut v = view.clone();
    v.status = CharterStatus::Active;
    v.envelope.envelope_version = v.envelope.envelope_version.max(1);
    v
}

/// The asks a different envelope would no longer send to the operator: each
/// one routed again through the router against `view`.
pub(crate) fn absorbed_by<'a>(asks: &[&'a RoutedItem], view: &CharterView) -> Vec<&'a RoutedItem> {
    let view = binding(view);
    asks.iter()
        .copied()
        .filter(|i| !asks_operator(mandate_router::route(&i.input, Some(&view)).lane))
        .collect()
}

/// [`absorbed_by`] with one scope added to the charter's envelope.
pub(crate) fn absorbed<'a>(
    asks: &[&'a RoutedItem],
    view: &CharterView,
    scope: DecideScope,
) -> Vec<&'a RoutedItem> {
    let mut wider = view.clone();
    if !wider.envelope.decide_scopes.contains(&scope) {
        wider.envelope.decide_scopes.push(scope);
    }
    absorbed_by(asks, &wider)
}

/// The view the router used for this mandate, when it is the one routing its
/// project (the active one wins a project; see `LaneBook`).
pub(crate) fn view_of<'a>(r: &'a Routed, s: &MandateSummary) -> Option<&'a CharterView> {
    r.book
        .charter(Some(&s.project_id))
        .filter(|v| v.charter_id == s.charter_id)
}

fn input_of(r: &Routed, s: &MandateSummary, t: Option<&CharterTally>) -> RereadInput {
    let view = view_of(r, s);
    let asks = asks_of(r, &s.charter_id);
    let held = &s.envelope.decide_scopes;
    let absorb = match view {
        Some(v) => ALL_DECIDE_SCOPES
            .into_iter()
            .filter(|sc| !held.contains(sc))
            .map(|sc| (sc, absorbed(&asks, v, sc).len() as u32))
            .collect(),
        None => Vec::new(),
    };
    let ask_kinds = asks
        .iter()
        .map(|i| i.input.kind.wire())
        .collect::<HashSet<_>>()
        .len() as u32;
    let busiest_held = t.and_then(|t| {
        held.iter()
            .filter_map(|sc| t.by_scope.get(sc.as_str()).map(|n| (*sc, *n)))
            .filter(|(_, n)| *n > 0)
            .max_by_key(|(_, n)| *n)
            .map(|(sc, _)| sc)
    });
    RereadInput {
        active: view.is_some_and(|v| v.status == CharterStatus::Active),
        signed: s.envelope.envelope_version > 0,
        spend_used_usd: s.load.spend_used_usd,
        cap_usd: s.envelope.budget_monthly_usd,
        decisions: t.map(|t| t.decisions).unwrap_or(0),
        kept_at_acts: s.envelope.kept_at_acts,
        merge_policy_never: s.envelope.merge_policy == crate::db::models::MergePolicy::Never,
        merges_since_read: t.map(|t| t.merges_since_read).unwrap_or(0),
        asks: asks.len() as u32,
        absorb,
        ask_kinds,
        busiest_held,
    }
}

/// Every mandate's re-read, keyed by charter id, against tallies already read.
pub(crate) fn rereads_with(
    r: &Routed,
    tallies: &HashMap<String, CharterTally>,
) -> HashMap<String, MandateReread> {
    let inputs: Vec<(String, RereadInput)> = r
        .book
        .summaries
        .iter()
        .map(|s| {
            (
                s.charter_id.clone(),
                input_of(r, s, tallies.get(&s.charter_id)),
            )
        })
        .collect();
    let all: Vec<RereadInput> = inputs.iter().map(|(_, i)| i.clone()).collect();
    let fleet = fleet_ratio(&all);
    inputs
        .into_iter()
        .filter_map(|(id, i)| reread_of(&i, fleet).map(|r| (id, r)))
        .collect()
}

/// Every mandate's re-read. A tally that cannot be read asks nothing (logged):
/// a re-read is an invitation, so failing quiet is the safe direction.
pub(crate) fn rereads(pool: &DbPool, r: &Routed) -> HashMap<String, MandateReread> {
    match charter_acts::tallies(pool) {
        Ok(t) => rereads_with(r, &t),
        Err(e) => {
            tracing::warn!(error = %e, "mandate re-read: act tallies unreadable; nothing asked");
            HashMap::new()
        }
    }
}

/// Attach each mandate's re-read (for `mandate_list` / `mandate_get`). A
/// failed routing read leaves every `reread` at `None`, logged.
pub(crate) fn annotate(pool: &DbPool, user_db: &UserDbPool, summaries: &mut [MandateSummary]) {
    match routed(pool, user_db) {
        Ok(r) => {
            let map = rereads(pool, &r);
            for s in summaries.iter_mut() {
                s.reread = map.get(&s.charter_id).cloned();
            }
        }
        Err(e) => tracing::warn!(error = %e, "mandate re-read: items unroutable; nothing asked"),
    }
}

#[cfg(test)]
mod tests;
