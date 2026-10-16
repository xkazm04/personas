//! Table-driven tests over every branch of the routing law, signed and
//! unsigned, and every irreversible class.

use super::*;

const ALL_KINDS: [RouteKind; 16] = [
    RouteKind::Review,
    RouteKind::Idea,
    RouteKind::Question,
    RouteKind::Approval,
    RouteKind::Policy,
    RouteKind::Evolution,
    RouteKind::Goal,
    RouteKind::GoalClaim,
    RouteKind::Incident,
    RouteKind::Report,
    RouteKind::Council,
    RouteKind::Message,
    RouteKind::Dispatch,
    RouteKind::LensBuild,
    RouteKind::LensEvidence,
    RouteKind::LensRelease,
];

/// The lens-scan kinds with their fixed lanes (spark one-control, WP3).
const LENS_KINDS: [(RouteKind, Lane, LaneClause); 3] = [
    (RouteKind::LensBuild, Lane::Breach, LaneClause::Unsigned),
    (RouteKind::LensEvidence, Lane::Accept, LaneClause::None),
    (RouteKind::LensRelease, Lane::Accept, LaneClause::None),
];

fn item(kind: RouteKind) -> RouteInput {
    let mut i = RouteInput::new(kind, "it-1");
    i.project_id = Some("proj".into());
    i
}

fn with_sev(kind: RouteKind, sev: &str) -> RouteInput {
    let mut i = item(kind);
    i.severity = Some(sev.into());
    i
}

fn charter(status: CharterStatus, version: i64, scopes: &[DecideScope]) -> CharterView {
    CharterView {
        charter_id: "c1".into(),
        status,
        envelope: MandateEnvelope {
            decide_scopes: scopes.to_vec(),
            merge_policy: MergePolicy::Never,
            budget_monthly_usd: Some(10.0),
            envelope_version: version,
            kept_at_acts: None,
        },
        spend_used_usd: Some(2.0),
    }
}

fn signed(scopes: &[DecideScope]) -> CharterView {
    charter(CharterStatus::Active, 3, scopes)
}

fn unsigned() -> CharterView {
    charter(CharterStatus::Active, 0, &[])
}

/// Every scope a signed envelope can hold.
fn wide() -> CharterView {
    signed(&personas_db::models::ALL_DECIDE_SCOPES)
}

fn lc(r: &Route) -> (Lane, LaneClause) {
    (r.lane, r.clause)
}

#[test]
fn every_kind_has_one_unsigned_row() {
    for k in ALL_KINDS {
        assert_eq!(
            UNSIGNED_LANE.iter().filter(|r| r.kind == k).count(),
            1,
            "{k:?} must have exactly one UNSIGNED_LANE row"
        );
    }
    assert_eq!(UNSIGNED_LANE.len(), ALL_KINDS.len());
}

#[test]
fn a_message_is_talk_and_never_coalesces() {
    for c in [None, Some(unsigned()), Some(wide())] {
        let r = route(&item(RouteKind::Message), c.as_ref());
        assert_eq!(lc(&r), (Lane::Talk, LaneClause::None));
        assert_eq!(r.coalesce_key, "it-1");
        assert!(r.act.is_none());
    }
}

#[test]
fn no_charter_or_no_project_is_an_orphan() {
    let r = route(&item(RouteKind::Report), None);
    assert_eq!(lc(&r), (Lane::Orphan, LaneClause::None));
    assert_eq!(r.coalesce_key, "orphan:proj");
    assert_eq!(r.charter_id, None);

    let mut no_project = item(RouteKind::Review);
    no_project.project_id = None;
    let r = route(&no_project, Some(&wide()));
    assert_eq!(lc(&r), (Lane::Orphan, LaneClause::None));
    assert_eq!(r.coalesce_key, "orphan:-");
}

