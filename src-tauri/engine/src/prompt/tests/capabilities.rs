use super::super::*;
use super::design_context_with_three_capabilities;

#[test]
fn test_parse_model_profile_none() {
    assert!(parse_model_profile(None).is_none());
    assert!(parse_model_profile(Some("")).is_none());
    assert!(parse_model_profile(Some("  ")).is_none());
}

#[test]
fn test_parse_model_profile_valid() {
    let json = r#"{"model": "gpt-4", "provider": "openai", "base_url": "https://api.example.com", "auth_token": "sk-123"}"#;
    let profile = parse_model_profile(Some(json)).unwrap();

    assert_eq!(profile.model, Some("gpt-4".into()));
    assert_eq!(profile.provider, Some("openai".into()));
    assert_eq!(profile.base_url, Some("https://api.example.com".into()));
    assert_eq!(profile.auth_token, Some("sk-123".into()));
}

#[test]
fn test_parse_model_profile_invalid_json() {
    assert!(parse_model_profile(Some("{invalid json}")).is_none());
    assert!(parse_model_profile(Some("not json at all")).is_none());
    assert!(parse_model_profile(Some("[1,2,3]")).is_none());
}

// The `## Active Capabilities` render tests left with the renderer (WP2 —
// the `## Responsibilities` roster in `tests/living_agent.rs` is the
// capability surface now). The fingerprint stays: use-case rows remain the
// toggle surface until the WP4 adoption cutover.

#[test]
fn c1_fingerprint_changes_when_capability_disabled() {
    let dc_all = design_context_with_three_capabilities();
    let fp_all = active_capabilities_fingerprint(Some(&dc_all));

    let dc_one_disabled = serde_json::json!({
        "use_cases": [
            { "id": "uc_perf", "title": "Performance Analysis", "description": "", "enabled": true },
            { "id": "uc_gem", "title": "Weekly Gem Finder", "description": "", "enabled": false }
        ]
    })
    .to_string();
    let fp_disabled = active_capabilities_fingerprint(Some(&dc_one_disabled));

    assert_ne!(
        fp_all, fp_disabled,
        "session hash must invalidate on toggle"
    );
    assert!(fp_disabled.contains("uc_perf"));
    assert!(!fp_disabled.contains("uc_gem"));
}

#[test]
fn c1_fingerprint_is_stable_under_reordering() {
    let a = serde_json::json!({
        "use_cases": [
            { "id": "b", "title": "B" },
            { "id": "a", "title": "A" }
        ]
    })
    .to_string();
    let b = serde_json::json!({
        "use_cases": [
            { "id": "a", "title": "A" },
            { "id": "b", "title": "B" }
        ]
    })
    .to_string();
    assert_eq!(
        active_capabilities_fingerprint(Some(&a)),
        active_capabilities_fingerprint(Some(&b))
    );
}

// `## Current Focus` is exercised in `tests/living_agent.rs`
// (`focused_run_renders_full_charter_detail`): it now resolves a CHARTER by
// id from `input_data._responsibility` instead of rendering a payload-
// authored `_use_case` blob.
