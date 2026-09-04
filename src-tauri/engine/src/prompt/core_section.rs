//! `## Manifest` and `## Responsibilities` renderers — the living-agent
//! identity spine (spark `agent-manifest-rebase`, WP2).
//!
//! `personas.core_profile` is the MANIFEST MIRROR (WP1): for any persona whose
//! manifest was touched it holds the rendered `manifest.md` markdown verbatim;
//! legacy personas still carry the old `PersonaCore` JSON until first manifest
//! access. The assembler tells the two apart and renders both under one
//! heading, `## Manifest`:
//!
//! * [`render_manifest_markdown`] — the mirror text VERBATIM (frontmatter
//!   stripped) under `## Manifest`.
//! * [`render_legacy_core_prose`] — the legacy Core's PROSE fields only
//!   (identity, voice, motivation/stance/north-star, principles, constraints,
//!   decision principles). The dial bands (risk/speed/deference/conflict
//!   directives) are gone with the rebase: the manifest's law sections are the
//!   authored word now, and calibrated pseudo-prose from numbers is not.
//!
//! [`render_responsibilities`] renders ALL active charters as a compact
//! roster (no cap, no `+N more` collapse — the roster IS the capability
//! surface now). [`render_responsibility_focused`] renders ONE charter in
//! full (procedure, outcomes, objectives, connector allowlist, spec policies)
//! for a run dispatched FOR that charter (`input_data._responsibility`).
//!
//! All of it is pure string building — no IO, no DB. Content here is
//! operator-authored configuration, the same trust class as
//! `structured_prompt`, so it is NOT nonce-fenced — unlike episodes, which
//! are derived-untrusted and fenced in `assemble.rs`.

use personas_db::models::{PersonaCore, PersonaResponsibility, ResponsibilitySpec};

fn non_empty(s: &str) -> Option<&str> {
    let t = s.trim();
    (!t.is_empty()).then_some(t)
}

/// Strip a leading YAML frontmatter block (`---\n…\n---\n`), if any — the
/// manifest mirror carries `type: manifest / updated:` metadata that is disk
/// bookkeeping, not authored content. Mirrors
/// `persona_brain::manifest::strip_frontmatter` (app_lib), which this crate
/// cannot reach; the grammar is three lines of `---` fencing either way.
pub fn manifest_body(md: &str) -> &str {
    let rest = md
        .strip_prefix("---\n")
        .or_else(|| md.strip_prefix("---\r\n"));
    let Some(rest) = rest else {
        return md;
    };
    match rest.find("\n---\n").or_else(|| rest.find("\n---\r\n")) {
        Some(idx) => {
            let after = &rest[idx..];
            let after = after
                .strip_prefix("\n---\r\n")
                .or_else(|| after.strip_prefix("\n---\n"))
                .unwrap_or(after);
            after.trim_start_matches(['\r', '\n'])
        }
        None => md,
    }
}

/// Whether a `core_profile` value looks like the legacy `PersonaCore` JSON
/// rather than manifest markdown. Same heuristic as the manifest module's
/// `legacy_core_json`: markdown never opens with `{`.
pub fn looks_like_legacy_core(core_profile: &str) -> bool {
    core_profile.trim_start().starts_with('{')
}

/// Render the `## Manifest` section from the mirror's markdown, VERBATIM
/// (frontmatter stripped). The manifest's own `# ` law/self headings ride
/// along untouched — they are the document's structure, and demoting them
/// would un-quote the operator's word.
pub fn render_manifest_markdown(manifest: &str) -> String {
    let body = manifest_body(manifest).trim();
    format!("## Manifest\n{body}\n\n")
}

fn push_bullets(out: &mut String, heading: &str, items: &[String]) {
    let live: Vec<&str> = items.iter().filter_map(|i| non_empty(i)).collect();
    if live.is_empty() {
        return;
    }
    out.push_str(heading);
    out.push('\n');
    for item in live {
        out.push_str(&format!("- {item}\n"));
    }
    out.push('\n');
}

