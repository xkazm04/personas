//! Direction 10 — rule-based pattern extraction over completed fleet
//! operations.
//!
//! Reads recently-landed `fleet-orchestration op:…` episodes (written
//! by `reconcile_if_dispatched`), groups them by role-combination, and
//! emits low-confidence procedurals capturing the empirical
//! success-rate signal. The output is *not* novel reasoning — it's
//! just counting — but it gives Athena a recall-able pattern in her
//! procedural memory that she can weight on the next dispatch.
//!
//! ## Why rule-based, not LLM-synthesized
//!
//! v1 is deliberately mechanical:
//!   - Cheap to run (one DB scan + file reads, no LLM call).
//!   - Predictable output (counts don't hallucinate; an LLM might).
//!   - Easy to dismiss in the brain viewer if the user disagrees with
//!     a pattern's framing.
//! v2 can layer LLM synthesis on top: pull the role-combo + sample
//! episodes into a prompt and ask claude for a richer "what worked /
//! what didn't" narrative. The substrate this module lays down — the
//! episode index, the role-combo aggregator, the sources list — is
//! reusable in that v2.
//!
//! ## Inputs
//!
//! Reconciler's marker shape:
//! ```text
//! fleet-orchestration op:<op_id> state:op_completed|op_failed intent:<text>
//!
//! Operation **<intent>** completed — 2/2 sessions exited, 0 with failures.
//! - `<id8>` (writer) [exited] — <intent> · <summary>
//! - `<id8>` (runner) [exited] — <intent> · <summary>
//! Files touched across all sessions: …
//! ```
//!
//! We parse the marker line for op_id + status, then the bullets for
//! roles (the `(role)` paren-block on each bullet line).

use std::collections::BTreeMap;
use std::fs;

use chrono::Utc;
use rusqlite::params;

use crate::companion::brain::procedural::{
    write_rule, ProceduralInput, ProceduralScope,
};
use crate::companion::disk;
use crate::db::UserDbPool;
use crate::error::AppError;

/// How far back to look. Beyond this, samples are too stale to
/// represent the current orchestration shape.
const LOOKBACK_DAYS: i64 = 30;

/// Cap on episodes scanned per extraction pass. Keeps the disk-read
/// cost bounded.
const MAX_EPISODES: usize = 200;

/// Minimum sample count before a role-combo earns a procedural. With
/// fewer than three runs the success rate is too noisy to trust.
const MIN_SAMPLES: usize = 3;

/// What a single completed-op episode contributes to the aggregation.
#[derive(Debug, Clone)]
struct ParsedOpEpisode {
    episode_id: String,
    /// Sorted, deduped roles. Key shape for the role-combo bucket.
    roles: Vec<String>,
    status: OpStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpStatus {
    Completed,
    Failed,
}

/// Aggregated stats per role combination.
#[derive(Debug, Default)]
struct RoleComboStats {
    total: usize,
    completed: usize,
    failed: usize,
    /// Source episode ids — required by the procedural's anti-
    /// hallucination contract (every rule cites ≥1 source episode).
    /// Bounded at 10 newest so the procedural sidecar doesn't get
    /// huge.
    episode_ids: Vec<String>,
}

/// Run the extraction pass. Returns the ids of any procedurals
/// written. Idempotent — `write_rule` mints a new id each call, but
/// the procedural list_rules surface doesn't dedupe, so re-running
/// this WILL append duplicate rules. v2 can wire a supersedes_id
/// chain based on trigger-string matching; for now we let the user
/// prune in the brain viewer.
pub fn extract_patterns(pool: &UserDbPool) -> Result<Vec<String>, AppError> {
    let episodes = recent_orchestration_episodes(pool)?;
    let parsed: Vec<ParsedOpEpisode> = episodes
        .iter()
        .filter_map(|(id, body)| parse_episode(id, body))
        .collect();

    if parsed.len() < MIN_SAMPLES {
        tracing::debug!(
            "fleet_patterns: only {} parsable ops in last {} days, skipping",
            parsed.len(),
            LOOKBACK_DAYS,
        );
        return Ok(Vec::new());
    }

    let aggregates = aggregate_by_role_combo(&parsed);
    let mut written = Vec::new();
    for (role_combo_label, stats) in &aggregates {
        if stats.total < MIN_SAMPLES {
            continue;
        }
        let success_rate = stats.completed as f32 / stats.total as f32;
        let importance = if success_rate >= 0.9 {
            3
        } else if success_rate >= 0.7 {
            2
        } else {
            1
        };
        let trigger = format!(
            "When dispatching fleet sessions with roles {role_combo_label}"
        );
        let behavior = format!(
            "Recent track record in the last {LOOKBACK_DAYS} days: \
{completed}/{total} ops completed cleanly ({rate:.0}% success rate); \
{failed} hit failures. {hint}",
            completed = stats.completed,
            total = stats.total,
            failed = stats.failed,
            rate = success_rate * 100.0,
            hint = hint_for_rate(success_rate),
        );
        // Cite at most the newest 10 episodes — keeps the provenance
        // section of the procedural readable.
        let sources: Vec<String> =
            stats.episode_ids.iter().take(10).cloned().collect();
        match write_rule(
            pool,
            &ProceduralInput {
                scope: ProceduralScope::Action,
                trigger: &trigger,
                behavior: &behavior,
                sources: &sources,
                importance,
                confidence: 0.3, // low — rule-based, no LLM verification
                supersedes_id: None,
            },
        ) {
            Ok(id) => written.push(id),
            Err(e) => tracing::warn!(
                role_combo = %role_combo_label,
                error = %e,
                "fleet_patterns: write_rule failed"
            ),
        }
    }
    if !written.is_empty() {
        tracing::info!(
            count = written.len(),
            "fleet_patterns: wrote procedurals from {} ops",
            parsed.len(),
        );
    }
    Ok(written)
}

fn hint_for_rate(rate: f32) -> &'static str {
    if rate >= 0.9 {
        "Strong fit — keep using this role combination for similar tasks."
    } else if rate >= 0.7 {
        "Usually works; the failed cases are worth reviewing for shared root cause."
    } else if rate >= 0.4 {
        "Mixed results. Consider redirecting mid-flight or breaking the work into smaller dispatches."
    } else {
        "Frequently failing in this configuration. Try a different role mix before dispatching again."
    }
}

