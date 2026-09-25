//! The two built-in lifecycle documents and the `standards_config` projection.
//!
//! `standards_config` (`dev_projects.standards_config`) is no longer an
//! authority: it is DERIVED from the latest lifecycle version by
//! [`standards_projection`] and written in the same transaction as every version
//! append (`db::repos::dev::lifecycle::append_version`). Persona runs and the
//! passport keep reading it unchanged. The shape mirrors
//! `src/lib/standards/standardsConfig.ts` (`StandardsConfig`), snake_case keys.
//!
//! [`apply_standards`] is the reverse, used by the old standards door
//! (`dev_tools_set_standards_config`) so an edit there becomes a new version.

use serde::{Deserialize, Serialize};

use crate::db::models::{
    LifecycleBindingKind as B, LifecycleDoc, LifecycleLandMode, LifecyclePhase, LifecyclePreset,
    LifecycleStep, LifecycleStepParams,
};

/// Built-in step ids, in canonical journey order. A custom step is `x-<slug>`.
// Read by WP3's proposal validation (known step ids); tests use it today.
#[allow(dead_code)]
pub const BUILT_IN_STEP_IDS: [&str; 11] = [
    "frame", "recall", "isolate", "link", "sync", "gate", "tests", "docs", "commit", "land",
    "record",
];

fn step(
    id: &str,
    phase: LifecyclePhase,
    bindings: &[B],
    params: LifecycleStepParams,
    rule: &str,
) -> LifecycleStep {
    LifecycleStep {
        id: id.to_string(),
        phase,
        label: None,
        rule: rule.to_string(),
        bindings: bindings.to_vec(),
        params,
    }
}

fn none() -> LifecycleStepParams {
    LifecycleStepParams::default()
}

fn gate_params() -> LifecycleStepParams {
    LifecycleStepParams {
        lint: Some(true),
        code_quality: Some(true),
        ..Default::default()
    }
}

fn docs_params(required: bool) -> LifecycleStepParams {
    LifecycleStepParams {
        docs_required: Some(required),
        ..Default::default()
    }
}

fn land_params(mode: LifecycleLandMode) -> LifecycleStepParams {
    LifecycleStepParams {
        land_mode: Some(mode),
        pr_base: Some("main".to_string()),
        automerge_enabled: Some(false),
        ..Default::default()
    }
}

/// The built-in document for a preset. Rule text is agent-facing English.
pub fn preset_doc(preset: LifecyclePreset) -> LifecycleDoc {
    use LifecyclePhase::{After, Before};
    let steps = match preset {
        LifecyclePreset::Solo => vec![
            step("frame", Before, &[B::App], none(), "Restate the task goal and its acceptance criteria in two lines before touching code; stop and ask if they are unclear."),
            step("recall", Before, &[B::ClaudeMd], none(), "Read the repo's CLAUDE.md/AGENTS.md conventions and reuse existing primitives before writing new code."),
            step("isolate", Before, &[B::App], none(), "Work on a dedicated branch or worktree when the change spans more than one file; never edit the base branch directly."),
            step("sync", Before, &[B::App], none(), "Start from the latest base branch (fetch and rebase or branch from its tip)."),
            step("gate", After, &[B::Hook], gate_params(), "Run the repo's typecheck, lint and tests; fix every failure before committing."),
            step("tests", After, &[B::Advisory], none(), "Add or update tests for behaviour you changed."),
            step("docs", After, &[B::Advisory], docs_params(false), "Update the docs and CHANGELOG entries your change makes stale."),
            step("commit", After, &[B::Hook], none(), "Commit atomically with a message that says what changed and why."),
            step("land", After, &[B::App], land_params(LifecycleLandMode::LocalMerge), "Leave the work committed on your branch; the app lands it into the base branch when gates are green."),
            step("record", After, &[B::App], none(), "End with a short summary of what changed, what was verified and anything left open."),
        ],
        LifecyclePreset::Team => vec![
            step("frame", Before, &[B::App], none(), "Restate the task goal and its acceptance criteria in two lines before touching code; stop and ask if they are unclear."),
            step("recall", Before, &[B::ClaudeMd], none(), "Read the repo's CLAUDE.md/AGENTS.md conventions and reuse existing primitives before writing new code."),
            step("isolate", Before, &[B::App], none(), "Always work on a branch named for the task; never commit to the base branch."),
            step("link", Before, &[B::App], none(), "Reference the task or issue id in the branch name and every commit message."),
            step("sync", Before, &[B::App], none(), "Start from the latest base branch (fetch and rebase or branch from its tip)."),
            step("gate", After, &[B::Hook, B::Ci], gate_params(), "Run typecheck, lint and tests locally; CI must pass on the pull request."),
            step("tests", After, &[B::Ci], none(), "Every behaviour change ships with tests; CI enforces it."),
            step("docs", After, &[B::Ci], docs_params(true), "Update docs and add a CHANGELOG entry; CI checks the entry exists."),
            step("commit", After, &[B::Hook], none(), "Use conventional commit messages (type(scope): summary) referencing the task id."),
            step("land", After, &[B::App], land_params(LifecycleLandMode::PullRequest), "Push the branch and open a pull request; it merges only after one review and green CI (squash)."),
            step("record", After, &[B::App], none(), "Write the summary into the pull request body: changes, verification, open questions."),
        ],
    };
    LifecycleDoc { preset, steps }
}

