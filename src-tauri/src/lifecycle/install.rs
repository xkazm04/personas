//! "Install into repo": create a Run Desk dev task that writes the missing
//! repo bindings (managed CLAUDE.md block, lefthook commands, CI workflow) and
//! execute it through the Run Desk's own executor
//! (`task_executor::start_task_execution`, the body of `dev_tools_execute_task`),
//! so the install follows the project's own lifecycle: worktree, contract,
//! evidence, Solo auto-land, Team PR. The task id is stored on the version row
//! (`db::repos::dev::lifecycle::set_install_task`).
//!
//! Only bindings in state `missing` are installed; `detected` (an existing
//! mechanism covers it) and `pending` (an install is running) are left alone.

use std::sync::Arc;

use super::contract::step_label;
use super::detect::{BLOCK_END, CI_WORKFLOW};
use crate::db::models::{
    LifecycleAuthor, LifecycleBindingKind as K, LifecycleBindingState, LifecycleSnapshot,
    LifecycleStep,
};
use crate::db::repos::dev::lifecycle as repo;
use crate::db::repos::dev::tasks as task_repo;
use crate::error::AppError;
use crate::AppState;

/// The task an install becomes: its title and its description (the prompt).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPlan {
    pub title: String,
    pub prompt: String,
}

fn kind_name(kind: K) -> &'static str {
    match kind {
        K::ClaudeMd => "CLAUDE.md block",
        K::Hook => "pre-commit hook",
        K::Ci => "CI job",
        K::App | K::Advisory => "",
    }
}

/// Steps with a repo binding (`claude_md` / `hook` / `ci`) in state `missing`,
/// each with the missing kinds, in journey order.
pub fn missing_bindings(snapshot: &LifecycleSnapshot) -> Vec<(&LifecycleStep, Vec<K>)> {
    snapshot
        .steps
        .iter()
        .filter_map(|view| {
            let kinds: Vec<K> = view
                .binding_views
                .iter()
                .filter(|b| b.state == LifecycleBindingState::Missing)
                .map(|b| b.kind)
                .filter(|k| matches!(k, K::ClaudeMd | K::Hook | K::Ci))
                .collect();
            (!kinds.is_empty()).then_some((&view.step, kinds))
        })
        .collect()
}

/// The managed CLAUDE.md block, exactly as the install writes it: one bullet
/// per step bound to the repo (`claude_md`, `hook` or `ci`).
pub fn managed_block(snapshot: &LifecycleSnapshot) -> String {
    let mut lines = vec![
        format!(
            "<!-- personas-lifecycle:begin v={} preset={} -->",
            snapshot.version,
            snapshot.preset.as_str()
        ),
        "## Development practice (managed by Personas)".to_string(),
    ];
    for view in &snapshot.steps {
        let s = &view.step;
        if s.bindings
            .iter()
            .any(|k| matches!(k, K::ClaudeMd | K::Hook | K::Ci))
        {
            let rule = s.rule.split_whitespace().collect::<Vec<_>>().join(" ");
            lines.push(format!("- [step:{}] {}: {rule}", s.id, step_label(s)));
        }
    }
    lines.push(BLOCK_END.to_string());
    lines.join("\n")
}

