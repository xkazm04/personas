use super::*;

const SOLO_ORDER: [&str; 10] = [
    "frame", "recall", "isolate", "sync", "gate", "tests", "docs", "commit", "land", "record",
];
const TEAM_ORDER: [&str; 11] = [
    "frame", "recall", "isolate", "link", "sync", "gate", "tests", "docs", "commit", "land",
    "record",
];

fn ids(doc: &LifecycleDoc) -> Vec<&str> {
    doc.steps.iter().map(|s| s.id.as_str()).collect()
}

#[test]
fn presets_have_the_documented_order_and_phases() {
    let solo = preset_doc(LifecyclePreset::Solo);
    let team = preset_doc(LifecyclePreset::Team);
    assert_eq!(ids(&solo), SOLO_ORDER);
    assert_eq!(ids(&team), TEAM_ORDER);
    for doc in [&solo, &team] {
        for s in &doc.steps {
            let before = ["frame", "recall", "isolate", "link", "sync"].contains(&s.id.as_str());
            let want = if before {
                LifecyclePhase::Before
            } else {
                LifecyclePhase::After
            };
            assert_eq!(s.phase, want, "{} phase", s.id);
            assert!(s.label.is_none(), "built-in steps carry no label");
            assert!(BUILT_IN_STEP_IDS.contains(&s.id.as_str()));
            assert!(!s.bindings.is_empty(), "{} has a binding", s.id);
            assert!(
                !s.rule.is_empty() && s.rule.chars().count() <= 220,
                "{} rule length",
                s.id
            );
        }
    }
}

#[test]
fn team_differs_where_the_brief_says() {
    let team = preset_doc(LifecyclePreset::Team);
    let get = |id: &str| team.steps.iter().find(|s| s.id == id).expect(id);
    assert_eq!(get("gate").bindings, vec![B::Hook, B::Ci]);
    assert_eq!(get("tests").bindings, vec![B::Ci]);
    assert_eq!(get("docs").params.docs_required, Some(true));
    assert_eq!(
        get("land").params.land_mode,
        Some(LifecycleLandMode::PullRequest)
    );
    let solo = preset_doc(LifecyclePreset::Solo);
    let land = solo.steps.iter().find(|s| s.id == "land").expect("land");
    assert_eq!(land.params.land_mode, Some(LifecycleLandMode::LocalMerge));
}

#[test]
fn projection_matches_the_ts_standards_shape() {
    let json = standards_projection(&preset_doc(LifecyclePreset::Team));
    assert_eq!(
        json,
        r#"{"precommit":{"lint":true,"docs_required":true,"code_quality":true},"branching":{"pr_base":"main","automerge":{"enabled":false,"target":null}}}"#
    );
    let solo = standards_projection(&preset_doc(LifecyclePreset::Solo));
    assert!(solo.contains(r#""docs_required":false"#));
}

#[test]
fn projection_round_trips_for_both_presets() {
    for preset in [LifecyclePreset::Solo, LifecyclePreset::Team] {
        let doc = preset_doc(preset);
        let back = apply_standards(&doc, &standards_projection(&doc));
        assert_eq!(back, doc, "{preset:?} round-trips");
    }
}

#[test]
fn apply_standards_maps_each_field_onto_its_step() {
    let doc = preset_doc(LifecyclePreset::Solo);
    let edited = apply_standards(
        &doc,
        r#"{"precommit":{"lint":false,"docs_required":true,"code_quality":false},
            "branching":{"pr_base":"test","automerge":{"enabled":true,"target":"main"}}}"#,
    );
    let get = |id: &str| {
        edited
            .steps
            .iter()
            .find(|s| s.id == id)
            .expect(id)
            .params
            .clone()
    };
    assert_eq!(get("gate").lint, Some(false));
    assert_eq!(get("gate").code_quality, Some(false));
    assert_eq!(get("docs").docs_required, Some(true));
    assert_eq!(get("land").pr_base.as_deref(), Some("test"));
    assert_eq!(get("land").automerge_enabled, Some(true));
    assert_eq!(get("land").automerge_target.as_deref(), Some("main"));
    // Fields the standards envelope does not own are untouched.
    assert_eq!(get("land").land_mode, Some(LifecycleLandMode::LocalMerge));
    assert_eq!(edited.steps.len(), doc.steps.len());
}

#[test]
fn unparseable_standards_read_as_nothing_enabled() {
    let doc = preset_doc(LifecyclePreset::Solo);
    let edited = apply_standards(&doc, "not json");
    let gate = edited.steps.iter().find(|s| s.id == "gate").expect("gate");
    assert_eq!(gate.params.lint, Some(false));
    let land = edited.steps.iter().find(|s| s.id == "land").expect("land");
    assert_eq!(land.params.pr_base, None);
}
