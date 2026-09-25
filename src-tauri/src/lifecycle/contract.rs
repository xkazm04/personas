//! The lifecycle contract: the rendered block injected into sessions the app
//! starts, at three named doors:
//!
//! 1. Run Desk - `task_executor::run_task_execution` (the prompt built by
//!    `build_task_prompt`, once the task's worktree branch is known), context
//!    [`ContractContext::RunDesk`].
//! 2. Unattended - every caller of `personas_engine::unattended::*_task_text*`
//!    in the app crate (persona attention dispatch, the idea fleet wave, team
//!    assignment steps), context [`ContractContext::Unattended`]. The engine
//!    crate stays preset-agnostic; the block is appended after its guardrails.
//! 3. Athena fleet-plan rows without a skill -
//!    `companion_dispatch_fleet_plan`, context [`ContractContext::FleetRow`].
//!
//! All three resolve the block through [`contract_for_project`], which returns
//! `""` when the project cannot be resolved, so each door is one line.

use crate::db::models::{
    LifecycleBindingKind, LifecycleDoc, LifecycleLandMode, LifecyclePhase, LifecycleStep,
};
use crate::db::DbPool;

/// Which door the contract is rendered for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractContext {
    /// A Run Desk task on `branch`.
    RunDesk {
        branch: String,
        gh_authenticated: bool,
    },
    /// An unattended run: Land/Isolate wording is omitted, the rung guardrails
    /// (the mandate) outrank the preset.
    Unattended,
    /// An Athena fleet-plan row.
    FleetRow,
}

/// The English name of a step: its `label` for a custom step, the built-in
/// name otherwise.
pub fn step_label(step: &LifecycleStep) -> String {
    if let Some(label) = step
        .label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        return label.to_string();
    }
    match step.id.as_str() {
        "frame" => "Frame",
        "recall" => "Recall",
        "isolate" => "Isolate",
        "link" => "Link",
        "sync" => "Sync",
        "gate" => "Gate",
        "tests" => "Tests",
        "docs" => "Docs",
        "commit" => "Commit",
        "land" => "Land",
        "record" => "Record",
        other => other,
    }
    .to_string()
}

/// Collapse a rule to one line (the ship rule is numbered, multi-line text).
fn one_line(text: &str) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    joined
        .strip_prefix("2. ")
        .map(str::to_string)
        .unwrap_or(joined)
}

/// The rule a step carries in this context, or `None` when the context omits it.
fn rule_for(step: &LifecycleStep, ctx: &ContractContext) -> Option<String> {
    match (step.id.as_str(), ctx) {
        ("isolate" | "land", ContractContext::Unattended) => None,
        ("land", ContractContext::FleetRow) => None,
        (
            "land",
            ContractContext::RunDesk {
                branch,
                gh_authenticated,
            },
        ) => Some(match step.params.land_mode {
            Some(LifecycleLandMode::LocalMerge) => format!(
                "Commit your work on `{branch}` and stop; the app lands it into the base branch when you finish."
            ),
            // The ship rule says how to open the PR; the preset owns the merge
            // bar, so it rides along instead of being dropped.
            Some(LifecycleLandMode::PullRequest) => format!(
                "{} It merges only after one review and green CI (squash); never merge it yourself.",
                one_line(&personas_engine::unattended::worktree_ship_rule(
                    branch,
                    *gh_authenticated
                ))
            ),
            None => one_line(&step.rule),
        }),
        _ => Some(one_line(&step.rule)),
    }
}

