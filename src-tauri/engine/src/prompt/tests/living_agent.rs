//! Living-agent prompt sections (spark `living-agent-core`, WP2): the
//! `## Core` / `## Responsibilities` / `## Recent Episodes` render contract —
//! section ORDER, the identity skip rule, the parse-fail fallback, the
//! episode fence, and the fingerprints that invalidate warm state.

use super::super::*;
use super::{design_context_with_three_capabilities, test_persona, trusted_structure_only};
use personas_db::models::{
    EpisodeExcerpt, PersonaCore, PersonaResponsibility, ResponsibilityOutcome,
};

fn core_json(risk: f64, identity: Option<&str>) -> String {
    let mut v = serde_json::json!({
        "motivation": "The docs decay unless someone cares.",
        "stance": "Stale docs are worse than no docs.",
        "northStarCommitment": "Win by being the product whose docs never lie.",
        "riskTolerance": risk,
        "speedVsQuality": 0.2,
        "conflictStyle": "analyst",
        "deference": 0.5,
        "principles": ["Cite the line, not the vibe."],
        "constraints": ["Never edit generated files by hand."],
        "decisionPrinciples": ["Prefer the reader over the author."]
    });
    if let Some(id) = identity {
        v["identity"] = serde_json::Value::String(id.to_string());
        v["voice"] = serde_json::Value::String("Dry, precise, allergic to hype.".to_string());
    }
    v.to_string()
}

fn charter(id: &str, title: &str) -> PersonaResponsibility {
    PersonaResponsibility {
        id: id.into(),
        persona_id: "test-id".into(),
        title: title.into(),
        domain: "docs".into(),
        outcomes: vec![ResponsibilityOutcome {
            id: "o1".into(),
            statement: "Docs match shipped behavior".into(),
            success_criteria: vec!["zero stale pages".into()],
        }],
        scope_rung: 2,
        refusal_classes: vec!["production deploys".into()],
        owner: String::new(),
        budget_monthly_usd: Some(12.5),
        status: "active".into(),
        source: "operator".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        ..Default::default()
    }
}

fn episode(n: usize) -> EpisodeExcerpt {
    EpisodeExcerpt {
        id: format!("ep_{n}"),
        role: "assistant".into(),
        source: "execution".into(),
        body_excerpt: format!("episode body {n}"),
        created_at: format!("2026-01-01T00:00:0{n}Z"),
    }
}

fn structured_prompt_json() -> String {
    serde_json::json!({
        "identity": "You are the structured identity.",
        "instructions": "Follow the structured instructions."
    })
    .to_string()
}

fn assemble_living(
    persona: &personas_db::models::Persona,
    responsibilities: Option<&[PersonaResponsibility]>,
    episodes: Option<&[EpisodeExcerpt]>,
) -> String {
    assemble_prompt_with_skills(
        persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
        None,
        responsibilities,
        episodes,
    )
}

/// The binding placement contract: `## Core` renders before the `## Identity`
/// branch, `## Responsibilities` immediately after `## Core` (so also before
/// `## Identity`), and `## Recent Episodes (oldest first)` immediately after
/// `## Active Capabilities`.
#[test]
fn living_sections_render_in_the_contracted_order() {
    let mut persona = test_persona();
    // Core WITHOUT identity so the `## Identity` branch still renders and the
    // Core-vs-Identity order is observable.
    persona.core_profile = Some(core_json(0.2, None));
    persona.structured_prompt = Some(structured_prompt_json());
    persona.design_context = Some(design_context_with_three_capabilities());

    let charters = [charter("resp_1", "Keep the docs honest")];
    let episodes = [episode(1), episode(2)];
    let prompt = assemble_living(&persona, Some(&charters), Some(&episodes));

    let idx = |needle: &str| {
        prompt
            .find(needle)
            .unwrap_or_else(|| panic!("prompt is missing section {needle:?}"))
    };
    let core = idx("## Core");
    let resp = idx("## Responsibilities");
    let identity = idx("## Identity");
    let caps = idx("## Active Capabilities");
    let eps = idx("## Recent Episodes (oldest first)");

    assert!(core < resp, "## Core must precede ## Responsibilities");
    assert!(
        resp < identity,
        "## Responsibilities sits before ## Identity"
    );
    assert!(caps < eps, "episodes come after ## Active Capabilities");
    assert!(
        eps < idx("## Protocol Tools"),
        "episodes belong to the persona block, not the protocol tail"
    );

    // Responsibilities content: outcome, criteria, rung 2 line, refusal, budget.
    assert!(prompt.contains("### Keep the docs honest (docs)"));
    assert!(prompt.contains("- Docs match shipped behavior"));
    assert!(prompt.contains("success looks like: zero stale pages"));
    assert!(prompt
        .contains("open branches and proposals — never merge, deploy, or change your own gates"));
    assert!(prompt
        .contains("You refuse and escalate to the operator when work touches: production deploys"));
    assert!(prompt.contains("Budget: stay within $12.50 per month"));
}

/// Skip rule: a Core that carries identity prose suppresses the structured
/// `## Identity` section — instructions still render unchanged.
#[test]
fn core_identity_suppresses_structured_identity_but_not_instructions() {
    let mut persona = test_persona();
    persona.core_profile = Some(core_json(0.2, Some("You are Marge, the docs steward.")));
    persona.structured_prompt = Some(structured_prompt_json());

    let prompt = assemble_living(&persona, None, None);

    assert!(prompt.contains("## Core"));
    assert!(prompt.contains("You are Marge, the docs steward."));
    assert!(
        !prompt.contains("## Identity"),
        "structured identity skipped"
    );
    assert!(!prompt.contains("You are the structured identity."));
    assert!(
        prompt.contains("## Instructions")
            && prompt.contains("Follow the structured instructions."),
        "instructions render unchanged"
    );
}

