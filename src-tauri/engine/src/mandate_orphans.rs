//! **The orphan law** (spark `mandate-lanes`, WP6): when a project's unclaimed
//! work - pending items the router sent to `orphan` because no mandate holds
//! the project - is worth a mandate of its own.
//!
//! No clock and no fixed count (the owner: "some days can be stale, some very
//! fruitful"): a cluster is measured against the fleet's own flow, `per_card`,
//! the items the operator's lanes hold per card today (items in Breach, Sign
//! and Accept over the distinct cards they coalesce into).
//!
//! * **large** - at least [`MIN_ITEMS`] orphans and at least
//!   [`LARGE_FACTOR`] times what one card releases today;
//! * **growing** - at least [`MIN_ITEMS`] orphans, more than
//!   [`GROWING_SHARE`] of them newer than the fleet's median pending item,
//!   and at least half of what one card releases.
//!
//! A firing cluster may be drafted (see the app-side sweep): deterministic,
//! idempotent, no model call. No IO here.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Below this many items a cluster never fires, whatever the flow.
pub const MIN_ITEMS: u32 = 3;
/// "Large": this many times what a card releases today.
pub const LARGE_FACTOR: f64 = 1.0;
/// "Growing": more than this share of the cluster is recent.
pub const GROWING_SHARE: f64 = 0.5;

/// Why a cluster asks for a mandate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum OrphanWhy {
    Large,
    Growing,
}

/// Items per card in the operator's lanes; at least 1.
pub fn per_card(operator_items: u32, cards: u32) -> f64 {
    (f64::from(operator_items) / f64::from(cards.max(1))).max(1.0)
}

/// Whether a cluster of `n` orphans, `recent` of them newer than the fleet's
/// median, fires against `per_card`.
pub fn why(n: u32, recent: u32, per_card: f64) -> Option<OrphanWhy> {
    if n < MIN_ITEMS {
        return None;
    }
    if f64::from(n) >= per_card * LARGE_FACTOR {
        return Some(OrphanWhy::Large);
    }
    let share = f64::from(recent) / f64::from(n);
    if share > GROWING_SHARE && f64::from(n) * 2.0 >= per_card {
        return Some(OrphanWhy::Growing);
    }
    None
}

/// Where a cluster's would-be steward came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum StewardSource {
    /// An App Master persona pinned to the project.
    AppMaster,
    /// The persona that raised the most of the cluster's items.
    Producer,
}

/// A persona that could steward a drafted mandate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OrphanSteward {
    pub persona_id: String,
    pub name: String,
    pub source: StewardSource,
}

/// One kind's count inside a cluster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OrphanKindCount {
    /// The `DecisionItem.kind` (`idea`, `review`, ...).
    pub kind: String,
    pub count: u32,
}

/// One project's unclaimed work.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OrphanCluster {
    pub project_id: String,
    /// `None` when the project row is gone.
    pub project_name: Option<String>,
    pub items: u32,
    /// Items newer than the fleet's median pending item.
    pub recent: u32,
    pub kinds: Vec<OrphanKindCount>,
    /// Item ids (`DecisionItem.id`), oldest first: what archive would take.
    pub item_ids: Vec<String>,
    pub oldest_at: Option<String>,
    pub newest_at: Option<String>,
    /// `Some` when the cluster asks for a mandate.
    pub why: Option<OrphanWhy>,
    /// The persona a draft would name, when one can be found. A draft always
    /// takes the project out of the orphanage (its items are then held on it).
    pub steward: Option<OrphanSteward>,
    /// Items of this project archived from the Orphans lane so far.
    pub archived: u32,
}

/// The orphanage: every cluster, and the flow it was measured against.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OrphanClusters {
    pub clusters: Vec<OrphanCluster>,
    /// Orphans that name no project: no mandate can hold them.
    pub unassigned: u32,
    /// Items one card releases today (the denominator of "large").
    pub per_card: f64,
    /// Sources that failed to load; their items are absent, never zero.
    pub failed_sources: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn per_card_is_items_over_cards_and_never_below_one() {
        assert_eq!(per_card(12, 4), 3.0);
        assert_eq!(per_card(0, 0), 1.0);
        assert_eq!(per_card(1, 5), 1.0);
    }

    #[test]
    fn a_cluster_below_the_minimum_never_fires() {
        assert_eq!(why(MIN_ITEMS - 1, MIN_ITEMS - 1, 1.0), None);
    }

    #[test]
    fn large_is_relative_to_what_a_card_releases() {
        assert_eq!(why(6, 0, 6.0), Some(OrphanWhy::Large));
        assert_eq!(why(5, 0, 6.0), None);
        assert_eq!(why(40, 0, 6.0), Some(OrphanWhy::Large));
    }

    #[test]
    fn growing_needs_a_recent_majority_and_half_a_card() {
        // 4 orphans against 6 per card: not large; 3 of 4 recent -> growing.
        assert_eq!(why(4, 3, 6.0), Some(OrphanWhy::Growing));
        // Exactly half recent is not "more than half".
        assert_eq!(why(4, 2, 6.0), None);
        // Recent, but less than half a card.
        assert_eq!(why(4, 4, 9.0), None);
    }
}
