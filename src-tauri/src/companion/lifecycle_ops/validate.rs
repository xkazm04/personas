//! The rules a lifecycle document must satisfy before it can be proposed or
//! stored through Athena. Run at proposal time (so a bad proposal never draws a
//! card) and again at confirm (the doc being written is a MIX of the current
//! one and the ticked changes, which can break a rule neither half broke alone,
//! e.g. an accepted `link` step with the Team preset change unticked).
//!
//! Every message names the exact problem and the valid alternatives, because it
//! is appended as an episode Athena reads before her next attempt.

use std::collections::HashSet;

use crate::db::models::{LifecycleDoc, LifecyclePhase, LifecyclePreset, LifecycleStep};
use crate::lifecycle::presets::BUILT_IN_STEP_IDS;

/// Longest custom-step label (it renders as a node caption).
pub const LABEL_MAX: usize = 40;
/// Longest rule text (it is injected into every session prompt).
pub const RULE_MAX: usize = 400;
/// Most steps one document may hold (11 built-ins plus a handful of custom).
pub const STEPS_MAX: usize = 24;
/// Custom id slug bounds, after the `x-` prefix.
const CUSTOM_SLUG_MIN: usize = 2;
const CUSTOM_SLUG_MAX: usize = 40;

/// The `x-<slug>` shape: `^x-[a-z0-9-]{2,40}$`.
pub fn is_custom_id(id: &str) -> bool {
    id.strip_prefix("x-").is_some_and(|slug| {
        (CUSTOM_SLUG_MIN..=CUSTOM_SLUG_MAX).contains(&slug.len())
            && slug
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    })
}

pub fn is_built_in(id: &str) -> bool {
    BUILT_IN_STEP_IDS.contains(&id)
}

/// The sentence every id rejection ends with.
pub fn valid_ids_hint() -> String {
    format!(
        "Built-in ids: {}. A custom step's id is `x-<slug>` (lowercase letters, digits and \
         dashes, {CUSTOM_SLUG_MIN}-{CUSTOM_SLUG_MAX} characters after `x-`) and it carries a \
         `label`.",
        BUILT_IN_STEP_IDS.join(", ")
    )
}

/// Which step owns which params field (camelCase, as proposed).
fn owned_params(id: &str) -> &'static [&'static str] {
    match id {
        "gate" => &["lint", "codeQuality"],
        "docs" => &["docsRequired"],
        "land" => &["landMode", "prBase", "automergeEnabled", "automergeTarget"],
        _ => &[],
    }
}

fn param_owner(field: &str) -> &'static str {
    match field {
        "lint" | "codeQuality" => "gate",
        "docsRequired" => "docs",
        _ => "land",
    }
}

fn check_params(step: &LifecycleStep) -> Result<(), String> {
    let p = &step.params;
    let set: [(&str, bool); 7] = [
        ("lint", p.lint.is_some()),
        ("codeQuality", p.code_quality.is_some()),
        ("docsRequired", p.docs_required.is_some()),
        ("landMode", p.land_mode.is_some()),
        ("prBase", p.pr_base.is_some()),
        ("automergeEnabled", p.automerge_enabled.is_some()),
        ("automergeTarget", p.automerge_target.is_some()),
    ];
    let owned = owned_params(&step.id);
    if let Some((field, _)) = set.iter().find(|(f, is)| *is && !owned.contains(f)) {
        return Err(format!(
            "step `{}` carries param `{field}`, which belongs to `{}`. Params: `gate` owns \
             lint/codeQuality, `docs` owns docsRequired, `land` owns landMode/prBase/\
             automergeEnabled/automergeTarget; every other step has none.",
            step.id,
            param_owner(field)
        ));
    }
    for (field, value) in [
        ("prBase", p.pr_base.as_deref()),
        ("automergeTarget", p.automerge_target.as_deref()),
    ] {
        if let Some(v) = value {
            if v != "main" && v != "test" {
                return Err(format!(
                    "step `{}` param `{field}` is `{v}`; it must be `main` or `test`.",
                    step.id
                ));
            }
        }
    }
    Ok(())
}

fn check_step(step: &LifecycleStep, preset: LifecyclePreset) -> Result<(), String> {
    let id = step.id.as_str();
    if is_built_in(id) {
        if step.label.is_some() {
            return Err(format!(
                "step `{id}` is built-in, so its `label` must be null (the app labels it)."
            ));
        }
    } else if is_custom_id(id) {
        let label = step.label.as_deref().map(str::trim).unwrap_or("");
        if label.is_empty() {
            return Err(format!(
                "custom step `{id}` needs a non-empty `label` (at most {LABEL_MAX} characters)."
            ));
        }
        if label.chars().count() > LABEL_MAX {
            return Err(format!(
                "custom step `{id}` label is {} characters; the limit is {LABEL_MAX}.",
                label.chars().count()
            ));
        }
    } else {
        return Err(format!("unknown step id `{id}`. {}", valid_ids_hint()));
    }
    let rule = step.rule.trim();
    if rule.is_empty() {
        return Err(format!("step `{id}` has an empty `rule`."));
    }
    if rule.chars().count() > RULE_MAX {
        return Err(format!(
            "step `{id}` rule is {} characters; the limit is {RULE_MAX}. Say it in one or two \
             imperative sentences.",
            rule.chars().count()
        ));
    }
    if step.bindings.is_empty() {
        return Err(format!(
            "step `{id}` has no bindings; give it at least one of app, claude_md, hook, ci, \
             advisory."
        ));
    }
    let mut seen = HashSet::new();
    if let Some(dup) = step.bindings.iter().find(|b| !seen.insert(**b)) {
        return Err(format!(
            "step `{id}` lists binding `{}` twice.",
            super::binding_str(*dup)
        ));
    }
    if id == "link" && preset != LifecyclePreset::Team {
        return Err(
            "`link` (a ticket id on the branch and every commit) is a Team step; drop it, or \
             propose `preset` team."
                .into(),
        );
    }
    check_params(step)
}

/// Validate a whole document. `Ok` means it may be stored.
pub fn validate_doc(doc: &LifecycleDoc) -> Result<(), String> {
    if doc.steps.is_empty() {
        return Err("the step list is empty; a proposal is the FULL step list.".into());
    }
    if doc.steps.len() > STEPS_MAX {
        return Err(format!(
            "{} steps is too many; the limit is {STEPS_MAX}.",
            doc.steps.len()
        ));
    }
    let mut ids = HashSet::new();
    for step in &doc.steps {
        if !ids.insert(step.id.as_str()) {
            return Err(format!("step id `{}` appears twice.", step.id));
        }
        check_step(step, doc.preset)?;
    }
    for (phase, name) in [
        (LifecyclePhase::Before, "before"),
        (LifecyclePhase::After, "after"),
    ] {
        if !doc.steps.iter().any(|s| s.phase == phase) {
            return Err(format!(
                "no step has phase `{name}`; both the before and the after phase need at least \
                 one step."
            ));
        }
    }
    Ok(())
}