/// Skip rule, fallback half: with NO structured prompt, the system_prompt
/// `## Identity` fallback applies only when the Core has no identity.
#[test]
fn system_prompt_identity_fallback_respects_core_identity() {
    // No structured prompt, no core identity → fallback renders (pre-living path).
    let mut plain = test_persona();
    plain.core_profile = Some(core_json(0.2, None));
    let prompt = assemble_living(&plain, None, None);
    assert!(prompt.contains("## Identity"), "fallback still applies");

    // No structured prompt, core identity present → fallback suppressed.
    let mut cored = test_persona();
    cored.core_profile = Some(core_json(0.2, Some("You are Marge.")));
    let prompt = assemble_living(&cored, None, None);
    assert!(!prompt.contains("## Identity"));
    assert!(prompt.contains("You are Marge."));
}

/// Parse-fail fallback: corrupt core_profile JSON skips `## Core` and leaves
/// the pre-living identity path fully intact.
#[test]
fn corrupt_core_profile_skips_core_and_keeps_identity() {
    let mut persona = test_persona();
    persona.core_profile = Some("{not valid json".into());
    let prompt = assemble_living(&persona, None, None);
    assert!(!prompt.contains("## Core"));
    assert!(
        prompt.contains("## Identity"),
        "identity fallback must survive a corrupt core"
    );
}

/// Dials render as calibrated prose bands, never as raw numbers.
#[test]
fn dials_render_as_directive_bands_not_numbers() {
    let averse: PersonaCore = serde_json::from_str(&core_json(0.2, None)).unwrap();
    let seeking: PersonaCore = serde_json::from_str(&core_json(0.9, None)).unwrap();

    let low = render_core(&averse);
    let high = render_core(&seeking);
    assert!(low.contains("You are risk-averse"));
    assert!(high.contains("You are risk-seeking"));
    assert!(!low.contains("0.2"), "no raw dial values in the prompt");
    // Shared dials: quality band + analyst conflict style + bullet lists.
    assert!(low.contains("You optimize for quality over speed"));
    assert!(low.contains("In conflict you are an analyst"));
    assert!(low.contains("**Principles you work by:**"));
    assert!(low.contains("- Cite the line, not the vibe."));
    assert!(low.contains("**Hard constraints — never cross these:**"));
    assert!(low.contains("**When principles conflict, decide by:**"));
}

/// Responsibilities cap: at most MAX_RESPONSIBILITIES_RENDERED render fully,
/// the rest collapse to a `+N more` line.
#[test]
fn responsibilities_cap_at_three_with_more_line() {
    let charters: Vec<PersonaResponsibility> = (0..5)
        .map(|i| charter(&format!("resp_{i}"), &format!("Charter {i}")))
        .collect();
    let section = render_responsibilities(&charters);
    assert!(section.contains("### Charter 0 (docs)"));
    assert!(section.contains("### Charter 2 (docs)"));
    assert!(!section.contains("### Charter 3 (docs)"));
    assert!(section.contains("+2 more responsibilities (not rendered here)"));
    assert_eq!(MAX_RESPONSIBILITIES_RENDERED, 3);
}

/// Episodes are derived-untrusted: the whole body sits inside the runtime
/// nonce fence (stripping every `<untrusted_*>` block removes the episode
/// text but keeps the section heading), rows cap at 8, and the given
/// (oldest-first) order is preserved.
#[test]
fn episodes_are_fenced_capped_and_ordered() {
    let mut persona = test_persona();
    persona.core_profile = Some(core_json(0.2, None));
    let episodes: Vec<EpisodeExcerpt> = (0..10).map(episode).collect();
    let prompt = assemble_living(&persona, None, Some(&episodes));

    // Fenced: the body vanishes with the untrusted blocks; the heading stays.
    let trusted = trusted_structure_only(&prompt);
    assert!(trusted.contains("## Recent Episodes (oldest first)"));
    assert!(!trusted.contains("episode body 0"), "body must be fenced");
    assert!(
        prompt.contains("episode body 0"),
        "body must still be present"
    );

    // Cap 8: rows 8 and 9 do not render.
    assert!(prompt.contains("episode body 7"));
    assert!(!prompt.contains("episode body 8"));

    // Order preserved as given (caller passes oldest-first).
    let first = prompt.find("episode body 0").unwrap();
    let last = prompt.find("episode body 7").unwrap();
    assert!(first < last);
    // Row shape: "### {role} — {createdAt}".
    assert!(prompt.contains("### assistant — 2026-01-01T00:00:00Z"));

    // Absent input → no section at all.
    let bare = assemble_living(&persona, None, None);
    assert!(!bare.contains("## Recent Episodes"));
}

/// A dial edit MUST invalidate warm sessions: `core_fingerprint` (the input
/// the session-pool config hash combines with the capabilities fingerprint)
/// changes when a single dial moves, and is empty for personas without a
/// Core so their hash input stays exactly what it is today.
#[test]
fn core_fingerprint_reacts_to_dial_edits() {
    assert_eq!(core_fingerprint(None), "");
    assert_eq!(core_fingerprint(Some("   ")), "");

    let calm = core_json(0.2, None);
    let bold = core_json(0.9, None);
    let fp_calm = core_fingerprint(Some(&calm));
    let fp_bold = core_fingerprint(Some(&bold));
    assert!(fp_calm.starts_with("core:"));
    assert_ne!(fp_calm, fp_bold, "a dial edit must change the fingerprint");
    assert_eq!(
        fp_calm,
        core_fingerprint(Some(&calm)),
        "stable for identical content"
    );
}