/// The legacy `PersonaCore`'s prose fields as manifest-shaped body text —
/// NO heading, so the Director's payload can reuse it verbatim. Dials render
/// nowhere: a legacy persona keeps its authored words only until the manifest
/// migration folds them into `# Mandate`.
pub fn render_legacy_core_prose(core: &PersonaCore) -> String {
    let mut out = String::new();

    if let Some(identity) = core.identity.as_deref().and_then(non_empty) {
        out.push_str(identity);
        out.push_str("\n\n");
    }
    if let Some(voice) = core.voice.as_deref().and_then(non_empty) {
        out.push_str(&format!("**Voice**: {voice}\n\n"));
    }

    let mut had_motivation_block = false;
    if let Some(m) = non_empty(&core.motivation) {
        out.push_str(&format!("**Why you care**: {m}\n"));
        had_motivation_block = true;
    }
    if let Some(s) = non_empty(&core.stance) {
        out.push_str(&format!("**Your stance**: {s}\n"));
        had_motivation_block = true;
    }
    if let Some(n) = non_empty(&core.north_star_commitment) {
        out.push_str(&format!("**Your route to the north star**: {n}\n"));
        had_motivation_block = true;
    }
    if had_motivation_block {
        out.push('\n');
    }

    push_bullets(&mut out, "**Principles you work by:**", &core.principles);
    push_bullets(
        &mut out,
        "**Hard constraints — never cross these:**",
        &core.constraints,
    );
    push_bullets(
        &mut out,
        "**When principles conflict, decide by:**",
        &core.decision_principles,
    );

    // Normalize the tail to exactly one blank line.
    while out.ends_with("\n\n\n") {
        out.pop();
    }
    if !out.is_empty() && !out.ends_with("\n\n") {
        out.push('\n');
    }
    out
}

/// The `## Manifest` section from a parsed legacy [`PersonaCore`].
pub fn render_legacy_core_section(core: &PersonaCore) -> String {
    let body = render_legacy_core_prose(core);
    let mut out = String::from("## Manifest\n");
    out.push_str(&body);
    if !out.ends_with("\n\n") {
        out.push('\n');
    }
    out
}

/// Scope-rung directive: what the charter lets the persona do unattended.
/// Cumulative by rung; anything above rung 2 keeps rung 2's hard ceiling.
fn scope_rung_line(rung: u8) -> &'static str {
    match rung {
        0 => "Scope: You may: read/observe.\n",
        1 => "Scope: You may: read/observe, retry/reconfigure.\n",
        _ => "Scope: You may: read/observe, retry/reconfigure, open branches and proposals — never merge, deploy, or change your own gates.\n",
    }
}

fn refusal_line(r: &PersonaResponsibility) -> Option<String> {
    let refusals: Vec<&str> = r
        .refusal_classes
        .iter()
        .filter_map(|c| non_empty(c))
        .collect();
    if refusals.is_empty() {
        return None;
    }
    let owner = non_empty(&r.owner).unwrap_or("the operator");
    Some(format!(
        "You refuse and escalate to {owner} when work touches: {}\n",
        refusals.join(", ")
    ))
}