#[test]
fn draft_and_suspended_charters_hold_everything_but_talk_claims_and_valves() {
    for status in [CharterStatus::Draft, CharterStatus::Suspended] {
        let c = charter(status, 2, &personas_db::models::ALL_DECIDE_SCOPES);
        for k in ALL_KINDS {
            let r = route(&item(k), Some(&c));
            match k {
                RouteKind::Message => assert_eq!(r.lane, Lane::Talk),
                RouteKind::GoalClaim => assert_eq!(r.lane, Lane::Accept),
                k if k.is_lens_scan() => {
                    assert_ne!(r.lane, Lane::Held, "{k:?} {status:?}");
                    assert!(r.act.is_none());
                }
                _ => {
                    assert_eq!(lc(&r), (Lane::Held, LaneClause::None), "{k:?} {status:?}");
                    assert_eq!(r.coalesce_key, "c1:held:none");
                    assert!(r.act.is_none());
                }
            }
        }
    }
}

#[test]
fn council_is_accept_always_and_never_acted() {
    for c in [unsigned(), signed(&[]), wide()] {
        let r = route(&item(RouteKind::Council), Some(&c));
        assert_eq!(lc(&r), (Lane::Accept, LaneClause::None));
        assert!(r.act.is_none());
        assert_eq!(r.coalesce_key, "c1:accept:none");
    }
}

#[test]
fn a_goal_claim_is_accept_with_or_without_a_charter() {
    let r = route(&item(RouteKind::GoalClaim), Some(&wide()));
    assert_eq!(lc(&r), (Lane::Accept, LaneClause::None));
    assert_eq!(r.charter_id.as_deref(), Some("c1"));
    let r = route(&item(RouteKind::GoalClaim), None);
    assert_eq!(lc(&r), (Lane::Accept, LaneClause::None));
    assert_eq!(r.charter_id, None);
}

/// Rule 10: an unsigned charter acts on nothing; each kind takes its row.
#[test]
fn unsigned_charter_routes_by_the_fixed_table() {
    let c = unsigned();
    let cases: &[(RouteInput, Lane, LaneClause)] = &[
        (
            with_sev(RouteKind::Review, "info"),
            Lane::Breach,
            LaneClause::Unsigned,
        ),
        (
            with_sev(RouteKind::Review, "low"),
            Lane::Breach,
            LaneClause::Unsigned,
        ),
        (
            with_sev(RouteKind::Review, "medium"),
            Lane::Breach,
            LaneClause::Risk,
        ),
        (
            with_sev(RouteKind::Review, "high"),
            Lane::Breach,
            LaneClause::Risk,
        ),
        (
            with_sev(RouteKind::Review, "critical"),
            Lane::Breach,
            LaneClause::Risk,
        ),
        (
            item(RouteKind::Question),
            Lane::Breach,
            LaneClause::Unsigned,
        ),
        (
            item(RouteKind::Approval),
            Lane::Breach,
            LaneClause::Unsigned,
        ),
        (item(RouteKind::Idea), Lane::Breach, LaneClause::Unsigned),
        (
            item(RouteKind::Dispatch),
            Lane::Breach,
            LaneClause::Unsigned,
        ),
        (item(RouteKind::Policy), Lane::Sign, LaneClause::None),
        (item(RouteKind::Evolution), Lane::Sign, LaneClause::None),
        (item(RouteKind::Goal), Lane::Sign, LaneClause::None),
        (
            with_sev(RouteKind::Incident, "medium"),
            Lane::Breach,
            LaneClause::Unsigned,
        ),
        (
            with_sev(RouteKind::Incident, "high"),
            Lane::Breach,
            LaneClause::Stop,
        ),
        (
            with_sev(RouteKind::Incident, "critical"),
            Lane::Breach,
            LaneClause::Stop,
        ),
        (item(RouteKind::Report), Lane::Accept, LaneClause::None),
        (item(RouteKind::Council), Lane::Accept, LaneClause::None),
        (item(RouteKind::Message), Lane::Talk, LaneClause::None),
    ];
    for (i, lane, clause) in cases {
        let r = route(i, Some(&c));
        assert_eq!(
            lc(&r),
            (*lane, *clause),
            "{:?} sev {:?}",
            i.kind,
            i.severity
        );
        assert!(r.act.is_none(), "an unsigned charter acts on nothing");
    }
    let mut tier1 = with_sev(RouteKind::Incident, "low");
    tier1.tier = Some(1);
    assert_eq!(
        lc(&route(&tier1, Some(&c))),
        (Lane::Breach, LaneClause::Stop)
    );
}

