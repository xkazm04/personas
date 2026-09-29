use serde_json::json;

use super::*;
use crate::db::models::{LifecycleChangeKind, LifecycleDoc, LifecyclePreset};
use crate::lifecycle::presets::preset_doc;

fn solo() -> LifecycleDoc {
    preset_doc(LifecyclePreset::Solo)
}

/// Resolve + validate a steps array against Solo, the way the op does.
fn propose(preset: Option<&str>, steps: serde_json::Value) -> Result<LifecycleDoc, String> {
    let mut params = json!({"project": "p", "change_note": "why", "steps": steps});
    if let Some(p) = preset {
        params["preset"] = json!(p);
    }
    let input = proposal::parse_input(&params)?;
    let doc = proposal::resolve_doc(&solo(), input.preset, input.steps)?;
    validate_doc(&doc)?;
    Ok(doc)
}

/// Solo's ids as `{id}` stubs (every field inherited).
fn solo_stubs() -> Vec<serde_json::Value> {
    solo().steps.iter().map(|s| json!({"id": s.id})).collect()
}

#[test]
fn a_stub_list_resolves_to_the_current_document() {
    let doc = propose(None, json!(solo_stubs())).expect("stubs resolve");
    assert_eq!(doc, solo());
    assert!(diff(&solo(), &doc).is_empty());
}

#[test]
fn rejects_an_unknown_id_and_names_the_valid_ones() {
    let mut steps = solo_stubs();
    steps.push(json!({"id": "review", "phase": "after", "rule": "Review.", "bindings": ["app"]}));
    let err = propose(None, json!(steps)).unwrap_err();
    assert!(err.contains("unknown step id `review`"), "{err}");
    assert!(err.contains("frame, recall"), "{err}");
}

#[test]
fn rejects_a_custom_step_without_a_label() {
    let mut steps = solo_stubs();
    steps.push(json!({"id": "x-review", "phase": "after", "rule": "Review.", "bindings": ["app"]}));
    let err = propose(None, json!(steps)).unwrap_err();
    assert!(
        err.contains("custom step `x-review` needs a non-empty `label`"),
        "{err}"
    );
    // With one it passes.
    let mut steps = solo_stubs();
    steps.push(json!({"id": "x-review", "phase": "after", "label": "Review", "rule": "Review.", "bindings": ["app"]}));
    assert!(propose(None, json!(steps)).is_ok());
}

#[test]
fn rejects_a_malformed_custom_id() {
    for bad in ["x-A", "x-", "x-a", "x_review"] {
        assert!(!validate::is_custom_id(bad), "{bad}");
    }
    assert!(validate::is_custom_id("x-design-note"));
}

#[test]
fn rejects_an_empty_phase() {
    let steps: Vec<_> = solo()
        .steps
        .iter()
        .filter(|s| s.phase == crate::db::models::LifecyclePhase::After)
        .map(|s| json!({"id": s.id}))
        .collect();
    let err = propose(None, json!(steps)).unwrap_err();
    assert!(err.contains("no step has phase `before`"), "{err}");
}

#[test]
fn rejects_link_on_solo_but_accepts_it_on_team() {
    let mut steps = solo_stubs();
    steps.insert(
        3,
        json!({"id": "link", "phase": "before", "rule": "Name the ticket.", "bindings": ["app"]}),
    );
    let err = propose(None, json!(steps.clone())).unwrap_err();
    assert!(err.contains("`link`"), "{err}");
    assert!(propose(Some("team"), json!(steps)).is_ok());
}

#[test]
fn rejects_params_on_a_step_that_does_not_own_them() {
    let mut steps = solo_stubs();
    steps[0] = json!({"id": "frame", "params": {"docsRequired": true}});
    let err = propose(None, json!(steps)).unwrap_err();
    assert!(err.contains("belongs to `docs`"), "{err}");
}

#[test]
fn rejects_an_empty_rule_a_long_rule_and_no_bindings() {
    let mut steps = solo_stubs();
    steps[0] = json!({"id": "frame", "rule": "  "});
    assert!(propose(None, json!(steps.clone()))
        .unwrap_err()
        .contains("empty `rule`"));
    steps[0] = json!({"id": "frame", "rule": "a".repeat(401)});
    assert!(propose(None, json!(steps.clone()))
        .unwrap_err()
        .contains("limit is 400"));
    steps[0] = json!({"id": "frame", "bindings": []});
    assert!(propose(None, json!(steps))
        .unwrap_err()
        .contains("no bindings"));
}

