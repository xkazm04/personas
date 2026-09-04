use super::super::*;
use personas_db::models::{Persona, PersonaToolDefinition};

pub(crate) fn test_persona() -> Persona {
    Persona {
        lifecycle: "active".to_string(),
        id: "test-id".into(),
        project_id: "proj-1".into(),
        name: "Test Agent".into(),
        description: Some("A test agent".into()),
        system_prompt: "You are a helpful test agent.".into(),
        structured_prompt: None,
        icon: None,
        color: None,
        enabled: true,
        sensitive: false,
        headless: false,
        starred: false,
        max_concurrent: 2,
        timeout_ms: 300000,
        notification_channels: None,
        last_design_result: None,
        last_test_report: None,
        model_profile: None,
        max_budget_usd: None,
        max_turns: None,
        design_context: None,
        home_team_id: None,
        source_review_id: None,
        trust_level: PersonaTrustLevel::Manual,
        trust_origin: PersonaTrustOrigin::User,
        trust_verified_at: None,
        trust_score: 0.0,
        parameters: None,
        gateway_exposure: personas_db::models::PersonaGatewayExposure::LocalOnly,
        template_category: None,
        cli_awareness_enabled: false,
        setup_status: "ready".to_string(),
        setup_detail: None,
        disabled_dims_json: None,
        core_profile: None,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    }
}

pub(crate) fn test_tool() -> PersonaToolDefinition {
    PersonaToolDefinition {
        id: "tool-1".into(),
        name: "file_reader".into(),
        category: "filesystem".into(),
        description: "Reads files from disk".into(),
        script_path: "tools/file_reader.ts".into(),
        input_schema: Some(r#"{"path": "string"}"#.into()),
        output_schema: None,
        requires_credential_type: None,
        implementation_guide: None,
        is_builtin: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    }
}

// ── Fix-loop re-entry: attempt 2 must not be worse informed ──────────
//
// The corrective re-run used to carry ONLY `_fix_attempt` +
// `_fix_instruction`, so the prompt it assembled had no resolved
// variables, no `## Current Focus`, no capability generation policy and
// no time filter — while being told to satisfy every check. These tests
// pin the parity: whatever attempt 1 knew, attempt 2 knows.

/// The legacy use case the fix-loop charter was minted from.
/// `review_policy.mode = "always"` is the exact line whose absence silently
/// skipped human approvals in production; post-rebase it reaches the prompt
/// through the focused charter's design-context BRIDGE
/// (`spec.migratedFromUseCaseId` → `render_capability_policy_lines`).
pub(crate) fn fix_loop_use_case() -> serde_json::Value {
    serde_json::json!({
        "id": "uc-triage",
        "title": "Triage inbound incidents",
        "capability_summary": "Classify the incident and propose a remediation.",
        "tool_hints": ["github", "slack"],
        "review_policy": { "mode": "always" },
    })
}

/// The focused charter (WP2): `_responsibility` carries its ID; the charter
/// itself travels through the assembler's `responsibilities` input.
pub(crate) fn fix_loop_charter() -> personas_db::models::PersonaResponsibility {
    personas_db::models::PersonaResponsibility {
        id: "resp-triage".into(),
        persona_id: "test-id".into(),
        title: "Triage inbound incidents".into(),
        domain: "support".into(),
        procedure: "Classify the incident and propose a remediation.".into(),
        status: "active".into(),
        source: "migration".into(),
        spec: personas_db::models::ResponsibilitySpec {
            migrated_from_use_case_id: Some("uc-triage".into()),
            ..Default::default()
        },
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        ..Default::default()
    }
}

pub(crate) fn fix_loop_input() -> serde_json::Value {
    serde_json::json!({
        "ticket": "PROD-4171 payment webhook retries",
        "_responsibility": "resp-triage",
        "_time_filter": {
            "description": "Only look at the last day of events.",
            "field": "created_at",
            "default_window": "24h",
        },
    })
}

pub(crate) fn fix_loop_persona() -> Persona {
    let mut p = test_persona();
    p.system_prompt = "Triage the incident described in {{ticket}}.".into();
    p.design_context = Some(serde_json::json!({ "use_cases": [fix_loop_use_case()] }).to_string());
    p
}

pub(crate) fn assemble_for(persona: &Persona, input: &serde_json::Value) -> String {
    assemble_prompt(
        persona,
        &[],
        Some(input),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    )
}

/// Like [`assemble_for`], with the focused charter on board — the shape the
/// runner main path assembles for a charter-dispatched run.
pub(crate) fn assemble_focused(
    persona: &Persona,
    input: &serde_json::Value,
    charters: &[personas_db::models::PersonaResponsibility],
) -> String {
    assemble_prompt_with_skills(
        persona,
        &[],
        Some(input),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
        None,
        Some(charters),
        None,
    )
}

// ── The correction's two halves are carried differently ──────────────
//
// `## Correction Required` has existed since the F7 commit, and it
// `push_str`'d the joined fix string RAW into the trusted prompt — at the
// very top, above the runtime canary, with no boundary and no
// sanitisation. Because `output_assertions::eval_json_path` builds its
// explanation as "Path '{}' is '{}', expected '{}'" with the value taken
// from the MODEL'S OWN OUTPUT, that was a direct splice of model-authored
// (and so potentially attacker-influenced) text into trusted structure.
//
// These tests pin BOTH halves — the correction is reachable as
// instruction AND its evidence is not trusted. Proving one without the
// other is exactly how this defect was created.

/// Everything the model is asked to treat as INSTRUCTION: the assembled
/// prompt with every `<untrusted_*>…</untrusted_*>` block removed. What
/// survives this strip is trusted prompt structure by definition.
pub(crate) fn trusted_structure_only(prompt: &str) -> String {
    regex::Regex::new(r"(?s)<untrusted_[^>]+>.*?</untrusted_[^>]+>")
        .unwrap()
        .replace_all(prompt, "[UNTRUSTED BLOCK]")
        .to_string()
}

// ─── Phase C1 — capability-aware runtime tests ───────────────────────
//
// See docs/concepts/persona-capabilities/09-implementation-plan.md §C1.
// Ensures the runtime reads design_context.useCases, filters by
// `enabled != Some(false)`, and the session hash fingerprint reacts to
// toggles so warm-session reuse stays correct.

pub(crate) fn design_context_with_three_capabilities() -> String {
    serde_json::json!({
        "use_cases": [
            {
                "id": "uc_perf",
                "title": "Performance Analysis",
                "description": "Deep-dive on a single ticker.",
                "capability_summary": "Ticker performance with price + news + technicals.",
                "enabled": true,
                "suggested_trigger": { "type": "manual", "description": "User provides a symbol" },
                "tool_hints": ["market_data_api", "news_api"]
            },
            {
                "id": "uc_gem",
                "title": "Weekly Gem Finder",
                "description": "Scan news for underappreciated stocks.",
                "capability_summary": "Weekly sector-filtered screen.",
                "enabled": true,
                "suggested_trigger": { "type": "schedule", "description": "Mondays 8am" }
            },
            {
                "id": "uc_gov",
                "title": "Gov Investment Tracker",
                "description": "Alerts on government filings.",
                "enabled": false,
                "suggested_trigger": { "type": "polling", "description": "Hourly" }
            }
        ]
    })
    .to_string()
}