/// Render the `## Responsibilities` roster: EVERY active charter, compact —
/// title, domain, first outcome statement, scope line, refusal+owner
/// one-liner. No cap and no `+N more` collapse: with the `## Active
/// Capabilities` menu retired, this roster is the model's whole standing view
/// of what it holds; the full detail of the dispatched charter renders under
/// `## Current Focus` instead.
///
/// Non-active charters in the slice are skipped here (the assembler may be
/// handed a suspended charter so a simulation's focused render can still
/// resolve it — see `assemble.rs`).
pub fn render_responsibilities(responsibilities: &[PersonaResponsibility]) -> String {
    let active: Vec<&PersonaResponsibility> = responsibilities
        .iter()
        .filter(|r| r.status == "active")
        .collect();
    if active.is_empty() {
        return String::new();
    }

    let mut out = String::from("## Responsibilities\n");
    // The cross-reference deliberately does NOT spell the heading with its
    // `##` marker: a heading-lookalike inside body text muddies the prompt's
    // own structure (and makes "is there a focus section?" unanswerable by
    // search, which is exactly how this line first broke its own test).
    out.push_str(
        "The standing charters you hold. They frame every run: work toward their outcomes, \
         respect their scope, refuse what they tell you to refuse. When a run is dispatched \
         for one charter, that charter's full detail appears in the Current Focus section \
         below.\n\n",
    );

    for r in active {
        out.push_str(&format!("- **{}** ({})", r.title, r.domain));
        if let Some(outcome) = r.outcomes.first().and_then(|o| non_empty(&o.statement)) {
            out.push_str(&format!(" — {outcome}"));
        }
        out.push('\n');
        out.push_str(&format!("  {}", scope_rung_line(r.scope_rung)));
        if let Some(line) = refusal_line(r) {
            out.push_str(&format!("  {line}"));
        }
    }
    out.push('\n');
    out
}

/// Whitespace-collapsed equality key, so policy lines from the charter spec
/// and the legacy use-case bridge (which wrap the same sentences differently)
/// dedupe instead of double-instructing the model.
pub(super) fn normalized_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Policy lines derived from the charter's own spec (the runtime envelope
/// e19 folded out of the legacy use case): delivery channels, error routing,
/// and the memory gate. Review policy has no spec home — for migrated
/// charters the assembler bridges it from the design-context use case.
pub fn spec_policy_lines(spec: &ResponsibilitySpec) -> Vec<String> {
    let mut lines = Vec::new();

    if let Some(channels) = spec
        .notification_channels
        .as_ref()
        .filter(|c| !c.is_empty())
    {
        lines.push(format!("Deliver outputs via: {}", channels.join(", ")));
    }

    if let Some(ep) = spec.error_policy.as_ref() {
        let mut parts: Vec<String> = Vec::new();
        if ep.incident == Some(true) {
            parts.push("raise an incident (raise_incident) so the user can unblock it".into());
        }
        if ep.lab == Some(true) {
            parts.push("note it for Lab improvement in your outcome assessment".into());
        }
        if let Some(n) = ep.escalate_after.filter(|n| *n > 0) {
            parts.push(format!(
                "escalate only after {n} consecutive failures — a first failure is yours to retry"
            ));
        }
        if !parts.is_empty() {
            lines.push(format!("On an unrecovered failure: {}.", parts.join("; ")));
        }
    }

    // Memory and human-gate policy go through the SAME renderer the legacy
    // bridge uses, fed from the charter's own slotted fields rather than from
    // a use case. Reusing it (instead of restating the sentences here) is
    // what keeps the bridge's whitespace dedupe working, and it is why a
    // charter minted from a recipe — which has no use case behind it — still
    // states its review policy. `review_policy.mode = auto_triage` skipping
    // the human queue is a safety behaviour, not a cosmetic one.
    let synthesized = serde_json::json!({
        "generation_settings": spec.generation_settings,
        "review_policy": spec.review_policy,
        "memory_policy": spec.memory_policy,
    });
    lines.extend(super::capabilities::render_capability_policy_lines(
        &synthesized,
    ));

    if let Some(prose) = spec
        .error_handling
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        lines.push(format!("On errors: {prose}"));
    }

    lines
}

