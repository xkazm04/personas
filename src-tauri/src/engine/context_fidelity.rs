//! Graded context-passing between pipeline nodes (fabro "fidelity" lesson, F3).
//!
//! Personas pipelines spawn a fresh `claude -p` per node. Today `resolve_node_input`
//! passes only the **single latest predecessor's** raw output as `pipeline_input` —
//! so a fan-in node (multiple predecessors) silently loses every upstream output but
//! one, and a downstream node never sees a compact picture of what ran before it.
//!
//! This module builds a deterministic (no extra LLM call) `## Upstream Context`
//! preamble from ALL of a node's completed predecessors, at a configurable fidelity.
//! The preamble is attached to the node-input JSON as `upstream_context`, alongside
//! the existing `pipeline_input` / `team_memory_context` fields, so the agent sees it.

use std::str::FromStr;

use crate::db::DbPool;

/// Settings key for the pipeline-wide default fidelity.
pub const PIPELINE_CONTEXT_FIDELITY_KEY: &str = "pipeline_context_fidelity";

/// How much upstream context to inject into a node's prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextFidelity {
    /// Full prior outputs, capped to keep prompts bounded.
    Full,
    /// Generous per-node summaries (~50 lines total).
    SummaryHigh,
    /// Moderate summaries (~25 lines total).
    SummaryMedium,
    /// Terse summaries (~12 lines total).
    SummaryLow,
    /// Default: nested-bullet compact view (~25 lines total).
    Compact,
    /// Labels + status only — no output bodies.
    Truncate,
}

impl Default for ContextFidelity {
    fn default() -> Self {
        Self::Compact
    }
}

impl FromStr for ContextFidelity {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "full" => Ok(Self::Full),
            "summary:high" | "summary_high" | "high" => Ok(Self::SummaryHigh),
            "summary:medium" | "summary_medium" | "medium" => Ok(Self::SummaryMedium),
            "summary:low" | "summary_low" | "low" => Ok(Self::SummaryLow),
            "compact" => Ok(Self::Compact),
            "truncate" | "none" => Ok(Self::Truncate),
            _ => Err(()),
        }
    }
}

impl ContextFidelity {
    /// Total line budget for the whole preamble across all upstream nodes.
    fn total_line_budget(self) -> usize {
        match self {
            Self::Full => 400,
            Self::SummaryHigh => 50,
            Self::SummaryMedium | Self::Compact => 25,
            Self::SummaryLow => 12,
            Self::Truncate => 0,
        }
    }
}

/// One completed (or failed) upstream node feeding the current node.
pub struct UpstreamOutput {
    pub label: String,
    pub status: String,
    pub output: Option<String>,
}

/// Resolve the pipeline-wide fidelity from settings (default `Compact`).
pub fn resolve_pipeline_fidelity(db: &DbPool) -> ContextFidelity {
    crate::db::repos::core::settings::get(db, PIPELINE_CONTEXT_FIDELITY_KEY)
        .ok()
        .flatten()
        .and_then(|v| ContextFidelity::from_str(&v).ok())
        .unwrap_or_default()
}

/// Build the `## Upstream Context` markdown block from a node's predecessors.
/// Returns `None` when there is nothing to inject (no upstream, or `Truncate`
/// with no statuses worth listing).
#[must_use]
pub fn build_upstream_preamble(upstream: &[UpstreamOutput], fidelity: ContextFidelity) -> Option<String> {
    if upstream.is_empty() {
        return None;
    }

    let mut out = String::from("## Upstream Context\nResults from earlier pipeline steps:\n");

    // Truncate: one line per node, no bodies.
    if fidelity == ContextFidelity::Truncate {
        for u in upstream {
            out.push_str(&format!("- {} ({})\n", u.label, u.status));
        }
        return Some(out);
    }

    let total_budget = fidelity.total_line_budget();
    // Divide the budget across nodes, min 2 body lines each so every node shows something.
    let per_node = (total_budget / upstream.len().max(1)).max(2);
    let mut used = 0usize;

    for u in upstream {
        out.push_str(&format!("### {} ({})\n", u.label, u.status));
        let Some(body) = u.output.as_deref() else {
            out.push_str("- (no output)\n");
            continue;
        };
        let lines: Vec<&str> = body.lines().filter(|l| !l.trim().is_empty()).collect();
        let take = per_node.min(total_budget.saturating_sub(used)).max(0);
        if take == 0 {
            out.push_str("- …(truncated)\n");
            break;
        }
        for line in lines.iter().take(take) {
            // Cap each line so one long line can't blow the prompt.
            let trimmed = truncate_chars(line.trim(), 240);
            out.push_str("- ");
            out.push_str(&trimmed);
            out.push('\n');
            used += 1;
        }
        if lines.len() > take {
            out.push_str(&format!("- …(+{} more lines)\n", lines.len() - take));
        }
        if used >= total_budget {
            break;
        }
    }

    Some(out)
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut t: String = s.chars().take(max).collect();
    t.push('…');
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    fn up(label: &str, status: &str, output: Option<&str>) -> UpstreamOutput {
        UpstreamOutput {
            label: label.to_string(),
            status: status.to_string(),
            output: output.map(str::to_string),
        }
    }

    #[test]
    fn empty_upstream_yields_none() {
        assert!(build_upstream_preamble(&[], ContextFidelity::Compact).is_none());
    }

    #[test]
    fn truncate_lists_labels_only() {
        let u = vec![up("plan", "succeeded", Some("lots\nof\ndetail"))];
        let p = build_upstream_preamble(&u, ContextFidelity::Truncate).unwrap();
        assert!(p.contains("- plan (succeeded)"));
        assert!(!p.contains("lots"), "truncate leaked body: {p}");
    }

    #[test]
    fn fan_in_includes_all_predecessors() {
        // The core F3 win: multiple predecessors all appear (today all but one are dropped).
        let u = vec![
            up("security", "succeeded", Some("no vulns found")),
            up("perf", "succeeded", Some("two hot loops")),
            up("style", "failed", None),
        ];
        let p = build_upstream_preamble(&u, ContextFidelity::Compact).unwrap();
        assert!(p.contains("security"));
        assert!(p.contains("perf"));
        assert!(p.contains("style"));
        assert!(p.contains("no vulns found"));
        assert!(p.contains("two hot loops"));
        assert!(p.contains("(no output)"), "failed node not marked: {p}");
    }

    #[test]
    fn compact_respects_line_budget() {
        let big = (0..200).map(|i| format!("line{i}")).collect::<Vec<_>>().join("\n");
        let u = vec![up("noisy", "succeeded", Some(&big))];
        let p = build_upstream_preamble(&u, ContextFidelity::Compact).unwrap();
        let body_lines = p.lines().filter(|l| l.starts_with("- ")).count();
        assert!(body_lines <= 26, "compact exceeded budget: {body_lines} lines");
        assert!(p.contains("more lines"), "no truncation marker: {p}");
    }

    #[test]
    fn fidelity_parses_aliases() {
        assert_eq!(ContextFidelity::from_str("summary:high"), Ok(ContextFidelity::SummaryHigh));
        assert_eq!(ContextFidelity::from_str("COMPACT"), Ok(ContextFidelity::Compact));
        assert_eq!(ContextFidelity::from_str("garbage"), Err(()));
    }
}
