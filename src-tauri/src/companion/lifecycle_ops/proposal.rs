//! `show_lifecycle_proposal`: parse the op's params, resolve them against the
//! current document, diff, and (at confirm) apply only the ticked changes.
//! Pure functions over [`LifecycleDoc`]s; the DB side lives in `super`.
//!
//! A proposal is the FULL step list, in the order it should run. An existing
//! step may omit `phase`, `rule`, `bindings` and `params` (and a custom step its
//! `label`) to keep them as they are, so Athena can reorder or drop steps and
//! change one rule without restating ten others she only read as a digest.
//! `params` overlay field by field. A new step must state phase, rule and
//! bindings.

use std::collections::HashSet;

use serde::Deserialize;

use crate::db::models::{
    LifecycleBindingKind, LifecycleChange, LifecycleChangeKind, LifecycleDoc, LifecycleLandMode,
    LifecyclePhase, LifecyclePreset, LifecycleStep, LifecycleStepParams,
};

/// The `stepId` of the one change that is not a step.
pub const PRESET_CHANGE_ID: &str = "preset";
/// Longest `change_note` (it becomes the version's note).
pub const CHANGE_NOTE_MAX: usize = 280;

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProposedParams {
    #[serde(default)]
    pub lint: Option<bool>,
    #[serde(default, alias = "code_quality")]
    pub code_quality: Option<bool>,
    #[serde(default, alias = "docs_required")]
    pub docs_required: Option<bool>,
    #[serde(default, alias = "land_mode")]
    pub land_mode: Option<LifecycleLandMode>,
    #[serde(default, alias = "pr_base")]
    pub pr_base: Option<String>,
    #[serde(default, alias = "automerge_enabled")]
    pub automerge_enabled: Option<bool>,
    #[serde(default, alias = "automerge_target")]
    pub automerge_target: Option<String>,
}

/// One proposed step, before it is resolved against the current document.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProposedStep {
    pub id: String,
    #[serde(default)]
    pub phase: Option<LifecyclePhase>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub rule: Option<String>,
    #[serde(default)]
    pub bindings: Option<Vec<LifecycleBindingKind>>,
    #[serde(default)]
    pub params: Option<ProposedParams>,
}

/// The op's params, parsed.
#[derive(Debug)]
pub struct ProposalInput {
    pub project: String,
    pub change_note: String,
    pub preset: Option<LifecyclePreset>,
    pub steps: Vec<ProposedStep>,
}

fn str_field<'a>(v: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|k| v.get(*k).and_then(|x| x.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Read `{project, change_note, preset?, steps}`; `{project, change_note, doc:
/// {preset, steps}}` (the design contract's spelling) is accepted too.
pub fn parse_input(params: &serde_json::Value) -> Result<ProposalInput, String> {
    let project = str_field(params, &["project", "project_id", "project_slug"])
        .ok_or("`project` is required: a registered project's id or name.")?
        .to_string();
    let change_note = str_field(params, &["change_note", "changeNote"])
        .ok_or("`change_note` is required: one sentence saying what changes and why.")?
        .to_string();
    if change_note.chars().count() > CHANGE_NOTE_MAX {
        return Err(format!(
            "`change_note` is {} characters; keep it under {CHANGE_NOTE_MAX}.",
            change_note.chars().count()
        ));
    }
    let body = params
        .get("doc")
        .filter(|d| d.is_object())
        .unwrap_or(params);
    let preset = match body.get("preset").filter(|v| !v.is_null()) {
        None => None,
        Some(v) => Some(
            serde_json::from_value::<LifecyclePreset>(v.clone())
                .map_err(|_| format!("`preset` is {v}; it must be \"solo\" or \"team\"."))?,
        ),
    };
    let raw = body
        .get("steps")
        .and_then(|v| v.as_array())
        .ok_or("`steps` is required: the FULL proposed step list, in order.")?;
    let mut steps = Vec::with_capacity(raw.len());
    for (i, s) in raw.iter().enumerate() {
        let step = serde_json::from_value::<ProposedStep>(s.clone())
            .map_err(|e| format!("steps[{i}] does not parse: {e}."))?;
        steps.push(step);
    }
    Ok(ProposalInput {
        project,
        change_note,
        preset,
        steps,
    })
}