/// Render ONE charter in full — the body of `## Current Focus` when a run is
/// dispatched FOR that charter (`input_data._responsibility` = its id):
/// procedure, outcomes with success criteria, objectives, scope, refusals,
/// approval gates, budget, connector allowlist, and the spec policies.
/// The heading and the closing "focus" directive stay in the assembler.
pub fn render_responsibility_focused(r: &PersonaResponsibility) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "This run is dispatched for your charter: **{}** ({}).\n",
        r.title, r.domain
    ));

    if let Some(p) = non_empty(&r.procedure) {
        out.push_str("\nHow you carry this charter out:\n");
        out.push_str(p);
        out.push_str("\n\n");
    }

    if !r.outcomes.is_empty() {
        out.push_str("Outcomes you are accountable for:\n");
        for o in &r.outcomes {
            out.push_str(&format!("- {}\n", o.statement));
            for c in o.success_criteria.iter().filter_map(|c| non_empty(c)) {
                out.push_str(&format!("  - success looks like: {c}\n"));
            }
        }
    }

    if !r.objectives.is_empty() {
        out.push_str("Objectives:\n");
        for obj in &r.objectives {
            let mut line = format!("- {}", obj.label);
            match (obj.baseline, obj.target) {
                (Some(b), Some(t)) => line.push_str(&format!(": {b} → {t}")),
                (None, Some(t)) => line.push_str(&format!(": target {t}")),
                (Some(b), None) => line.push_str(&format!(": baseline {b}")),
                (None, None) => {}
            }
            if let Some(u) = obj.unit.as_deref().and_then(non_empty) {
                line.push_str(&format!(" {u}"));
            }
            if let Some(ts) = obj.last_measured_at.as_deref().and_then(non_empty) {
                line.push_str(&format!(" (last measured {ts})"));
            }
            line.push('\n');
            out.push_str(&line);
        }
    }

    out.push_str(scope_rung_line(r.scope_rung));
    if let Some(line) = refusal_line(r) {
        out.push_str(&line);
    }
    let gates: Vec<&str> = r
        .approval_gates
        .iter()
        .filter_map(|g| non_empty(g))
        .collect();
    if !gates.is_empty() {
        out.push_str(&format!(
            "Always get operator approval before: {}\n",
            gates.join(", ")
        ));
    }
    if let Some(budget) = r.budget_monthly_usd {
        out.push_str(&format!(
            "Budget: stay within ${budget:.2} per month for this responsibility.\n"
        ));
    }
    if !r.connectors.is_empty() {
        let names: Vec<&str> = r.connectors.iter().filter_map(|c| non_empty(c)).collect();
        if !names.is_empty() {
            out.push_str(&format!(
                "Connector allowlist for this charter: {} — do not reach other connectors on this run.\n",
                names.join(", ")
            ));
        }
    }

    let policy = spec_policy_lines(&r.spec);
    if !policy.is_empty() {
        out.push_str("Charter policies for this run:\n");
        for line in policy {
            out.push_str(&format!("- {line}\n"));
        }
    }

    out
}

/// System-prompt addendum teaching a persona the operator-chat self-model OP
/// grammar. Rendered by `assemble` only for a persona that HAS a manifest
/// (a legacy persona has no self-model sections to propose against).
///
/// The text lives here rather than beside its parser
/// (`app_lib::engine::persona_brain::growth`) because the engine crate cannot
/// depend on `app_lib`; the parser re-exports this constant, and its
/// round-trip test asserts the example line below still parses — so the
/// grammar and the parser cannot drift apart.
pub const SELF_MODEL_OP_ADDENDUM: &str = "\
--- Self-model proposals (operator chat) ---\n\
When a conversation with your operator teaches you something durable about \
YOURSELF — your work, your craft, your mistakes — you MAY propose an update \
to the self-model sections of your manifest (\"My work\", \"My self-reads\"). \
Emit ONE line of JSON on its own line, with nothing else on that line:\n\
{\"op\":\"propose_manifest_diff\",\"diffs\":[{\"section\":\"My work / What I've learned about my craft\",\"op\":\"append\",\"new_text\":\"...\"}],\"motivation\":\"what in this conversation grounds the change\"}\n\
Rules: self-model sections ONLY — never Mandate, Boundaries or Operation \
defaults (those are operator law). Diff ops are append|replace|remove; \
replace and remove need \"anchor_text\" naming the exact bullet. At most 5 \
diffs. The proposal is filed for OPERATOR review and never applies by \
itself; the JSON line is stripped from your visible reply.";