#[test]
fn a_new_step_must_state_phase_rule_and_bindings() {
    let mut steps = solo_stubs();
    steps.push(json!({"id": "x-demo", "label": "Demo"}));
    let err = propose(None, json!(steps)).unwrap_err();
    assert!(err.contains("phase, rule, bindings"), "{err}");
}

/// A proposal that adds a custom step, rewords gate, drops docs and moves to Team.
fn sample_proposal() -> LifecycleDoc {
    let mut steps: Vec<_> = solo_stubs()
        .into_iter()
        .filter(|s| s["id"] != "docs")
        .collect();
    let gate = steps.iter().position(|s| s["id"] == "gate").unwrap();
    steps[gate] = json!({"id": "gate", "rule": "Run the gates.", "bindings": ["hook", "ci"]});
    steps.push(json!({"id": "x-demo", "phase": "after", "label": "Demo", "rule": "Record a demo.", "bindings": ["claude_md"]}));
    propose(Some("team"), json!(steps)).expect("valid")
}

#[test]
fn diff_lists_preset_then_proposed_order_then_removals() {
    let changes = diff(&solo(), &sample_proposal());
    let got: Vec<(LifecycleChangeKind, &str)> = changes
        .iter()
        .map(|c| (c.kind, c.step_id.as_str()))
        .collect();
    assert_eq!(
        got,
        vec![
            (LifecycleChangeKind::Preset, "preset"),
            (LifecycleChangeKind::Changed, "gate"),
            (LifecycleChangeKind::Added, "x-demo"),
            (LifecycleChangeKind::Removed, "docs"),
        ]
    );
    let gate = &changes[1];
    assert_eq!(gate.before.as_ref().unwrap().rule, solo().steps[4].rule);
    assert_eq!(gate.after.as_ref().unwrap().rule, "Run the gates.");
    // Params were inherited, not dropped.
    assert_eq!(gate.after.as_ref().unwrap().params, solo().steps[4].params);
}

#[test]
fn apply_takes_only_the_ticked_changes() {
    let current = solo();
    let proposed = sample_proposal();
    let changes = diff(&current, &proposed);
    let next =
        apply_accepted(&current, &proposed, &changes, &["x-demo".to_string()]).expect("applies");
    assert_eq!(
        next.preset,
        LifecyclePreset::Solo,
        "preset change was not ticked"
    );
    let ids: Vec<&str> = next.steps.iter().map(|s| s.id.as_str()).collect();
    assert!(ids.contains(&"x-demo"));
    assert!(ids.contains(&"docs"), "unticked removal keeps the step");
    let gate = next.steps.iter().find(|s| s.id == "gate").unwrap();
    assert_eq!(
        gate.rule, current.steps[4].rule,
        "unticked change keeps the old rule"
    );
    // The kept removal sits where it was: right after `tests`.
    let tests_at = ids.iter().position(|i| *i == "tests").unwrap();
    assert_eq!(ids[tests_at + 1], "docs");
    validate_doc(&next).expect("still valid");
    assert!(
        repo_bindings_strengthened(&current, &next),
        "x-demo adds claude_md"
    );
}

#[test]
fn apply_refuses_nothing_ticked_and_unknown_ids() {
    let current = solo();
    let proposed = sample_proposal();
    let changes = diff(&current, &proposed);
    assert!(apply_accepted(&current, &proposed, &changes, &[]).is_err());
    let err = apply_accepted(&current, &proposed, &changes, &["frame".to_string()]).unwrap_err();
    assert!(err.contains("`frame` is not one of"), "{err}");
}

#[test]
fn apply_of_everything_equals_the_proposal() {
    let current = solo();
    let proposed = sample_proposal();
    let changes = diff(&current, &proposed);
    let all: Vec<String> = changes.iter().map(|c| c.step_id.clone()).collect();
    let next = apply_accepted(&current, &proposed, &changes, &all).expect("applies");
    assert_eq!(next, proposed);
}

#[test]
fn a_reworded_advisory_step_needs_no_install() {
    let current = solo();
    let mut next = solo();
    let tests = next.steps.iter_mut().find(|s| s.id == "tests").unwrap();
    tests.rule = "Test more.".into();
    assert!(!repo_bindings_strengthened(&current, &next));
    let recall = next.steps.iter_mut().find(|s| s.id == "recall").unwrap();
    recall.rule = "Read AGENTS.md first.".into();
    assert!(
        repo_bindings_strengthened(&current, &next),
        "claude_md rule changed"
    );
}

#[path = "tests_db.rs"]
mod db_tests;