/// Even an unsigned envelope holding scopes (a hand-edited row) acts on nothing.
#[test]
fn an_unsigned_envelope_with_scopes_still_acts_on_nothing() {
    let c = charter(
        CharterStatus::Active,
        0,
        &personas_db::models::ALL_DECIDE_SCOPES,
    );
    for k in ALL_KINDS {
        for sev in ["info", "low", "medium"] {
            let mut i = with_sev(k, sev);
            i.project_id = Some("proj".into());
            assert!(route(&i, Some(&c)).act.is_none(), "{k:?} {sev}");
        }
    }
}

#[test]
fn signed_scope_kinds_are_scope_breaches() {
    for k in [RouteKind::Approval, RouteKind::Policy, RouteKind::Evolution] {
        let r = route(&item(k), Some(&wide()));
        assert_eq!(lc(&r), (Lane::Breach, LaneClause::Scope), "{k:?}");
        assert_eq!(r.coalesce_key, "c1:breach:scope");
    }
}

#[test]
fn signed_incidents_stop_or_are_acknowledged_inside_the_envelope() {
    let stop = with_sev(RouteKind::Incident, "high");
    assert_eq!(
        lc(&route(&stop, Some(&wide()))),
        (Lane::Breach, LaneClause::Stop)
    );
    let mut tier1 = with_sev(RouteKind::Incident, "low");
    tier1.tier = Some(1);
    assert_eq!(
        lc(&route(&tier1, Some(&wide()))),
        (Lane::Breach, LaneClause::Stop)
    );

    let low = with_sev(RouteKind::Incident, "medium");
    let r = route(&low, Some(&signed(&[DecideScope::IncidentTriage])));
    assert_eq!(lc(&r), (Lane::Evidence, LaneClause::None));
    assert_eq!(r.act, Some(RouterAct::AcknowledgeIncident));
    let r = route(&low, Some(&signed(&[DecideScope::ReportRead])));
    assert_eq!(lc(&r), (Lane::Breach, LaneClause::Scope));
    assert!(r.act.is_none());
}

#[test]
fn signed_reviews_by_severity_and_scope() {
    let info_scope = signed(&[DecideScope::ReviewInfo]);
    for sev in ["high", "critical", "medium", "urgent", " "] {
        let r = route(&with_sev(RouteKind::Review, sev), Some(&info_scope));
        assert_eq!(lc(&r), (Lane::Breach, LaneClause::Risk), "{sev:?}");
    }
    let mut no_sev = item(RouteKind::Review);
    no_sev.severity = None;
    assert_eq!(
        lc(&route(&no_sev, Some(&info_scope))),
        (Lane::Breach, LaneClause::Risk)
    );

    for sev in ["info", "low", "INFO"] {
        let r = route(&with_sev(RouteKind::Review, sev), Some(&info_scope));
        assert_eq!(lc(&r), (Lane::Evidence, LaneClause::None), "{sev}");
        assert_eq!(r.act, Some(RouterAct::ApproveReview));
    }
    let r = route(&with_sev(RouteKind::Review, "info"), Some(&signed(&[])));
    assert_eq!(lc(&r), (Lane::Breach, LaneClause::Scope));

    let mut binding = with_sev(RouteKind::Review, "info");
    binding.binding = true;
    let r = route(&binding, Some(&info_scope));
    assert_eq!(lc(&r), (Lane::Breach, LaneClause::Scope));
    assert!(
        r.act.is_none(),
        "a binding review is never filed by the router"
    );
}

