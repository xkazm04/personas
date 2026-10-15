//! **The re-read law** (spark `mandate-lanes`, WP6): when a signed mandate
//! asks the operator to read its envelope again. Derived from USE, never from
//! a calendar - a quiet week asks nothing, a busy one may ask twice.
//!
//! Four triggers, first match wins (the prototype's `rereadInfo`, ported as
//! law, not code):
//!
//! 1. **cap** - near its spend cap while quiet: spend at least
//!    [`CAP_SHARE`] of the cap and nothing reaching the operator. Either the
//!    work is steady and the cap is right, or the envelope is wider than the
//!    work needs. Suggests narrowing its busiest scope.
//! 2. **asks** - asks often for its size: more than [`ASK_RATIO`] asks per
//!    decision act once it has more than [`ASK_MIN_ACTS`] acts, or at least
//!    [`FLEET_MIN_ASKS`] asks at [`FLEET_FACTOR`] times the fleet's own mean
//!    ratio. Suggests widening the scope that would absorb the most asks.
//! 3. **merges** - merged [`MERGES_SINCE_READ`] or more times since the
//!    operator last read it (signed or kept), under a policy other than
//!    `never`. Suggests narrowing the merge policy back to `never`.
//! 4. **dominant** - one out-of-scope kind dominates the asks: the scope that
//!    would absorb the most asks absorbs at least [`DOMINANT_MIN_ABSORB`] of at
//!    least [`DOMINANT_MIN_ASKS`] asks, and at least twice an even share of
//!    the item kinds asking (capped at all of them). Suggests widening it.
//!
//! **Kept marker.** "You kept it at N acts": Keep (and a re-signature) sets
//! `kept_at_acts`, and no trigger is read again until the decision acts have
//! grown to [`KEEP_GROWTH`] times that marker (at least one act). Then the
//! trigger must fire again on its own figures.
//!
//! Only a SIGNED, ACTIVE mandate is re-read: an unsigned one delegates
//! nothing (every item already reaches the operator), and a draft or a
//! suspended one is not deciding.
//!
//! No IO. The caller counts asks and absorptions through the router
//! (`mandate_router::route` with the scope added), never by estimate.

use personas_db::models::{DecideScope, MandateReread, RereadCode, RereadMove, RereadSuggestion};

/// Spend share of the cap that counts as "near the cap" (90%).
pub const CAP_SHARE: f64 = 0.9;
/// Asks per decision act above which a mandate "asks often for its size".
pub const ASK_RATIO: f64 = 0.25;
/// The ratio rule needs more decision acts than this to be a pattern.
pub const ASK_MIN_ACTS: i64 = 6;
/// The fleet rule needs at least this many asks.
pub const FLEET_MIN_ASKS: u32 = 3;
/// ... at this multiple of the fleet's mean asks-per-act ratio.
pub const FLEET_FACTOR: f64 = 1.5;
/// Merges since the last read that ask for a second reading.
pub const MERGES_SINCE_READ: i64 = 5;
/// The dominant-kind rule needs at least this many asks ...
pub const DOMINANT_MIN_ASKS: u32 = 4;
/// ... and its lead scope must absorb at least this many of them.
pub const DOMINANT_MIN_ABSORB: u32 = 3;
/// After a keep, the decision acts must reach this multiple of the marker.
pub const KEEP_GROWTH: i64 = 2;

/// One mandate's use, as the law reads it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RereadInput {
    pub active: bool,
    pub signed: bool,
    pub spend_used_usd: Option<f64>,
    pub cap_usd: Option<f64>,
    pub decisions: i64,
    pub kept_at_acts: Option<i64>,
    pub merge_policy_never: bool,
    pub merges_since_read: i64,
    pub asks: u32,
    /// Per scope the envelope does NOT hold: how many of the current asks the
    /// router would no longer send the operator with that scope added.
    pub absorb: Vec<(DecideScope, u32)>,
    /// Distinct item kinds among the current asks (the "even share" divisor).
    pub ask_kinds: u32,
    /// The held scope with the most decision acts, when any has one.
    pub busiest_held: Option<DecideScope>,
}

/// asks / (acts + 1): the mandate's asks for its size.
pub fn ask_ratio(asks: u32, decisions: i64) -> f64 {
    f64::from(asks) / (decisions.max(0) as f64 + 1.0)
}

/// The fleet's mean ask ratio over signed, active mandates that have acted.
pub fn fleet_ratio(inputs: &[RereadInput]) -> f64 {
    let ratios: Vec<f64> = inputs
        .iter()
        .filter(|i| i.active && i.signed && i.decisions > 0)
        .map(|i| ask_ratio(i.asks, i.decisions))
        .collect();
    if ratios.is_empty() {
        0.0
    } else {
        ratios.iter().sum::<f64>() / ratios.len() as f64
    }
}