fn overlay(base: &LifecycleStepParams, p: Option<ProposedParams>) -> LifecycleStepParams {
    let Some(p) = p else {
        return base.clone();
    };
    LifecycleStepParams {
        lint: p.lint.or(base.lint),
        code_quality: p.code_quality.or(base.code_quality),
        docs_required: p.docs_required.or(base.docs_required),
        land_mode: p.land_mode.or(base.land_mode),
        pr_base: p.pr_base.or_else(|| base.pr_base.clone()),
        automerge_enabled: p.automerge_enabled.or(base.automerge_enabled),
        automerge_target: p.automerge_target.or_else(|| base.automerge_target.clone()),
        // Measurement knobs are the operator's (Gate/Tests detail), never Athena's.
        commands: base.commands.clone(),
        coverage_green_pct: base.coverage_green_pct,
        docs_clean_pct: base.docs_clean_pct,
        done_rate_pct: base.done_rate_pct,
    }
}

/// A provided string, trimmed. `Some("")` stays `Some("")` so validation can
/// name it rather than silently inheriting.
fn trimmed(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string())
}

/// Turn the proposed steps into a full document, filling what an existing
/// step omitted from `current`. Does not validate; the caller does.
pub fn resolve_doc(
    current: &LifecycleDoc,
    preset: Option<LifecyclePreset>,
    steps: Vec<ProposedStep>,
) -> Result<LifecycleDoc, String> {
    let mut out = Vec::with_capacity(steps.len());
    for p in steps {
        let id = p.id.trim().to_string();
        let step = match current.steps.iter().find(|s| s.id == id) {
            Some(base) => LifecycleStep {
                phase: p.phase.unwrap_or(base.phase),
                label: trimmed(p.label).or_else(|| base.label.clone()),
                rule: trimmed(p.rule).unwrap_or_else(|| base.rule.clone()),
                bindings: p.bindings.unwrap_or_else(|| base.bindings.clone()),
                params: overlay(&base.params, p.params),
                id,
            },
            None => {
                let missing: Vec<&str> = [
                    ("phase", p.phase.is_none()),
                    ("rule", p.rule.is_none()),
                    ("bindings", p.bindings.is_none()),
                ]
                .into_iter()
                .filter_map(|(f, absent)| absent.then_some(f))
                .collect();
                if !missing.is_empty() {
                    return Err(format!(
                        "step `{id}` is new (not in the current lifecycle), so it must state {}.",
                        missing.join(", ")
                    ));
                }
                LifecycleStep {
                    phase: p.phase.unwrap_or(LifecyclePhase::After),
                    label: trimmed(p.label),
                    rule: trimmed(p.rule).unwrap_or_default(),
                    bindings: p.bindings.unwrap_or_default(),
                    params: overlay(&LifecycleStepParams::default(), p.params),
                    id,
                }
            }
        };
        out.push(step);
    }
    Ok(LifecycleDoc {
        preset: preset.unwrap_or(current.preset),
        steps: out,
    })
}

