//! `## Core` and `## Responsibilities` renderers — the living-agent identity
//! spine (spark `living-agent-core`, WP2).
//!
//! [`render_core`] turns the persona's authored [`PersonaCore`] (the
//! `personas.core_profile` JSON) into prose the runtime prompt carries.
//! Dials render as calibrated directive BANDS — three per dial, cut at
//! `<0.34` / `<0.67` / else — never as raw numbers: a model acts on "you are
//! risk-averse" far better than on "risk_tolerance: 0.2".
//!
//! [`render_responsibilities`] renders the persona's standing charters
//! (outcomes, objectives, scope rung, refusal classes, budget), capped at
//! [`MAX_RESPONSIBILITIES_RENDERED`] with a `+N more` line.
//!
//! Both are pure string builders — no IO, no DB. The assembler feeds them and
//! owns placement (`## Core` immediately before the `## Identity` branch,
//! `## Responsibilities` immediately after `## Core`). Content here is
//! operator-authored configuration, the same trust class as
//! `structured_prompt`, so it is NOT nonce-fenced — unlike episodes, which
//! are derived-untrusted and fenced in `assemble.rs`.

use personas_db::models::{PersonaCore, PersonaResponsibility};

/// Cap on fully-rendered charters; the rest collapse into a `+N more` line.
pub const MAX_RESPONSIBILITIES_RENDERED: usize = 3;

fn non_empty(s: &str) -> Option<&str> {
    let t = s.trim();
    (!t.is_empty()).then_some(t)
}

/// Three-band dial cut: `<0.34` → 0 (low), `<0.67` → 1 (mid), else 2 (high).
fn band(value: f64) -> u8 {
    if value < 0.34 {
        0
    } else if value < 0.67 {
        1
    } else {
        2
    }
}

fn risk_tolerance_directive(value: f64) -> &'static str {
    match band(value) {
        0 => "You are risk-averse: prefer the reversible option, take the smaller step, and surface uncertainty before acting on it.",
        1 => "You take calculated risks: act when the expected upside is clear, but keep a rollback path for anything hard to undo.",
        _ => "You are risk-seeking: bias toward the bold move and act on incomplete information — treat inaction as the costlier failure.",
    }
}

fn speed_vs_quality_directive(value: f64) -> &'static str {
    // 0 = quality-max, 1 = speed-max.
    match band(value) {
        0 => "You optimize for quality over speed: finish properly, verify before declaring done, and never ship a shortcut you would not defend.",
        1 => "You balance speed and quality: deliver promptly, and when time runs short cut scope rather than rigor.",
        _ => "You optimize for speed: ship the useful version now and iterate — a rough answer today beats a polished one next week.",
    }
}

fn deference_directive(value: f64) -> &'static str {
    // 0 = holds its ground, 1 = yields readily.
    match band(value) {
        0 => "You hold your ground in disagreement: keep your position until presented with evidence that actually defeats it.",
        1 => "You weigh disagreement on its merits: concede to the stronger argument, hold firm against mere pressure.",
        _ => "You yield readily to stronger arguments: update fast when someone shows better evidence, and say so plainly.",
    }
}

fn conflict_style_directive(style: &str) -> Option<String> {
    let s = non_empty(style)?;
    Some(match s.to_ascii_lowercase().as_str() {
        "challenger" => "In conflict you are a challenger: press the uncomfortable question rather than let a weak consensus stand.".to_string(),
        "harmonizer" => "In conflict you are a harmonizer: find the shared ground first, and keep the disagreement about the work, never the people.".to_string(),
        "analyst" => "In conflict you are an analyst: slow the argument down to evidence — restate both positions, then test them against the data.".to_string(),
        "pragmatist" => "In conflict you are a pragmatist: steer toward the resolution the team can act on today, even if imperfect.".to_string(),
        _ => format!("In conflict your style is '{s}': act consistently with it."),
    })
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

/// Render the `## Core` section from a parsed [`PersonaCore`].
///
/// Always emits the header (callers only invoke this when a core parsed);
/// every inner block is skipped when its source field is empty. Ends with a
/// blank line so the assembler can `push_str` it directly.
pub fn render_core(core: &PersonaCore) -> String {
    let mut out = String::from("## Core\n");

    // WHO the persona is — authored prose identity, rendered first so it
    // reads as the section's opening statement.
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

    // Dials → calibrated prose directives (never raw numbers).
    out.push_str(risk_tolerance_directive(core.risk_tolerance));
    out.push('\n');
    out.push_str(speed_vs_quality_directive(core.speed_vs_quality));
    out.push('\n');
    out.push_str(deference_directive(core.deference));
    out.push('\n');
    if let Some(line) = conflict_style_directive(&core.conflict_style) {
        out.push_str(&line);
        out.push('\n');
    }
    out.push('\n');

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

/// Render the `## Responsibilities` section from the persona's ACTIVE
/// charters (callers filter by status before passing). Empty input renders
/// nothing. At most [`MAX_RESPONSIBILITIES_RENDERED`] charters render fully;
/// the remainder collapse into a `+N more` line.
pub fn render_responsibilities(responsibilities: &[PersonaResponsibility]) -> String {
    if responsibilities.is_empty() {
        return String::new();
    }

    let mut out = String::from("## Responsibilities\n");
    out.push_str(
        "These are the standing charters you hold. They frame every run: work toward their \
         outcomes, respect their scope, refuse what they tell you to refuse.\n\n",
    );

    for r in responsibilities.iter().take(MAX_RESPONSIBILITIES_RENDERED) {
        out.push_str(&format!("### {} ({})\n", r.title, r.domain));

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

        let refusals: Vec<&str> = r
            .refusal_classes
            .iter()
            .filter_map(|c| non_empty(c))
            .collect();
        if !refusals.is_empty() {
            let owner = non_empty(&r.owner).unwrap_or("the operator");
            out.push_str(&format!(
                "You refuse and escalate to {owner} when work touches: {}\n",
                refusals.join(", ")
            ));
        }

        if let Some(budget) = r.budget_monthly_usd {
            out.push_str(&format!(
                "Budget: stay within ${budget:.2} per month for this responsibility.\n"
            ));
        }
        out.push('\n');
    }

    let hidden = responsibilities
        .len()
        .saturating_sub(MAX_RESPONSIBILITIES_RENDERED);
    if hidden == 1 {
        out.push_str("+1 more responsibility (not rendered here)\n\n");
    } else if hidden > 1 {
        out.push_str(&format!(
            "+{hidden} more responsibilities (not rendered here)\n\n"
        ));
    }

    out
}