/// The install task for `snapshot`, or `None` when no repo binding is missing.
pub fn plan_install(snapshot: &LifecycleSnapshot) -> Option<InstallPlan> {
    let missing = missing_bindings(snapshot);
    if missing.is_empty() {
        return None;
    }
    let names: Vec<String> = missing.iter().map(|(s, _)| step_label(s)).collect();
    let title = format!(
        "Lifecycle v{}: install {}",
        snapshot.version,
        names.join(", ")
    );
    let with_kind = |kind: K| -> Vec<&LifecycleStep> {
        missing
            .iter()
            .filter(|(_, kinds)| kinds.contains(&kind))
            .map(|(s, _)| *s)
            .collect()
    };

    let mut p = String::new();
    p.push_str(
        "Goal: install the listed lifecycle bindings into this repository without removing or \
         weakening anything that exists.\n\n## Missing bindings\n",
    );
    for (step, kinds) in &missing {
        let kinds: Vec<&str> = kinds.iter().map(|k| kind_name(*k)).collect();
        p.push_str(&format!(
            "- {} (`{}`): {}\n",
            step_label(step),
            step.id,
            kinds.join(", ")
        ));
    }

    p.push_str(
        "\n## CLAUDE.md block\nUse the repo's existing `CLAUDE.md` at the root, else \
         `.claude/CLAUDE.md`, else create a root `CLAUDE.md`. Replace everything from the line \
         starting `<!-- personas-lifecycle:begin` through `<!-- personas-lifecycle:end -->` with \
         the block below, or append it at the end of the file when there is none. Write it \
         exactly, and change nothing else in the file:\n\n",
    );
    p.push_str(&managed_block(snapshot));
    p.push_str("\n\n");

    let hooks = with_kind(K::Hook);
    if !hooks.is_empty() {
        p.push_str("## Hooks\n");
        p.push_str(
            "Add one pre-commit command per step below. With lefthook, add a command named \
             `personas-lifecycle-<id>` under `pre-commit` (create `lefthook.yml` only if the repo \
             has no hook manager and lefthook suits it). With husky, add an equivalent line to \
             `.husky/pre-commit` followed by a `# personas-lifecycle-<id>` comment. Keep every \
             existing command.\n",
        );
        for s in hooks {
            let what = match s.id.as_str() {
                "gate" => "run the repo's existing typecheck, lint and test scripts (read them from package.json scripts, Cargo, pyproject)",
                "tests" => "refuse a commit that changes source files but no test files",
                "commit" => "check the commit message is conventional (`type(scope): summary`); this one belongs under `commit-msg`, not `pre-commit`",
                _ => "enforce the step's rule below",
            };
            p.push_str(&format!(
                "- `personas-lifecycle-{}`: {what}. Rule: {}\n",
                s.id, s.rule
            ));
        }
        p.push('\n');
    }

    let ci = with_kind(K::Ci);
    if !ci.is_empty() {
        p.push_str(&format!(
            "## CI\nCreate or update `{CI_WORKFLOW}` (`on: pull_request`) with one job per step \
             below, each job named `personas-lifecycle-<id>`:\n"
        ));
        for s in ci {
            p.push_str(&format!("- `personas-lifecycle-{}`: {}\n", s.id, s.rule));
        }
        p.push('\n');
    }

    p.push_str(
        "## Verify\nRun the new hooks once. End with a report of what you installed and anything \
         you could not install, and why.\n",
    );
    Some(InstallPlan { title, prompt: p })
}

/// Dispatch the install task for the project's latest version. Returns the
/// task id, or `None` when no repo binding is missing.
///
/// An implicit v0 is first pinned as v1 (author `system`): the block the task
/// writes names its version, and the task id is stored on a version row.
pub async fn dispatch_install(
    state: &Arc<AppState>,
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<Option<String>, AppError> {
    let db = state.db.clone();
    let pid = project_id.to_string();
    let planned = crate::commands::blocking::run_blocking("lifecycle_install", move || {
        let (doc, version, _) = super::current_doc(&db, &pid)?;
        if version == 0 {
            super::append(&db, &pid, &doc, Some("Pinned for install"), LifecycleAuthor::System)?;
        }
        let snapshot = super::snapshot(&db, &pid)?;
        let Some(plan) = plan_install(&snapshot) else {
            return Ok(None);
        };
        let task = task_repo::create_task(
            &db,
            Some(&pid),
            &plan.title,
            Some(&plan.prompt),
            None,
            None,
            None,
            None,
        )?;
        if !repo::set_install_task(&db, &pid, snapshot.version, &task.id)? {
            tracing::info!(project_id = %pid, version = snapshot.version, task_id = %task.id,
                "lifecycle: this version already names an install task; the new one runs unrecorded");
        }
        Ok(Some(task.id))
    })
    .await?;
    let Some(task_id) = planned else {
        return Ok(None);
    };
    if let Err(e) = crate::commands::infrastructure::task_executor::start_task_execution(
        &state.db,
        app,
        task_id.clone(),
        None,
    ) {
        // A task that never started must not hold the binding at `pending`
        // (a non-terminal install task) forever.
        let msg = format!("install task could not start: {e}");
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(w) = task_repo::update_task(
            &state.db,
            &task_id,
            None,
            None,
            Some("failed"),
            None,
            None,
            None,
            Some(Some(&msg)),
            None,
            Some(Some(&now)),
        ) {
            tracing::warn!(task_id = %task_id, error = %w, "lifecycle: could not fail the unstarted install task");
        }
        return Err(e);
    }
    Ok(Some(task_id))
}

#[cfg(test)]
#[path = "install_tests.rs"]
mod tests;
