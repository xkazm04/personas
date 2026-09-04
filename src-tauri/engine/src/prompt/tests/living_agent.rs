//! Living-agent prompt sections (spark `agent-manifest-rebase`, WP2): the
//! `## Manifest` / `## Responsibilities` / `## Current Focus` /
//! `## Recent Episodes` render contract — section ORDER, the
//! manifest-replaces-structured-prompt rule, the legacy-core fallback, the
//! focused-charter resolution, the episode fence, and the fingerprints that
//! invalidate warm state.

use super::super::*;
use super::{test_persona, trusted_structure_only};
use personas_db::models::{
    EpisodeExcerpt, PersonaCore, PersonaResponsibility, ResponsibilityErrorPolicy,
    ResponsibilityOutcome, ResponsibilitySpec,
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

fn manifest_markdown() -> String {
    "---\ntype: manifest\nupdated: 2026-09-01T00:00:00Z\n---\n\n\
     # Mandate\n\nMarge — keeps the docs honest\n\n\
     # Boundaries\n\n- no external sends\n\n\
     # Operation defaults\n\n- Notification channels: slack\n\n\
     # My work\n\n## What I own\n- the changelog (ep_1)\n"
        .to_string()
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
        procedure: "Diff the changelog against merged PRs, then fix stale pages.".into(),
        connectors: vec!["github".into()],
        spec: ResponsibilitySpec {
            notification_channels: Some(vec!["email".into()]),
            error_policy: Some(ResponsibilityErrorPolicy {
                incident: Some(true),
                lab: None,
                escalate_after: Some(3),
            }),
            memory_policy: Some(serde_json::json!({ "enabled": false })),
            ..Default::default()
        },
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
    assemble_living_with_input(persona, None, responsibilities, episodes)
}

fn assemble_living_with_input(
    persona: &personas_db::models::Persona,
    input_data: Option<&serde_json::Value>,
    responsibilities: Option<&[PersonaResponsibility]>,
    episodes: Option<&[EpisodeExcerpt]>,
) -> String {
    assemble_prompt_with_skills(
        persona,
        &[],
        input_data,
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

/// The binding placement contract: `## Manifest` renders before the
/// `## Identity` branch, `## Responsibilities` immediately after
/// `## Manifest` (so also before `## Identity`), and
/// `## Recent Episodes (oldest first)` after the persona block.
#[test]
fn living_sections_render_in_the_contracted_order() {
    let mut persona = test_persona();
    // Legacy core WITHOUT identity so the `## Identity` branch still renders
    // and the Manifest-vs-Identity order is observable.
    persona.core_profile = Some(core_json(0.2, None));
    persona.structured_prompt = Some(structured_prompt_json());

    let charters = [charter("resp_1", "Keep the docs honest")];
    let episodes = [episode(1), episode(2)];
    let prompt = assemble_living(&persona, Some(&charters), Some(&episodes));

    let idx = |needle: &str| {
        prompt
            .find(needle)
            .unwrap_or_else(|| panic!("prompt is missing section {needle:?}"))
    };
    let manifest = idx("## Manifest");
    let resp = idx("## Responsibilities");
    let identity = idx("## Identity");
    let eps = idx("## Recent Episodes (oldest first)");

    assert!(
        manifest < resp,
        "## Manifest must precede ## Responsibilities"
    );
    assert!(
        resp < identity,
        "## Responsibilities sits before ## Identity"
    );
    assert!(identity < eps, "episodes come after the persona block");
    assert!(
        eps < idx("## Protocol Tools"),
        "episodes belong to the persona block, not the protocol tail"
    );

    // Roster content: compact per-charter block — title, domain, first
    // outcome, scope line, refusal one-liner. Full detail (criteria, budget,
    // procedure) is Current Focus material, not roster material.
    assert!(prompt.contains("- **Keep the docs honest** (docs) — Docs match shipped behavior"));
    assert!(prompt
        .contains("open branches and proposals — never merge, deploy, or change your own gates"));
    assert!(prompt
        .contains("You refuse and escalate to the operator when work touches: production deploys"));
    assert!(!prompt.contains("success looks like"), "roster is compact");
    assert!(!prompt.contains("Budget: stay within"), "roster is compact");
}

/// A markdown manifest mirror renders VERBATIM (frontmatter stripped) under
/// `## Manifest` — and REPLACES the structured_prompt sections entirely.
#[test]
fn markdown_manifest_renders_verbatim_and_replaces_structured_prompt() {
    let mut persona = test_persona();
    persona.core_profile = Some(manifest_markdown());
    persona.structured_prompt = Some(structured_prompt_json());

    let prompt = assemble_living(&persona, None, None);

    assert!(prompt.contains("## Manifest"));
    assert!(prompt.contains("# Mandate"), "law headings ride verbatim");
    assert!(prompt.contains("Marge — keeps the docs honest"));
    assert!(prompt.contains("- no external sends"));
    assert!(
        prompt.contains("- the changelog (ep_1)"),
        "self-model rides"
    );
    assert!(
        !prompt.contains("type: manifest"),
        "frontmatter is disk bookkeeping, not prompt content"
    );

    // The manifest + charters replace the structured sections.
    assert!(!prompt.contains("## Identity"));
    assert!(!prompt.contains("You are the structured identity."));
    assert!(!prompt.contains("## Instructions"));
    assert!(!prompt.contains("Follow the structured instructions."));
    assert!(
        !prompt.contains("You are a helpful test agent."),
        "system_prompt identity fallback is suppressed too"
    );
}

/// Legacy skip rule, unchanged: a JSON Core that carries identity prose
/// suppresses the structured `## Identity` section — instructions still
/// render for legacy personas (only a markdown manifest replaces them).
#[test]
fn legacy_core_identity_suppresses_structured_identity_but_not_instructions() {
    let mut persona = test_persona();
    persona.core_profile = Some(core_json(0.2, Some("You are Marge, the docs steward.")));
    persona.structured_prompt = Some(structured_prompt_json());

    let prompt = assemble_living(&persona, None, None);

    assert!(prompt.contains("## Manifest"));
    assert!(prompt.contains("You are Marge, the docs steward."));
    assert!(
        !prompt.contains("## Identity"),
        "structured identity skipped"
    );
    assert!(!prompt.contains("You are the structured identity."));
    assert!(
        prompt.contains("## Instructions")
            && prompt.contains("Follow the structured instructions."),
        "instructions render unchanged for a legacy persona"
    );
}

/// Skip rule, fallback half: with NO structured prompt, the system_prompt
/// `## Identity` fallback applies only when the legacy Core has no identity.
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

/// Parse-fail fallback: corrupt JSON-shaped core_profile skips `## Manifest`
/// and leaves the pre-living identity path fully intact.
#[test]
fn corrupt_core_profile_skips_manifest_and_keeps_identity() {
    let mut persona = test_persona();
    persona.core_profile = Some("{not valid json".into());
    let prompt = assemble_living(&persona, None, None);
    assert!(!prompt.contains("## Manifest"));
    assert!(
        prompt.contains("## Identity"),
        "identity fallback must survive a corrupt core"
    );
}

/// The legacy Core renders its PROSE only — the dial bands are gone with the
/// rebase, and raw dial numbers never rendered in the first place.
#[test]
fn legacy_core_renders_prose_without_dial_bands() {
    let core: PersonaCore = serde_json::from_str(&core_json(0.2, None)).unwrap();
    let out = render_legacy_core_prose(&core);

    assert!(out.contains("**Why you care**: The docs decay unless someone cares."));
    assert!(out.contains("**Your stance**: Stale docs are worse than no docs."));
    assert!(out.contains("**Principles you work by:**"));
    assert!(out.contains("- Cite the line, not the vibe."));
    assert!(out.contains("**Hard constraints — never cross these:**"));
    assert!(out.contains("**When principles conflict, decide by:**"));

    assert!(!out.contains("risk-averse"), "dial bands are retired");
    assert!(!out.contains("optimize for quality"), "dial bands retired");
    assert!(!out.contains("In conflict you are"), "dial bands retired");
    assert!(!out.contains("0.2"), "no raw dial values in the prompt");
}

/// The roster renders EVERY active charter — no cap, no `+N more` collapse —
/// and skips non-active ones (the assembler may be handed a suspended charter
/// so a simulation's focused render can resolve it).
#[test]
fn roster_renders_all_active_charters_and_skips_suspended() {
    let mut charters: Vec<PersonaResponsibility> = (0..5)
        .map(|i| charter(&format!("resp_{i}"), &format!("Charter {i}")))
        .collect();
    charters.push(PersonaResponsibility {
        status: "suspended".into(),
        ..charter("resp_susp", "Paused charter")
    });

    let section = render_responsibilities(&charters);
    for i in 0..5 {
        assert!(
            section.contains(&format!("- **Charter {i}** (docs)")),
            "charter {i} missing from the uncapped roster"
        );
    }
    assert!(!section.contains("more responsibilit"), "no +N collapse");
    assert!(!section.contains("Paused charter"), "suspended skipped");
}

/// Focused run: `input_data._responsibility` = a charter id resolves against
/// the passed slice and renders the FULL charter detail under
/// `## Current Focus` — procedure, outcomes, connector allowlist, spec
/// policies. An id the assembler was not given renders nothing (warn only).
#[test]
fn focused_run_renders_full_charter_detail() {
    let persona = test_persona();
    let charters = [
        charter("resp_1", "Keep the docs honest"),
        charter("resp_2", "Other charter"),
    ];
    let input = serde_json::json!({ "_responsibility": "resp_1", "sector": "docs" });

    let prompt = assemble_living_with_input(&persona, Some(&input), Some(&charters), None);

    assert!(prompt.contains("## Current Focus"));
    assert!(prompt
        .contains("This run is dispatched for your charter: **Keep the docs honest** (docs)."));
    assert!(prompt.contains("Diff the changelog against merged PRs"));
    assert!(prompt.contains("- Docs match shipped behavior"));
    assert!(prompt.contains("success looks like: zero stale pages"));
    assert!(prompt.contains("Budget: stay within $12.50 per month"));
    assert!(prompt
        .contains("Connector allowlist for this charter: github — do not reach other connectors"));
    assert!(prompt.contains("Deliver outputs via: email"));
    assert!(prompt.contains("On an unrecovered failure:"));
    assert!(prompt.contains("escalate only after 3 consecutive failures"));
    assert!(prompt.contains("Do not write to agent memory for this capability."));
    assert!(prompt.contains("Focus on this charter."));

    // Unresolvable id → no focus section, assembly still succeeds.
    let missing = serde_json::json!({ "_responsibility": "resp_gone" });
    let prompt = assemble_living_with_input(&persona, Some(&missing), Some(&charters), None);
    assert!(!prompt.contains("## Current Focus"));
}

/// A suspended charter appended to the slice (a simulation of a disabled
/// capability) still resolves for `## Current Focus` while staying out of
/// the roster.
#[test]
fn suspended_charter_focuses_without_joining_the_roster() {
    let persona = test_persona();
    let charters = [
        charter("resp_active", "Active charter"),
        PersonaResponsibility {
            status: "suspended".into(),
            ..charter("resp_susp", "Paused charter")
        },
    ];
    let input = serde_json::json!({ "_responsibility": "resp_susp" });
    let prompt = assemble_living_with_input(&persona, Some(&input), Some(&charters), None);

    assert!(prompt.contains("## Current Focus"));
    assert!(prompt.contains("**Paused charter** (docs)"));
    assert!(
        !prompt.contains("- **Paused charter** (docs)"),
        "roster keeps only active charters"
    );
}

/// The review-policy BRIDGE: a charter minted from a legacy use case
/// (`spec.migratedFromUseCaseId`) still surfaces the use case's
/// review_policy prompt line — the field never migrated into the spec, and
/// losing it re-opens the silently-skipped-approvals defect.
#[test]
fn focused_run_bridges_review_policy_from_the_design_context() {
    let mut persona = test_persona();
    persona.design_context = Some(
        serde_json::json!({
            "use_cases": [{
                "id": "uc_docs",
                "title": "Keep the docs honest",
                "review_policy": { "mode": "always" },
                "memory_policy": { "enabled": false },
            }]
        })
        .to_string(),
    );
    let mut ch = charter("resp_1", "Keep the docs honest");
    ch.spec.migrated_from_use_case_id = Some("uc_docs".into());
    let charters = [ch];
    let input = serde_json::json!({ "_responsibility": "resp_1" });

    let prompt = assemble_living_with_input(&persona, Some(&input), Some(&charters), None);

    assert!(prompt.contains("Generation policy for this charter:"));
    assert!(
        prompt.contains("never skip this step"),
        "review_policy=always must survive the charter cutover"
    );
    // The memory line rides once — the spec copy and the use-case copy dedupe.
    assert_eq!(
        prompt
            .matches("Do not write to agent memory for this capability.")
            .count(),
        1,
        "spec.memoryPolicy and the use case's memory_policy are the same fact"
    );
}

/// For a manifest persona the `## Capability Parameters` block re-derives
/// from the charters' `spec.inputSchema` (structured_prompt no longer
/// renders), and `{{param.<key>}}` resolves through the trusted path.
#[test]
fn manifest_persona_derives_capability_parameters_from_charters() {
    let mut persona = test_persona();
    persona.core_profile = Some(manifest_markdown());
    persona.parameters = Some(
        serde_json::json!([
            { "key": "timeout_hours", "label": "Timeout hours", "type": "number", "value": 48 }
        ])
        .to_string(),
    );
    let mut ch = charter("resp_1", "Keep the docs honest");
    ch.spec.input_schema = Some(serde_json::json!([
        { "name": "timeout_hours", "type": "number", "default": 48, "description": "Approval timeout" }
    ]));
    let charters = [ch];

    let prompt = assemble_living(&persona, Some(&charters), None);
    assert!(prompt.contains("## Capability Parameters"));
    assert!(prompt.contains("**Keep the docs honest**"));
    assert!(
        prompt.contains("- Timeout hours: 48"),
        "the {{{{param.*}}}} placeholder must resolve to the live value"
    );

    // A LEGACY persona does not get the derived block (its own rendered
    // instructions already carry the adopt-time copy).
    let mut legacy = test_persona();
    legacy.core_profile = Some(core_json(0.2, None));
    let prompt = assemble_living(&legacy, Some(&charters), None);
    assert!(!prompt.contains("## Capability Parameters"));
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

/// A core edit MUST invalidate warm sessions: `core_fingerprint` (the input
/// the session-pool config hash combines with the capabilities fingerprint)
/// changes when the mirror changes — a legacy dial edit and a manifest law
/// edit both count — and is empty for personas without a core so their hash
/// input stays exactly what it is today.
#[test]
fn core_fingerprint_reacts_to_mirror_edits() {
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

    let manifest_a = manifest_markdown();
    let manifest_b = manifest_a.replace("no external sends", "no deletes");
    assert_ne!(
        core_fingerprint(Some(&manifest_a)),
        core_fingerprint(Some(&manifest_b)),
        "a manifest law edit must invalidate warm sessions too"
    );
}
