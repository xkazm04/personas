use super::super::*;

#[test]
fn test_format_for_prompt() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.push_app_focus("Code.exe", "ambient_context.rs");
    fusion.push_file_change("modify", &["ambient_context.rs".to_string()]);

    let doc = fusion.format_for_prompt("p1");
    assert!(doc.is_some());
    let doc = doc.unwrap();
    assert!(doc.contains("Ambient Desktop Context"));
    assert!(doc.contains("Code.exe"));
}

#[test]
fn test_format_empty_when_disabled() {
    let mut fusion = AmbientContextFusion::new_for_tests();
    fusion.set_enabled(false);
    assert!(fusion.format_for_prompt("p1").is_none());
}

// ── Persona-execution prefix helpers (Phase 3 c) ──────────────────────

fn make_persona(system_prompt: &str) -> personas_db::models::Persona {
    // Construct a minimal Persona for prefix-injection tests. The
    // prepend helper only reads/writes `system_prompt`; the rest
    // are filled with sensible defaults so the struct compiles.
    personas_db::models::Persona {
        lifecycle: "active".to_string(),
        core_profile: None,
        id: "p_test".into(),
        project_id: "proj_test".into(),
        name: "Test".into(),
        description: None,
        system_prompt: system_prompt.to_string(),
        structured_prompt: None,
        icon: None,
        color: None,
        enabled: true,
        sensitive: false,
        headless: false,
        starred: false,
        max_concurrent: 1,
        timeout_ms: 60_000,
        notification_channels: None,
        last_design_result: None,
        last_test_report: None,
        model_profile: None,
        max_budget_usd: None,
        max_turns: None,
        design_context: None,
        home_team_id: None,
        source_review_id: None,
        trust_level: personas_db::models::PersonaTrustLevel::Verified,
        trust_origin: personas_db::models::PersonaTrustOrigin::default(),
        trust_verified_at: None,
        trust_score: 1.0,
        parameters: None,
        gateway_exposure: Default::default(),
        template_category: None,
        cli_awareness_enabled: false,
        setup_status: "ready".to_string(),
        setup_detail: None,
        disabled_dims_json: None,
        created_at: "2026-05-09T00:00:00Z".into(),
        updated_at: "2026-05-09T00:00:00Z".into(),
    }
}

#[test]
fn prepend_ambient_to_empty_system_prompt() {
    let mut p = make_persona("");
    prepend_ambient_to_system_prompt(&mut p, "## Ambient\nactivity here");
    assert_eq!(p.system_prompt, "## Ambient\nactivity here");
}

#[test]
fn prepend_ambient_to_existing_system_prompt() {
    let mut p = make_persona("You are a helpful assistant.");
    prepend_ambient_to_system_prompt(&mut p, "## Ambient\nactivity here");
    // Ambient lands first, then a blank line, then the original prompt.
    assert!(p.system_prompt.starts_with("## Ambient\nactivity here"));
    assert!(p.system_prompt.ends_with("You are a helpful assistant."));
    assert!(p.system_prompt.contains("\n\nYou are a helpful assistant."));
}

#[test]
fn prepend_ambient_noop_on_empty_block() {
    let mut p = make_persona("Hello");
    prepend_ambient_to_system_prompt(&mut p, "");
    assert_eq!(p.system_prompt, "Hello");
    prepend_ambient_to_system_prompt(&mut p, "   \n\t  ");
    assert_eq!(p.system_prompt, "Hello");
}

#[tokio::test]
async fn format_ambient_for_persona_returns_none_when_empty() {
    let handle = create_ambient_context();
    // Empty rolling window → no markdown block.
    let out = format_ambient_for_persona(&handle, "p_test").await;
    assert!(out.is_none());
}

#[tokio::test]
async fn format_ambient_for_persona_returns_some_when_signals_present() {
    let handle = create_ambient_context();
    {
        let mut g = handle.lock().await;
        *g = AmbientContextFusion::new_for_tests();
        g.push_clipboard_with_content("text", "deploy plan for staging");
    }
    let out = format_ambient_for_persona(&handle, "p_test").await;
    assert!(out.is_some());
    let md = out.unwrap();
    assert!(md.contains("Ambient Desktop Context"));
    assert!(md.contains("clipboard"));
}

#[tokio::test]
async fn format_then_prepend_round_trip() {
    // End-to-end: capture a signal, render for persona, inject into
    // a persona's system prompt. Demonstrates the wiring shape that
    // future runtime callers (engine/mod.rs) will use.
    let handle = create_ambient_context();
    {
        let mut g = handle.lock().await;
        *g = AmbientContextFusion::new_for_tests();
        g.push_app_focus("Code.exe", "main.rs - personas");
    }
    let md = format_ambient_for_persona(&handle, "p_test")
        .await
        .expect("snapshot should render");
    let mut persona = make_persona("Be terse.");
    prepend_ambient_to_system_prompt(&mut persona, &md);
    assert!(persona.system_prompt.contains("Ambient Desktop Context"));
    assert!(persona.system_prompt.contains("Be terse."));
    // Original content preserved at the end.
    assert!(persona.system_prompt.ends_with("Be terse."));
}