/// Pull recent system episodes whose body starts with the
/// `fleet-orchestration op:` marker. We rely on the body_excerpt
/// (first 500 chars) for the cheap pre-filter, then read the full
/// body from disk for parsing.
fn recent_orchestration_episodes(
    pool: &UserDbPool,
) -> Result<Vec<(String, String)>, AppError> {
    let conn = pool.get()?;
    let cutoff = Utc::now()
        .checked_sub_signed(chrono::Duration::days(LOOKBACK_DAYS))
        .map(|t| t.to_rfc3339())
        .unwrap_or_default();
    let mut stmt = conn.prepare(
        "SELECT id, file_path, body_excerpt
         FROM companion_node
         WHERE kind = 'episode'
           AND body_excerpt LIKE 'fleet-orchestration op:%'
           AND created_at >= ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![cutoff, MAX_EPISODES as i64], |row| {
            let id: String = row.get(0)?;
            let file_path: String = row.get(1)?;
            let excerpt: String = row.get(2)?;
            Ok((id, file_path, excerpt))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let root = disk::brain_root()?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, rel_path, excerpt) in rows {
        // Use the full file when we can; fall back to excerpt only.
        // Either way the marker line is on line 1 of the body, so the
        // role parser will find the bullets in the rest.
        let body = match fs::read_to_string(root.join(&rel_path)) {
            Ok(s) => s,
            Err(_) => excerpt,
        };
        out.push((id, body));
    }
    Ok(out)
}

fn parse_episode(episode_id: &str, body: &str) -> Option<ParsedOpEpisode> {
    let mut lines = body.lines();
    // Skip frontmatter / role header until we find the marker line.
    let marker_line = lines.find(|l| l.contains("fleet-orchestration op:"))?;
    let status = if marker_line.contains("state:op_completed") {
        OpStatus::Completed
    } else if marker_line.contains("state:op_failed") {
        OpStatus::Failed
    } else {
        // op_active or unknown — only finalized ops contribute.
        return None;
    };

    // Roles appear in bullet lines as "- `<id8>` (role) [state] …".
    // We grep `(<role>)` patterns from every line after the marker.
    let mut roles: Vec<String> = Vec::new();
    for line in lines {
        if let Some(r) = extract_role(line) {
            roles.push(r);
        }
    }
    if roles.is_empty() {
        return None;
    }
    roles.sort();
    roles.dedup();
    Some(ParsedOpEpisode {
        episode_id: episode_id.to_string(),
        roles,
        status,
    })
}

/// Pull a "(role)" token out of a per-session bullet line. Format:
/// `- \`<id8>\` (writer) [exited] — intent · summary`
fn extract_role(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('-') {
        return None;
    }
    // Find first `(...)` after the session-id backtick block.
    let open = trimmed.find('(')?;
    let close = trimmed[open..].find(')').map(|i| open + i)?;
    let role = trimmed[open + 1..close].trim();
    if role.is_empty() || role.contains(char::is_whitespace) {
        // Heuristic: real roles are single tokens ("writer", "runner",
        // "tests-a"). Skip parenthesised text that's clearly prose
        // ("(if any)", "(see above)") to avoid noise.
        return None;
    }
    Some(role.to_string())
}

fn aggregate_by_role_combo(
    parsed: &[ParsedOpEpisode],
) -> BTreeMap<String, RoleComboStats> {
    let mut buckets: BTreeMap<String, RoleComboStats> = BTreeMap::new();
    for op in parsed {
        let key = format_role_combo(&op.roles);
        let entry = buckets.entry(key).or_default();
        entry.total += 1;
        match op.status {
            OpStatus::Completed => entry.completed += 1,
            OpStatus::Failed => entry.failed += 1,
        }
        entry.episode_ids.push(op.episode_id.clone());
    }
    buckets
}

fn format_role_combo(roles: &[String]) -> String {
    if roles.len() == 1 {
        format!("`{}`", roles[0])
    } else {
        // Already sorted by parse_episode → stable key across passes.
        let quoted: Vec<String> = roles.iter().map(|r| format!("`{r}`")).collect();
        quoted.join(" + ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep(id: &str, status: &str, body_after_marker: &str) -> (String, String) {
        let marker = format!("fleet-orchestration op:opfoo state:{status} intent:something");
        let body = format!("{marker}\n\n{body_after_marker}");
        (id.to_string(), body)
    }

    #[test]
    fn parses_completed_op_with_two_roles() {
        let (id, body) = ep(
            "ep1",
            "op_completed",
            "Operation **X** completed — 2/2.\n- `aaaa` (writer) [exited] — …\n- `bbbb` (runner) [exited] — …\n",
        );
        let p = parse_episode(&id, &body).unwrap();
        assert_eq!(p.status, OpStatus::Completed);
        assert_eq!(p.roles, vec!["runner".to_string(), "writer".to_string()]);
    }

    #[test]
    fn skips_active_ops() {
        let (id, body) = ep(
            "ep_active",
            "op_active",
            "- `aa` (writer) [running]\n",
        );
        assert!(parse_episode(&id, &body).is_none());
    }

    #[test]
    fn extract_role_ignores_prose_parens() {
        assert_eq!(extract_role("- `abcd` (writer) [exited]"), Some("writer".into()));
        assert_eq!(extract_role("- `abcd` (if any) note"), None);
        assert_eq!(extract_role("Files touched across all sessions: foo.rs"), None);
    }

    #[test]
    fn aggregates_role_combos_correctly() {
        let parsed = vec![
            ParsedOpEpisode {
                episode_id: "e1".into(),
                roles: vec!["runner".into(), "writer".into()],
                status: OpStatus::Completed,
            },
            ParsedOpEpisode {
                episode_id: "e2".into(),
                roles: vec!["runner".into(), "writer".into()],
                status: OpStatus::Completed,
            },
            ParsedOpEpisode {
                episode_id: "e3".into(),
                roles: vec!["runner".into(), "writer".into()],
                status: OpStatus::Failed,
            },
            ParsedOpEpisode {
                episode_id: "e4".into(),
                roles: vec!["inspector".into()],
                status: OpStatus::Completed,
            },
        ];
        let agg = aggregate_by_role_combo(&parsed);
        let pair = agg.get("`runner` + `writer`").unwrap();
        assert_eq!(pair.total, 3);
        assert_eq!(pair.completed, 2);
        assert_eq!(pair.failed, 1);
        let solo = agg.get("`inspector`").unwrap();
        assert_eq!(solo.total, 1);
    }

    #[test]
    fn hint_thresholds() {
        assert!(hint_for_rate(0.95).contains("Strong fit"));
        assert!(hint_for_rate(0.75).contains("Usually works"));
        assert!(hint_for_rate(0.50).contains("Mixed results"));
        assert!(hint_for_rate(0.20).contains("Frequently failing"));
    }
}
