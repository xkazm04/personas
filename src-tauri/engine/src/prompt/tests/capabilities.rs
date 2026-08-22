use super::super::*;
use super::{design_context_with_three_capabilities, test_persona};

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

#[test]
fn c1_render_active_capabilities_filters_disabled() {
    let dc = design_context_with_three_capabilities();
    let out = render_active_capabilities(Some(&dc));
    assert!(out.contains("## Active Capabilities"));
    assert!(out.contains("Performance Analysis"));
    assert!(out.contains("Weekly Gem Finder"));
    assert!(
        !out.contains("Gov Investment Tracker"),
        "disabled capability must not appear in the Active Capabilities section"
    );
}

#[test]
fn c1_render_active_capabilities_uses_summary_then_description() {
    let dc = design_context_with_three_capabilities();
    let out = render_active_capabilities(Some(&dc));
    // Performance Analysis has both; capability_summary wins.
    assert!(out.contains("Ticker performance with price + news + technicals."));
    assert!(!out.contains("Deep-dive on a single ticker."));
}

#[test]
fn c1_render_active_capabilities_empty_when_all_disabled() {
    let dc = serde_json::json!({
        "use_cases": [
            { "id": "a", "title": "A", "description": "x", "enabled": false }
        ]
    })
    .to_string();
    assert_eq!(render_active_capabilities(Some(&dc)), "");
}

#[test]
fn c1_render_active_capabilities_empty_on_missing_context() {
    assert_eq!(render_active_capabilities(None), "");
    assert_eq!(render_active_capabilities(Some("")), "");
    assert_eq!(render_active_capabilities(Some("not json")), "");
}

#[test]
fn c1_render_active_capabilities_treats_missing_enabled_as_active() {
    // Greenfield personas may have no `enabled` key — they count as active.
    let dc = serde_json::json!({
        "use_cases": [
            { "id": "a", "title": "Alpha", "description": "d" }
        ]
    })
    .to_string();
    let out = render_active_capabilities(Some(&dc));
    assert!(out.contains("Alpha"));
}

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

#[test]
fn c1_assemble_prompt_injects_capabilities_section() {
    let mut persona = test_persona();
    persona.design_context = Some(design_context_with_three_capabilities());

    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("## Active Capabilities"));
    assert!(prompt.contains("Performance Analysis"));
    assert!(prompt.contains("Weekly Gem Finder"));
    assert!(
        !prompt.contains("Gov Investment Tracker"),
        "disabled capability must not leak into the runtime prompt"
    );
    // Trigger hints render too.
    assert!(prompt.contains("Mondays 8am"));
}

#[test]
fn c1_current_focus_section_rendered_when_use_case_in_input() {
    let mut persona = test_persona();
    persona.design_context = Some(design_context_with_three_capabilities());

    let input = serde_json::json!({
        "_use_case": {
            "title": "Weekly Gem Finder",
            "capability_summary": "Weekly sector-filtered screen.",
            "tool_hints": ["news_api", "screener"],
            "notification_channels": [{ "type": "email" }]
        },
        "sector": "semiconductors"
    });

    let prompt = assemble_prompt(
        &persona,
        &[],
        Some(&input),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("## Current Focus"));
    assert!(prompt.contains("Weekly Gem Finder"));
    assert!(prompt.contains("Preferred tools for this capability:"));
    assert!(prompt.contains("news_api"));
    assert!(prompt.contains("Deliver outputs via:"));
    assert!(prompt.contains("email"));
}