/// The toggleable changes from `current` to `proposed`: the preset first, then
/// added / changed steps in proposed order, then removals in current order.
pub fn diff(current: &LifecycleDoc, proposed: &LifecycleDoc) -> Vec<LifecycleChange> {
    let mut changes = Vec::new();
    if current.preset != proposed.preset {
        changes.push(LifecycleChange {
            kind: LifecycleChangeKind::Preset,
            step_id: PRESET_CHANGE_ID.to_string(),
            before: None,
            after: None,
        });
    }
    for p in &proposed.steps {
        match current.steps.iter().find(|c| c.id == p.id) {
            None => changes.push(LifecycleChange {
                kind: LifecycleChangeKind::Added,
                step_id: p.id.clone(),
                before: None,
                after: Some(p.clone()),
            }),
            Some(c) if c != p => changes.push(LifecycleChange {
                kind: LifecycleChangeKind::Changed,
                step_id: p.id.clone(),
                before: Some(c.clone()),
                after: Some(p.clone()),
            }),
            Some(_) => {}
        }
    }
    for c in &current.steps {
        if !proposed.steps.iter().any(|p| p.id == c.id) {
            changes.push(LifecycleChange {
                kind: LifecycleChangeKind::Removed,
                step_id: c.id.clone(),
                before: Some(c.clone()),
                after: None,
            });
        }
    }
    changes
}

/// The document with ONLY the accepted changes applied to `current`. Steps keep
/// the proposed order; an unticked removal stays after the step that preceded
/// it now; phases are then grouped (before first) without reordering inside a
/// phase. Every accepted id must name one of `changes`.
pub fn apply_accepted(
    current: &LifecycleDoc,
    proposed: &LifecycleDoc,
    changes: &[LifecycleChange],
    accepted: &[String],
) -> Result<LifecycleDoc, String> {
    let accepted: HashSet<&str> = accepted.iter().map(|s| s.trim()).collect();
    if accepted.is_empty() {
        return Err("no change is ticked; dismiss the card instead.".into());
    }
    if let Some(unknown) = accepted
        .iter()
        .find(|a| !changes.iter().any(|c| c.step_id == **a))
    {
        return Err(format!(
            "`{unknown}` is not one of this proposal's changes."
        ));
    }
    let preset = if accepted.contains(PRESET_CHANGE_ID) {
        proposed.preset
    } else {
        current.preset
    };
    let mut steps: Vec<LifecycleStep> = Vec::new();
    for p in &proposed.steps {
        match current.steps.iter().find(|c| c.id == p.id) {
            Some(c) if !accepted.contains(p.id.as_str()) => steps.push(c.clone()),
            Some(_) => steps.push(p.clone()),
            None if accepted.contains(p.id.as_str()) => steps.push(p.clone()),
            None => {}
        }
    }
    for (i, c) in current.steps.iter().enumerate() {
        let removed = !proposed.steps.iter().any(|p| p.id == c.id);
        if !removed || accepted.contains(c.id.as_str()) {
            continue;
        }
        let at = current.steps[..i]
            .iter()
            .rev()
            .find_map(|prev| steps.iter().position(|s| s.id == prev.id))
            .map_or(0, |pos| pos + 1);
        steps.insert(at, c.clone());
    }
    let (mut before, after): (Vec<_>, Vec<_>) = steps
        .into_iter()
        .partition(|s| s.phase == LifecyclePhase::Before);
    before.extend(after);
    Ok(LifecycleDoc {
        preset,
        steps: before,
    })
}

fn is_repo(kind: &LifecycleBindingKind) -> bool {
    matches!(
        kind,
        LifecycleBindingKind::ClaudeMd | LifecycleBindingKind::Hook | LifecycleBindingKind::Ci
    )
}

/// Whether `next` asks the repo for something `current` did not: a step gained
/// a `claude_md` / `hook` / `ci` binding (a new step counts), or a
/// `claude_md`-bound step's rule changed (the installed block line is stale).
pub fn repo_bindings_strengthened(current: &LifecycleDoc, next: &LifecycleDoc) -> bool {
    next.steps.iter().any(|s| {
        let prev = current.steps.iter().find(|c| c.id == s.id);
        let gained = s
            .bindings
            .iter()
            .filter(|k| is_repo(k))
            .any(|k| !prev.is_some_and(|p| p.bindings.contains(k)));
        let reworded = prev.is_some_and(|p| {
            p.rule != s.rule && s.bindings.contains(&LifecycleBindingKind::ClaudeMd)
        });
        gained || reworded
    })
}
