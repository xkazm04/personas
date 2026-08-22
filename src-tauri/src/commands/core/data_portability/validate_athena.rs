//! Structural validation of the Athena section of a bundle.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// Per-field validation of Athena's section.
///
/// Two things here are load-bearing rather than defensive.
///
/// **Pref keys are a whitelist.** The import writes straight into
/// `app_settings`; without this check a crafted bundle could set any setting in
/// the app. `apply_athena_prefs` re-checks, because a security boundary
/// enforced in exactly one place is a security boundary one refactor from
/// disappearing.
///
/// **Enum values are checked against the parsers that will read them.**
/// `FactScope::parse`, `ProceduralScope::parse`, `BacklogKind::parse` and
/// `RitualKind::parse` all hard-error on an unknown string, so a row with a
/// bogus scope would import cleanly and then break `list_facts` at read time —
/// a failure with no visible connection to the import that caused it.
pub(crate) fn validate_athena(bundle: &PortabilityBundle) -> Result<(), AppError> {
    const FACT_SCOPES: [&str; 3] = ["user", "project", "world"];
    const PROCEDURAL_SCOPES: [&str; 4] = ["chat", "action", "memory", "build"];
    const GOAL_STATUSES: [&str; 4] = ["active", "paused", "completed", "abandoned"];
    const BACKLOG_KINDS: [&str; 2] = ["self_promise", "capability_gap"];
    const BACKLOG_STATUSES: [&str; 3] = ["pending", "done", "dropped"];
    const RITUAL_KINDS: [&str; 3] = ["quiet_hours", "cadence", "focus_window"];

    let Some(a) = bundle.athena.as_ref() else {
        return Ok(());
    };

    fn one_of(field: &str, value: &str, allowed: &[&str]) -> Result<(), AppError> {
        if allowed.contains(&value) {
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "{field}: '{value}' is not one of ({})",
                allowed.join("|")
            )))
        }
    }

    validation::require_max_count("athena.facts", &a.facts, MAX_ATHENA_FACTS)?;
    validation::require_max_count("athena.procedurals", &a.procedurals, MAX_ATHENA_PROCEDURALS)?;
    validation::require_max_count("athena.goals", &a.goals, MAX_ATHENA_GOALS)?;
    validation::require_max_count("athena.backlog", &a.backlog, MAX_ATHENA_BACKLOG)?;
    validation::require_max_count("athena.rituals", &a.rituals, MAX_ATHENA_RITUALS)?;
    validation::require_max_count("athena.decisions", &a.decisions, MAX_ATHENA_DECISIONS)?;
    validation::require_max_count("athena.sessions", &a.sessions, MAX_ATHENA_SESSIONS)?;
    // One node per learned row, so the node cap is the sum of the sidecar caps.
    validation::require_max_count(
        "athena.nodes",
        &a.nodes,
        MAX_ATHENA_FACTS
            + MAX_ATHENA_PROCEDURALS
            + MAX_ATHENA_GOALS
            + MAX_ATHENA_BACKLOG
            + MAX_ATHENA_RITUALS,
    )?;
    // Provenance is many-to-one against nodes; bound it against the same
    // ceiling rather than leaving the one unbounded array in the section.
    validation::require_max_count(
        "athena.provenance",
        &a.provenance,
        (MAX_ATHENA_FACTS + MAX_ATHENA_PROCEDURALS) * 8,
    )?;

    if let Some(identity) = a.identity_md.as_deref() {
        validation::require_max_len("athena.identity_md", identity, MAX_IDENTITY_BYTES)?;
    }

    for (i, p) in a.prefs.iter().enumerate() {
        if !ATHENA_PORTABLE_PREF_KEYS.contains(&p.key.as_str()) {
            return Err(AppError::Validation(format!(
                "athena.pref[{i}]: '{}' is not a portable Athena preference. Only ({}) may be carried in a bundle.",
                p.key,
                ATHENA_PORTABLE_PREF_KEYS.join("|")
            )));
        }
        validation::require_max_len(&format!("athena.pref[{i}].value"), &p.value, MAX_CONFIG_LEN)?;
    }

    for (i, s) in a.sessions.iter().enumerate() {
        let p = format!("athena.session[{i}]");
        validation::require_non_empty(&format!("{p}.id"), &s.id)?;
        validation::require_max_len(&format!("{p}.id"), &s.id, MAX_SHORT_FIELD_LEN)?;
        validation::require_optional_max_len(&format!("{p}.title"), &s.title, MAX_NAME_LEN)?;
        validation::require_max_len(&format!("{p}.origin"), &s.origin, MAX_SHORT_FIELD_LEN)?;
        validation::require_max_len(&format!("{p}.status"), &s.status, MAX_SHORT_FIELD_LEN)?;
    }

    for (i, n) in a.nodes.iter().enumerate() {
        let p = format!("athena.node[{i}]");
        validation::require_non_empty(&format!("{p}.id"), &n.id)?;
        validation::require_max_len(&format!("{p}.id"), &n.id, MAX_SHORT_FIELD_LEN)?;
        one_of(&format!("{p}.kind"), &n.kind, &ATHENA_LEARNED_KINDS)?;
        validation::require_non_empty(&format!("{p}.file_path"), &n.file_path)?;
        validation::require_max_len(&format!("{p}.file_path"), &n.file_path, MAX_DESCRIPTION_LEN)?;
        // The import re-anchors this onto THIS machine's brain root, so an
        // absolute path or a traversal would write outside it.
        if std::path::Path::new(&n.file_path).is_absolute() || n.file_path.contains("..") {
            return Err(AppError::Validation(format!(
                "{p}.file_path: '{}' must be relative to the brain directory",
                n.file_path
            )));
        }
        validation::require_max_len(
            &format!("{p}.content_hash"),
            &n.content_hash,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_max_len(&format!("{p}.body"), &n.body, MAX_ATHENA_MD_FILE_BYTES)?;
        validation::require_optional_max_len(
            &format!("{p}.body_excerpt"),
            &n.body_excerpt,
            MAX_MEMORY_CONTENT_LEN,
        )?;
        if !(0..=5).contains(&n.importance) {
            return Err(AppError::Validation(format!(
                "{p}.importance: {} is outside 0..=5",
                n.importance
            )));
        }
    }

    for (i, f) in a.facts.iter().enumerate() {
        let p = format!("athena.fact[{i}]");
        validation::require_max_len(&format!("{p}.id"), &f.id, MAX_SHORT_FIELD_LEN)?;
        one_of(&format!("{p}.scope"), &f.scope, &FACT_SCOPES)?;
        validation::require_non_empty(&format!("{p}.fact_key"), &f.fact_key)?;
        validation::require_max_len(&format!("{p}.fact_key"), &f.fact_key, MAX_NAME_LEN)?;
        validation::require_optional_max_len(
            &format!("{p}.supersedes_id"),
            &f.supersedes_id,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.contradicts_id"),
            &f.contradicts_id,
            MAX_SHORT_FIELD_LEN,
        )?;
        if !(0.0..=1.0).contains(&f.confidence) {
            return Err(AppError::Validation(format!(
                "{p}.confidence: {} is outside 0.0..=1.0",
                f.confidence
            )));
        }
    }

    for (i, r) in a.procedurals.iter().enumerate() {
        let p = format!("athena.procedural[{i}]");
        validation::require_max_len(&format!("{p}.id"), &r.id, MAX_SHORT_FIELD_LEN)?;
        one_of(&format!("{p}.scope"), &r.scope, &PROCEDURAL_SCOPES)?;
        validation::require_non_empty(&format!("{p}.trigger_pattern"), &r.trigger_pattern)?;
        validation::require_max_len(
            &format!("{p}.trigger_pattern"),
            &r.trigger_pattern,
            MAX_MEMORY_CONTENT_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.supersedes_id"),
            &r.supersedes_id,
            MAX_SHORT_FIELD_LEN,
        )?;
        if !(0.0..=1.0).contains(&r.confidence) {
            return Err(AppError::Validation(format!(
                "{p}.confidence: {} is outside 0.0..=1.0",
                r.confidence
            )));
        }
    }

    for (i, g) in a.goals.iter().enumerate() {
        let p = format!("athena.goal[{i}]");
        validation::require_max_len(&format!("{p}.id"), &g.id, MAX_SHORT_FIELD_LEN)?;
        validation::require_non_empty(&format!("{p}.title"), &g.title)?;
        validation::require_max_len(&format!("{p}.title"), &g.title, MAX_MEMORY_CONTENT_LEN)?;
        one_of(&format!("{p}.status"), &g.status, &GOAL_STATUSES)?;
        validation::require_max_len(
            &format!("{p}.sources_json"),
            &g.sources_json,
            MAX_CONFIG_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.target_date"),
            &g.target_date,
            MAX_SHORT_FIELD_LEN,
        )?;
    }

    for (i, b) in a.backlog.iter().enumerate() {
        let p = format!("athena.backlog[{i}]");
        validation::require_max_len(&format!("{p}.id"), &b.id, MAX_SHORT_FIELD_LEN)?;
        validation::require_non_empty(&format!("{p}.summary"), &b.summary)?;
        validation::require_max_len(&format!("{p}.summary"), &b.summary, MAX_MEMORY_CONTENT_LEN)?;
        one_of(&format!("{p}.kind"), &b.kind, &BACKLOG_KINDS)?;
        one_of(&format!("{p}.status"), &b.status, &BACKLOG_STATUSES)?;
        validation::require_optional_max_len(
            &format!("{p}.source_episode_id"),
            &b.source_episode_id,
            MAX_SHORT_FIELD_LEN,
        )?;
    }

    for (i, r) in a.rituals.iter().enumerate() {
        let p = format!("athena.ritual[{i}]");
        validation::require_max_len(&format!("{p}.id"), &r.id, MAX_SHORT_FIELD_LEN)?;
        one_of(&format!("{p}.kind"), &r.kind, &RITUAL_KINDS)?;
        validation::require_non_empty(&format!("{p}.description"), &r.description)?;
        validation::require_max_len(
            &format!("{p}.description"),
            &r.description,
            MAX_MEMORY_CONTENT_LEN,
        )?;
        validation::require_max_len(
            &format!("{p}.schedule_json"),
            &r.schedule_json,
            MAX_CONFIG_LEN,
        )?;
        validation::require_max_len(
            &format!("{p}.sources_json"),
            &r.sources_json,
            MAX_CONFIG_LEN,
        )?;
    }

    for (i, d) in a.decisions.iter().enumerate() {
        let p = format!("athena.decision[{i}]");
        validation::require_max_len(&format!("{p}.id"), &d.id, MAX_SHORT_FIELD_LEN)?;
        validation::require_max_len(
            &format!("{p}.session_id"),
            &d.session_id,
            MAX_SHORT_FIELD_LEN,
        )?;
        validation::require_optional_max_len(
            &format!("{p}.persona_context"),
            &d.persona_context,
            MAX_NAME_LEN,
        )?;
        validation::require_non_empty(&format!("{p}.label"), &d.label)?;
        validation::require_max_len(&format!("{p}.label"), &d.label, MAX_MEMORY_CONTENT_LEN)?;
        validation::require_max_len(&format!("{p}.choice"), &d.choice, MAX_MEMORY_CONTENT_LEN)?;
        validation::require_max_len(
            &format!("{p}.rationale"),
            &d.rationale,
            MAX_MEMORY_CONTENT_LEN,
        )?;
    }

    for (i, pr) in a.provenance.iter().enumerate() {
        let p = format!("athena.provenance[{i}]");
        validation::require_non_empty(&format!("{p}.fact_id"), &pr.fact_id)?;
        validation::require_max_len(&format!("{p}.fact_id"), &pr.fact_id, MAX_SHORT_FIELD_LEN)?;
        validation::require_non_empty(&format!("{p}.episode_id"), &pr.episode_id)?;
        validation::require_max_len(
            &format!("{p}.episode_id"),
            &pr.episode_id,
            MAX_SHORT_FIELD_LEN,
        )?;
    }

    Ok(())
}