#[test]
fn signed_reports_are_filed_or_read_and_done() {
    let r = route(
        &item(RouteKind::Report),
        Some(&signed(&[DecideScope::ReportRead])),
    );
    assert_eq!(lc(&r), (Lane::Evidence, LaneClause::None));
    assert_eq!(r.act, Some(RouterAct::MarkReportRead));
    assert_eq!(r.coalesce_key, "c1:evidence:none");
    let r = route(&item(RouteKind::Report), Some(&signed(&[])));
    assert_eq!(lc(&r), (Lane::Accept, LaneClause::None));
    assert!(r.act.is_none());
}

#[test]
fn signed_judgment_kinds_wait_for_the_steward_or_breach() {
    let cases = [
        (RouteKind::Idea, DecideScope::IdeaAccept),
        (RouteKind::Question, DecideScope::QuestionAnswer),
        (RouteKind::Dispatch, DecideScope::Dispatch),
    ];
    for (k, scope) in cases {
        let r = route(&item(k), Some(&signed(&[scope])));
        assert_eq!(lc(&r), (Lane::Steward, LaneClause::None), "{k:?}");
        assert!(r.act.is_none(), "the router never takes a judgment call");
        let r = route(&item(k), Some(&signed(&[])));
        assert_eq!(lc(&r), (Lane::Breach, LaneClause::Scope), "{k:?}");
    }
    // Rejecting alone does not make the steward the idea's judge.
    let r = route(
        &item(RouteKind::Idea),
        Some(&signed(&[DecideScope::IdeaReject])),
    );
    assert_eq!(lc(&r), (Lane::Breach, LaneClause::Scope));
    let r = route(&item(RouteKind::Goal), Some(&wide()));
    assert_eq!(lc(&r), (Lane::Sign, LaneClause::None));
}

/// Rule 11: nothing irreversible is ever acted by the router, under any
/// charter, for any kind.
#[test]
fn nothing_irreversible_is_ever_acted() {
    let classes = [
        Irreversible::Merge,
        Irreversible::Spend,
        Irreversible::OutboundMessage,
        Irreversible::Deletion,
    ];
    let charters = [
        None,
        Some(unsigned()),
        Some(signed(&[])),
        Some(wide()),
        Some(charter(
            CharterStatus::Suspended,
            4,
            &personas_db::models::ALL_DECIDE_SCOPES,
        )),
    ];
    for irr in classes {
        for k in ALL_KINDS {
            for c in &charters {
                for sev in ["info", "low"] {
                    let mut i = with_sev(k, sev);
                    i.irreversible = Some(irr);
                    i.cost_usd = Some(0.01);
                    let r = route(&i, c.as_ref());
                    assert!(r.act.is_none(), "{irr:?} {k:?} {c:?}");
                    assert_ne!(r.lane, Lane::Evidence, "{irr:?} {k:?}");
                }
            }
        }
    }
}

#[test]
fn valves_breach_one_at_a_time_even_without_a_charter() {
    for irr in [Irreversible::OutboundMessage, Irreversible::Deletion] {
        for c in [None, Some(unsigned()), Some(wide())] {
            let mut i = item(RouteKind::Approval);
            i.irreversible = Some(irr);
            let r = route(&i, c.as_ref());
            assert_eq!(lc(&r), (Lane::Breach, LaneClause::Valve), "{irr:?}");
            assert_eq!(r.coalesce_key, "it-1", "a valve is never batched");
        }
    }
}

#[test]
fn merge_follows_the_signed_policy_only() {
    let mut i = item(RouteKind::Review);
    i.irreversible = Some(Irreversible::Merge);
    // Unsigned: the column default `never` is not a choice, but the router
    // still acts on nothing: a merge item reaches the operator.
    assert_eq!(
        lc(&route(&i, Some(&unsigned()))),
        (Lane::Breach, LaneClause::Merge)
    );
    for (policy, want) in [
        (MergePolicy::Never, (Lane::Breach, LaneClause::Merge)),
        (MergePolicy::GateGreen, (Lane::Steward, LaneClause::Merge)),
        (
            MergePolicy::GateGreenCouncilReady,
            (Lane::Accept, LaneClause::Merge),
        ),
    ] {
        let mut c = wide();
        c.envelope.merge_policy = policy;
        let r = route(&i, Some(&c));
        assert_eq!(lc(&r), want, "{policy:?}");
        assert!(r.act.is_none());
    }
}