// ── standards_config projection ─────────────────────────────────────────────

#[derive(Debug, Default, Serialize, Deserialize)]
struct Precommit {
    #[serde(default)]
    lint: bool,
    #[serde(default)]
    docs_required: bool,
    #[serde(default)]
    code_quality: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Automerge {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    target: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Branching {
    #[serde(default)]
    pr_base: Option<String>,
    #[serde(default)]
    automerge: Automerge,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StandardsProjection {
    #[serde(default)]
    precommit: Precommit,
    #[serde(default)]
    branching: Branching,
}

/// `main` | `test` or nothing - the `BranchSel` vocabulary.
fn branch_sel(v: Option<&str>) -> Option<String> {
    match v {
        Some("main") => Some("main".to_string()),
        Some("test") => Some("test".to_string()),
        _ => None,
    }
}

fn find<'a>(doc: &'a LifecycleDoc, id: &str) -> Option<&'a LifecycleStep> {
    doc.steps.iter().find(|s| s.id == id)
}

/// The `standards_config` JSON a document projects to.
pub fn standards_projection(doc: &LifecycleDoc) -> String {
    let gate = find(doc, "gate").map(|s| &s.params);
    let docs = find(doc, "docs").map(|s| &s.params);
    let land = find(doc, "land").map(|s| &s.params);
    let projection = StandardsProjection {
        precommit: Precommit {
            lint: gate.and_then(|p| p.lint).unwrap_or(false),
            docs_required: docs.and_then(|p| p.docs_required).unwrap_or(false),
            code_quality: gate.and_then(|p| p.code_quality).unwrap_or(false),
        },
        branching: Branching {
            pr_base: branch_sel(land.and_then(|p| p.pr_base.as_deref())),
            automerge: Automerge {
                enabled: land.and_then(|p| p.automerge_enabled).unwrap_or(false),
                target: branch_sel(land.and_then(|p| p.automerge_target.as_deref())),
            },
        },
    };
    // A struct of bools and optional strings cannot fail to serialize.
    serde_json::to_string(&projection).unwrap_or_else(|_| "{}".to_string())
}

/// Map a `standards_config` JSON onto a document's step params. Parsing mirrors
/// `parseStandards` in the TS module: a missing or unparseable envelope reads
/// as nothing enabled. Steps absent from the document are left absent.
pub fn apply_standards(doc: &LifecycleDoc, standards_json: &str) -> LifecycleDoc {
    let s: StandardsProjection = serde_json::from_str(standards_json).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "unparseable standards_config; reading it as nothing enabled");
        StandardsProjection::default()
    });
    let mut out = doc.clone();
    for st in out.steps.iter_mut() {
        match st.id.as_str() {
            "gate" => {
                st.params.lint = Some(s.precommit.lint);
                st.params.code_quality = Some(s.precommit.code_quality);
            }
            "docs" => st.params.docs_required = Some(s.precommit.docs_required),
            "land" => {
                st.params.pr_base = branch_sel(s.branching.pr_base.as_deref());
                st.params.automerge_enabled = Some(s.branching.automerge.enabled);
                st.params.automerge_target = branch_sel(s.branching.automerge.target.as_deref());
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
#[path = "presets_tests.rs"]
mod tests;