/// The contract block for `doc` at `version`, or `""` when there is nothing to
/// inject.
pub fn render_contract(doc: &LifecycleDoc, version: i64, ctx: ContractContext) -> String {
    let mut lines: Vec<String> = Vec::new();
    for (phase, heading) in [
        (LifecyclePhase::Before, "Before you start:"),
        (LifecyclePhase::After, "After the work:"),
    ] {
        let mut section: Vec<String> = doc
            .steps
            .iter()
            .filter(|s| s.phase == phase)
            .filter_map(|s| {
                let rule = rule_for(s, &ctx)?;
                let advisory = s.bindings.contains(&LifecycleBindingKind::Advisory);
                let suffix = if advisory { " (expected)" } else { "" };
                Some(format!("- {}{suffix}: {rule}", step_label(s)))
            })
            .collect();
        if phase == LifecyclePhase::After && ctx == ContractContext::Unattended {
            section.push("- Where to work and how to land: follow the guardrails above.".into());
        }
        if !section.is_empty() {
            lines.push(heading.to_string());
            lines.extend(section);
        }
    }
    if lines.is_empty() {
        return String::new();
    }
    format!(
        "## Development practice (lifecycle v{version}, {})\n{}\n",
        doc.preset.as_str(),
        lines.join("\n")
    )
}

/// The block for `project_id`'s current document, or `""` when the project's
/// lifecycle cannot be read (logged; a missing contract never blocks a run).
pub fn contract_for_project(pool: &DbPool, project_id: &str, ctx: ContractContext) -> String {
    // An absent version row is the implicit Solo default, so an unknown id
    // would otherwise read as one: resolve the project itself first.
    if let Err(e) = crate::db::repos::dev_tools::get_project_by_id(pool, project_id) {
        tracing::debug!(project_id, error = %e, "lifecycle: contract for an unknown project");
        return String::new();
    }
    match super::current_doc(pool, project_id) {
        Ok((doc, version, _)) => render_contract(&doc, version, ctx),
        Err(e) => {
            tracing::warn!(project_id, error = %e, "lifecycle: no contract for this project");
            String::new()
        }
    }
}

/// The Run Desk block for a task on `branch`. Probes `gh` (cached) only when the
/// practice lands through a pull request, the one rule that reads it. Blocking.
pub fn run_desk_contract(pool: &DbPool, project_id: &str, branch: &str) -> String {
    let resolved = crate::db::repos::dev_tools::get_project_by_id(pool, project_id)
        .and_then(|_| super::current_doc(pool, project_id));
    let (doc, version) = match resolved {
        Ok((doc, version, _)) => (doc, version),
        Err(e) => {
            tracing::warn!(project_id, error = %e, "lifecycle: no contract for this task");
            return String::new();
        }
    };
    let wants_pr = doc
        .steps
        .iter()
        .any(|s| s.id == "land" && s.params.land_mode == Some(LifecycleLandMode::PullRequest));
    let gh_authenticated = wants_pr
        && crate::db::models::cli_probe_spec("github").is_some_and(|spec| {
            crate::commands::design::connector_readiness::cached_cli_probe(spec).authed()
        });
    render_contract(
        &doc,
        version,
        ContractContext::RunDesk {
            branch: branch.to_string(),
            gh_authenticated,
        },
    )
}

/// `text` with `block` appended after a blank line; `text` unchanged when the
/// block is empty.
pub fn append_block(text: &str, block: &str) -> String {
    if block.trim().is_empty() {
        return text.to_string();
    }
    format!("{}\n\n{}", text.trim_end(), block.trim_end())
}

/// The registered project whose root contains `cwd` (the deepest one when
/// roots nest). The same containment reading as `validate_fleet_cwd_in_db`.
pub fn project_id_for_cwd(pool: &DbPool, cwd: &str) -> Option<String> {
    let canon = std::fs::canonicalize(cwd.trim()).ok()?;
    crate::db::repos::dev_tools::list_projects(pool, None)
        .ok()?
        .into_iter()
        .filter_map(|p| {
            let root = std::fs::canonicalize(&p.root_path).ok()?;
            canon
                .starts_with(&root)
                .then(|| (root.components().count(), p.id))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, id)| id)
}

#[cfg(test)]
#[path = "contract_tests.rs"]
mod tests;