#[test]
fn spend_fits_the_signed_cap_or_breaches() {
    let mut i = item(RouteKind::Dispatch);
    i.irreversible = Some(Irreversible::Spend);
    i.cost_usd = Some(3.0);
    assert_eq!(
        lc(&route(&i, Some(&unsigned()))),
        (Lane::Breach, LaneClause::Spend)
    );
    // cap 10, used 2, cost 3: fits.
    assert_eq!(
        lc(&route(&i, Some(&wide()))),
        (Lane::Steward, LaneClause::Spend)
    );
    i.cost_usd = Some(9.0);
    assert_eq!(
        lc(&route(&i, Some(&wide()))),
        (Lane::Breach, LaneClause::Spend)
    );
    i.cost_usd = None;
    assert_eq!(
        lc(&route(&i, Some(&wide()))),
        (Lane::Breach, LaneClause::Spend)
    );
    let mut no_cap = wide();
    no_cap.envelope.budget_monthly_usd = None;
    i.cost_usd = Some(0.5);
    assert_eq!(
        lc(&route(&i, Some(&no_cap))),
        (Lane::Breach, LaneClause::Spend)
    );
    let mut unreadable = wide();
    unreadable.spend_used_usd = None;
    assert_eq!(
        lc(&route(&i, Some(&unreadable))),
        (Lane::Breach, LaneClause::Spend)
    );
}

#[test]
fn a_reverted_item_goes_back_to_its_lane_unacted() {
    let c = wide();
    let r = route_without_act(&item(RouteKind::Report), Some(&c));
    assert_eq!(lc(&r), (Lane::Accept, LaneClause::None));
    assert!(r.act.is_none());
    let r = route_without_act(&with_sev(RouteKind::Review, "info"), Some(&c));
    assert_eq!(lc(&r), (Lane::Breach, LaneClause::Scope));
    let r = route_without_act(&with_sev(RouteKind::Incident, "low"), Some(&c));
    assert_eq!(lc(&r), (Lane::Breach, LaneClause::Scope));
}

#[test]
fn router_acts_name_their_scope_and_reversibility() {
    assert_eq!(RouterAct::MarkReportRead.scope(), DecideScope::ReportRead);
    assert_eq!(RouterAct::ApproveReview.scope(), DecideScope::ReviewInfo);
    assert_eq!(
        RouterAct::AcknowledgeIncident.scope(),
        DecideScope::IncidentTriage
    );
    assert!(RouterAct::MarkReportRead.reversible());
    assert!(RouterAct::AcknowledgeIncident.reversible());
    assert!(
        !RouterAct::ApproveReview.reversible(),
        "no door returns a review to pending"
    );
    for a in [
        RouterAct::MarkReportRead,
        RouterAct::ApproveReview,
        RouterAct::AcknowledgeIncident,
    ] {
        assert_eq!(RouterAct::from_item_kind(a.item_kind()), Some(a));
    }
    assert_eq!(RouterAct::from_item_kind("idea"), None);
}

