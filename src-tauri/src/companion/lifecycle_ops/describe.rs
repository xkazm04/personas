//! `describe_lifecycle` (Read op): a project's lifecycle as a compact `[lookup]`
//! episode. One line per step with its bindings' states and its evidence tally,
//! then the three newest evidence items. Rule text is deliberately NOT printed
//! (eleven rules alone overflow the budget); a proposal may omit `rule` on an
//! existing step to keep it, which is what makes the digest enough to propose
//! from.

use crate::db::models::{
    LifecycleBindingState, LifecycleEvidenceItem, LifecycleOutcome, LifecycleSnapshot,
    LifecycleSourceKind,
};
use crate::db::DbPool;

/// Hard cap on the answer (the brief's budget; under `READ_OP_DETAIL_CHARS`).
pub const DESCRIBE_MAX_CHARS: usize = 1_500;
/// Evidence items printed.
const EVIDENCE_SHOWN: usize = 3;

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('\u{2026}');
    out
}

fn state_str(s: LifecycleBindingState) -> &'static str {
    match s {
        LifecycleBindingState::Live => "live",
        LifecycleBindingState::Detected => "detected",
        LifecycleBindingState::Pending => "pending",
        LifecycleBindingState::Missing => "missing",
        LifecycleBindingState::Advisory => "advisory",
    }
}

fn source_str(s: LifecycleSourceKind) -> &'static str {
    match s {
        LifecycleSourceKind::Task => "task",
        LifecycleSourceKind::Commit => "commit",
        LifecycleSourceKind::Pr => "pr",
    }
}

/// The ids of the steps one evidence item recorded with outcome `o`.
fn steps_with(item: &LifecycleEvidenceItem, o: LifecycleOutcome) -> Vec<&str> {
    item.outcomes
        .iter()
        .filter(|x| x.outcome == o)
        .map(|x| x.step_id.as_str())
        .collect()
}

/// The whole answer for `query` (a registered project's id or name).
pub fn describe_lifecycle(db: &DbPool, query: &str) -> String {
    let (project_id, project_name) = match super::resolve_project(db, query) {
        Ok(p) => p,
        Err(msg) => return msg,
    };
    match crate::lifecycle::snapshot(db, &project_id) {
        Ok(snap) => render(&project_name, &snap),
        Err(e) => format!(
            "The lifecycle of {project_name} could not be read: {e}. Say so rather than \
             guessing its steps."
        ),
    }
}

/// Render a snapshot. Separate from the DB read so the shape is testable.
pub fn render(project_name: &str, snap: &LifecycleSnapshot) -> String {
    let author = serde_json::to_value(snap.author)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    let note = snap
        .change_note
        .as_deref()
        .map(|n| format!(": \"{}\"", clip(n, 80)))
        .unwrap_or_default();
    let mut lines = vec![format!(
        "LIFECYCLE {} (`{}`): preset {}, v{} by {author}{note}",
        clip(project_name, 60),
        snap.project_id,
        snap.preset.as_str(),
        snap.version
    )];
    if snap.version == 0 {
        lines.push("v0 = the implicit Solo default; nothing is stored yet.".into());
    }
    lines.push(match &snap.install_task_id {
        Some(id) => format!(
            "Install task: {id} ({})",
            snap.install_task_status
                .as_deref()
                .unwrap_or("status unknown")
        ),
        None => "Install task: none".into(),
    });
    lines.push("Steps (evidence = done/skipped/unknown/failed):".into());
    for view in &snap.steps {
        let step = &view.step;
        let label = step
            .label
            .as_deref()
            .map(|l| format!(" \"{}\"", clip(l, 40)))
            .unwrap_or_default();
        let bindings: Vec<String> = view
            .binding_views
            .iter()
            .map(|b| format!("{}:{}", super::binding_str(b.kind), state_str(b.state)))
            .collect();
        let t = &view.evidence;
        let phase = match step.phase {
            crate::db::models::LifecyclePhase::Before => "before",
            crate::db::models::LifecyclePhase::After => "after",
        };
        lines.push(format!(
            "- {}{label} [{phase}] bindings={} evidence={}/{}/{}/{}",
            step.id,
            bindings.join(","),
            t.done,
            t.skipped,
            t.unknown,
            t.failed
        ));
    }
    // Measured health: one line per step that is not green (instructed steps
    // are unobservable by design and stay out of it).
    let unwell: Vec<String> = snap
        .health
        .iter()
        .filter(|h| {
            !matches!(
                h.health,
                crate::db::models::LifecycleHealth::Green
                    | crate::db::models::LifecycleHealth::Instructed
            )
        })
        .map(|h| {
            let verdict = serde_json::to_value(h.health)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            format!(
                "- {} {verdict}: {}",
                h.step_id,
                clip(h.reason.as_deref().unwrap_or("no reason given"), 100)
            )
        })
        .collect();
    if !snap.health.is_empty() {
        if unwell.is_empty() {
            lines.push("Measured health: every measurable step is green.".into());
        } else {
            lines.push("Measured health (not green):".into());
            lines.extend(unwell);
        }
    }
    if snap.evidence.is_empty() {
        lines.push("Newest evidence: none yet.".into());
    } else {
        lines.push("Newest evidence:".into());
        for item in snap.evidence.iter().take(EVIDENCE_SHOWN) {
            let (skipped, failed) = (
                steps_with(item, LifecycleOutcome::Skipped),
                steps_with(item, LifecycleOutcome::Failed),
            );
            let mut gaps = Vec::new();
            if !skipped.is_empty() {
                gaps.push(format!("skipped {}", skipped.join(", ")));
            }
            if !failed.is_empty() {
                gaps.push(format!("failed {}", failed.join(", ")));
            }
            let gaps = if gaps.is_empty() {
                "nothing skipped or failed".to_string()
            } else {
                gaps.join("; ")
            };
            lines.push(format!(
                "- {} ({} {}): {gaps}",
                clip(&item.title, 60),
                source_str(item.source_kind),
                item.occurred_at
                    .get(..10)
                    .unwrap_or(item.occurred_at.as_str())
            ));
        }
    }
    lines.push(
        "To change it: `show_lifecycle_proposal` with the FULL step list; on an existing step \
         omit rule/bindings/params to keep them."
            .into(),
    );
    clip(&lines.join("\n"), DESCRIBE_MAX_CHARS)
}