/// Whether a keep still holds the re-read back.
pub fn kept_quiet(kept_at_acts: Option<i64>, decisions: i64) -> bool {
    kept_at_acts.is_some_and(|k| decisions < k.max(1) * KEEP_GROWTH)
}

/// The re-read of one mandate, or `None` when it has nothing to ask.
pub fn reread_of(i: &RereadInput, fleet: f64) -> Option<MandateReread> {
    if !i.active || !i.signed || kept_quiet(i.kept_at_acts, i.decisions) {
        return None;
    }
    let spend_pct = match (i.spend_used_usd, i.cap_usd) {
        (Some(used), Some(cap)) if cap > 0.0 => Some((used / cap * 100.0).round().max(0.0) as u32),
        _ => None,
    };
    let lead = i
        .absorb
        .iter()
        .filter(|(_, n)| *n > 0)
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.as_str().cmp(a.0.as_str())))
        .copied();
    let base = MandateReread {
        code: RereadCode::Cap,
        asks: i.asks,
        acts: i.decisions,
        spend_pct,
        merges_since_read: i.merges_since_read,
        lead_scope: lead.map(|l| l.0),
        lead_absorbs: lead.map(|l| l.1).unwrap_or(0),
        kept_at_acts: i.kept_at_acts,
        suggest: None,
    };
    let widen_lead = lead.map(|(s, _)| RereadSuggestion {
        action: RereadMove::Widen,
        scope: Some(s),
    });

    let near_cap = matches!((i.spend_used_usd, i.cap_usd),
        (Some(used), Some(cap)) if cap > 0.0 && used >= cap * CAP_SHARE);
    if near_cap && i.asks == 0 {
        return Some(MandateReread {
            code: RereadCode::Cap,
            suggest: i.busiest_held.map(|s| RereadSuggestion {
                action: RereadMove::Narrow,
                scope: Some(s),
            }),
            ..base
        });
    }
    let ratio = ask_ratio(i.asks, i.decisions);
    let by_ratio = ratio > ASK_RATIO && i.decisions > ASK_MIN_ACTS;
    let by_fleet = i.asks >= FLEET_MIN_ASKS && fleet > 0.0 && ratio >= FLEET_FACTOR * fleet;
    if by_ratio || by_fleet {
        return Some(MandateReread {
            code: RereadCode::Asks,
            suggest: widen_lead,
            ..base
        });
    }
    if !i.merge_policy_never && i.merges_since_read >= MERGES_SINCE_READ {
        return Some(MandateReread {
            code: RereadCode::Merges,
            suggest: Some(RereadSuggestion {
                action: RereadMove::Narrow,
                scope: None,
            }),
            ..base
        });
    }
    if let Some((_, n)) = lead {
        let spread = f64::from(i.ask_kinds.max(1));
        let share = f64::from(n) / f64::from(i.asks.max(1));
        if i.asks >= DOMINANT_MIN_ASKS
            && n >= DOMINANT_MIN_ABSORB
            && share >= (2.0 / spread).min(1.0)
        {
            return Some(MandateReread {
                code: RereadCode::Dominant,
                suggest: widen_lead,
                ..base
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signed() -> RereadInput {
        RereadInput {
            active: true,
            signed: true,
            merge_policy_never: true,
            ..Default::default()
        }
    }

    #[test]
    fn unsigned_draft_or_suspended_mandates_are_never_reread() {
        let mut i = signed();
        i.asks = 20;
        i.decisions = 10;
        assert!(reread_of(&i, 0.0).is_some());
        i.signed = false;
        assert!(reread_of(&i, 0.0).is_none());
        i.signed = true;
        i.active = false;
        assert!(reread_of(&i, 0.0).is_none());
    }

    #[test]
    fn cap_fires_at_cap_share_while_quiet_and_suggests_narrowing_the_busiest_scope() {
        let mut i = signed();
        i.cap_usd = Some(10.0);
        i.spend_used_usd = Some(10.0 * CAP_SHARE);
        i.busiest_held = Some(DecideScope::ReportRead);
        let r = reread_of(&i, 0.0).unwrap();
        assert_eq!(r.code, RereadCode::Cap);
        assert_eq!(r.spend_pct, Some(90));
        assert_eq!(
            r.suggest,
            Some(RereadSuggestion {
                action: RereadMove::Narrow,
                scope: Some(DecideScope::ReportRead)
            })
        );
        // Just under the share: quiet.
        i.spend_used_usd = Some(10.0 * CAP_SHARE - 0.01);
        assert!(reread_of(&i, 0.0).is_none());
        // Near the cap but asking: not "quiet".
        i.spend_used_usd = Some(9.5);
        i.asks = 1;
        assert_ne!(reread_of(&i, 0.0).map(|r| r.code), Some(RereadCode::Cap));
    }

    #[test]
    fn asks_fires_above_the_ratio_only_past_the_minimum_acts() {
        let mut i = signed();
        i.decisions = ASK_MIN_ACTS;
        i.asks = 3; // 3/7 > ratio, but too few acts
        assert!(reread_of(&i, 0.0).is_none());
        i.decisions = ASK_MIN_ACTS + 1; // 3/8 = .375 > .25
        i.absorb = vec![(DecideScope::IdeaAccept, 2)];
        let r = reread_of(&i, 0.0).unwrap();
        assert_eq!(r.code, RereadCode::Asks);
        assert_eq!(r.suggest.unwrap().scope, Some(DecideScope::IdeaAccept));
        // Exactly at the ratio does not fire: 2/8 = .25.
        i.asks = 2;
        assert!(reread_of(&i, 0.0).is_none());
    }

    #[test]
    fn asks_fires_against_the_fleet_mean() {
        let mut i = signed();
        i.decisions = 3;
        i.asks = FLEET_MIN_ASKS; // ratio .75
        assert!(reread_of(&i, 0.6).is_none(), ".75 < 1.5 x .6");
        assert_eq!(reread_of(&i, 0.5).unwrap().code, RereadCode::Asks);
        i.asks = FLEET_MIN_ASKS - 1;
        assert!(
            reread_of(&i, 0.1).is_none(),
            "too few asks for the fleet rule"
        );
    }

    #[test]
    fn merges_fire_only_under_a_merge_policy() {
        let mut i = signed();
        i.merges_since_read = MERGES_SINCE_READ;
        assert!(
            reread_of(&i, 0.0).is_none(),
            "policy never: merges are not the steward's"
        );
        i.merge_policy_never = false;
        let r = reread_of(&i, 0.0).unwrap();
        assert_eq!(r.code, RereadCode::Merges);
        assert_eq!(
            r.suggest,
            Some(RereadSuggestion {
                action: RereadMove::Narrow,
                scope: None
            })
        );
        i.merges_since_read = MERGES_SINCE_READ - 1;
        assert!(reread_of(&i, 0.0).is_none());
    }

    #[test]
    fn dominant_kind_needs_enough_asks_absorbed_and_a_share_twice_even() {
        let mut i = signed();
        i.decisions = 100; // keep the ratio rule quiet: 4/101
        i.asks = DOMINANT_MIN_ASKS;
        i.ask_kinds = 3; // 3 of 4 >= 2/3
        i.absorb = vec![
            (DecideScope::IdeaAccept, DOMINANT_MIN_ABSORB),
            (DecideScope::Dispatch, 0),
        ];
        let r = reread_of(&i, 0.0).unwrap();
        assert_eq!(r.code, RereadCode::Dominant);
        assert_eq!(r.lead_scope, Some(DecideScope::IdeaAccept));
        assert_eq!(r.lead_absorbs, 3);
        // Absorbs too few.
        i.absorb = vec![(DecideScope::IdeaAccept, DOMINANT_MIN_ABSORB - 1)];
        assert!(reread_of(&i, 0.0).is_none());
        // Two kinds sharing evenly: 3 of 6 is not twice an even half.
        i.asks = 6;
        i.ask_kinds = 2;
        i.absorb = vec![
            (DecideScope::IdeaAccept, 3),
            (DecideScope::QuestionAnswer, 3),
        ];
        assert!(reread_of(&i, 0.0).is_none());
    }

    #[test]
    fn keep_holds_the_reread_until_the_acts_double_and_it_fires_again() {
        let mut i = signed();
        i.decisions = 7;
        i.asks = 3;
        assert_eq!(reread_of(&i, 0.0).unwrap().code, RereadCode::Asks);
        i.kept_at_acts = Some(7);
        assert!(reread_of(&i, 0.0).is_none(), "kept at 7 acts");
        i.decisions = 7 * KEEP_GROWTH - 1;
        i.asks = 10;
        assert!(reread_of(&i, 0.0).is_none(), "not yet past the marker");
        i.decisions = 7 * KEEP_GROWTH;
        i.asks = 1; // past the marker, but the trigger no longer fires
        assert!(reread_of(&i, 0.0).is_none());
        i.asks = 5; // 5/15 > .25 with 14 acts
        let r = reread_of(&i, 0.0).unwrap();
        assert_eq!(r.code, RereadCode::Asks);
        assert_eq!(r.kept_at_acts, Some(7));
        // A keep at zero acts still waits for KEEP_GROWTH acts.
        assert!(kept_quiet(Some(0), KEEP_GROWTH - 1));
        assert!(!kept_quiet(Some(0), KEEP_GROWTH));
    }

    #[test]
    fn fleet_ratio_ignores_mandates_that_never_acted() {
        let mut a = signed();
        a.decisions = 3;
        a.asks = 4;
        let b = signed();
        assert_eq!(fleet_ratio(&[a, b]), 1.0);
        assert_eq!(fleet_ratio(&[]), 0.0);
    }
}