#[test]
fn wire_values_are_the_brief_s() {
    let lanes = [
        (Lane::Breach, "breach"),
        (Lane::Sign, "sign"),
        (Lane::Accept, "accept"),
        (Lane::Talk, "talk"),
        (Lane::Orphan, "orphan"),
        (Lane::Held, "held"),
        (Lane::Steward, "steward"),
        (Lane::Evidence, "evidence"),
    ];
    for (l, s) in lanes {
        assert_eq!(serde_json::to_string(&l).unwrap(), format!("\"{s}\""));
        assert_eq!(l.as_str(), s);
    }
    let clauses = [
        (LaneClause::Stop, "stop"),
        (LaneClause::Risk, "risk"),
        (LaneClause::Scope, "scope"),
        (LaneClause::Spend, "spend"),
        (LaneClause::Merge, "merge"),
        (LaneClause::Valve, "valve"),
        (LaneClause::Unsigned, "unsigned"),
        (LaneClause::None, "none"),
    ];
    for (c, s) in clauses {
        assert_eq!(serde_json::to_string(&c).unwrap(), format!("\"{s}\""));
        assert_eq!(c.as_str(), s);
    }
    let irr = [
        (Irreversible::Merge, "merge"),
        (Irreversible::Spend, "spend"),
        (Irreversible::OutboundMessage, "outbound-message"),
        (Irreversible::Deletion, "deletion"),
    ];
    for (i, s) in irr {
        assert_eq!(serde_json::to_string(&i).unwrap(), format!("\"{s}\""));
    }
}

#[test]
fn charter_status_parses_the_three_live_states_only() {
    assert_eq!(CharterStatus::parse("draft"), Some(CharterStatus::Draft));
    assert_eq!(CharterStatus::parse("active"), Some(CharterStatus::Active));
    assert_eq!(
        CharterStatus::parse("suspended"),
        Some(CharterStatus::Suspended)
    );
    assert_eq!(CharterStatus::parse("retired"), None);
}

/// The keep-out (spark one-control): under a SIGNED charter whose scopes would
/// let the router act on anything it can, a lens-scan card still takes its
/// fixed lane, and nothing is acted.
#[test]
fn a_lens_scan_card_is_never_acted_under_a_signed_charter() {
    for (k, lane, clause) in LENS_KINDS {
        for sev in [None, Some("info"), Some("low"), Some("critical")] {
            let mut i = item(k);
            i.severity = sev.map(Into::into);
            for may_act in [true, false] {
                let r = if may_act {
                    route(&i, Some(&wide()))
                } else {
                    route_without_act(&i, Some(&wide()))
                };
                assert_eq!(lc(&r), (lane, clause), "{k:?} {sev:?}");
                assert!(r.act.is_none(), "{k:?} {sev:?} must not be acted");
                assert_eq!(r.charter_id.as_deref(), Some("c1"));
                assert_eq!(
                    r.coalesce_key,
                    format!("c1:{}:{}", lane.as_str(), clause.as_str())
                );
            }
        }
    }
}

/// The keep-out holds without a charter, under an unsigned one, a draft and a
/// suspended one: a lens-scan card is never an orphan, never held.
#[test]
fn a_lens_scan_card_takes_its_fixed_lane_whoever_holds_the_project() {
    let charters = [
        None,
        Some(unsigned()),
        Some(signed(&[])),
        Some(charter(
            CharterStatus::Draft,
            2,
            &personas_db::models::ALL_DECIDE_SCOPES,
        )),
        Some(charter(
            CharterStatus::Suspended,
            2,
            &personas_db::models::ALL_DECIDE_SCOPES,
        )),
    ];
    for (k, lane, clause) in LENS_KINDS {
        for c in &charters {
            let r = route(&item(k), c.as_ref());
            assert_eq!(lc(&r), (lane, clause), "{k:?} {c:?}");
            assert!(r.act.is_none(), "{k:?} {c:?}");
        }
        let r = route(&item(k), None);
        assert_eq!(
            r.coalesce_key,
            format!("orphan:proj:{}:{}", lane.as_str(), clause.as_str())
        );
    }
}

/// Each keep-out row is the one the frontend applies (`frontendLanes.ts`
/// parses this table), and its wire name is the frontend kind.
#[test]
fn the_lens_scan_rows_and_wire_names_match_the_frontend_kinds() {
    for ((k, lane, clause), wire) in LENS_KINDS.into_iter().zip(["build", "evidence", "release"]) {
        assert_eq!(unsigned_row(k), (lane, clause), "{k:?}");
        assert_eq!(k.wire(), wire);
        assert!(k.is_lens_scan());
    }
    assert!(!RouteKind::GoalClaim.is_lens_scan());
}
