//! KPI evaluation runner (docs/plans/kpi-driven-orchestration.md P3).
//!
//! Measures ACTIVE KPIs by their stored procedure and records the result into
//! `dev_kpi_measurements` (rolling `current_value`/`last_measured_at` forward
//! atomically via the repo). Two kinds are executed here:
//!
//! - `codebase` — run `measure_config.cmd` in the project root (bounded,
//!   shell-string, same trust level as everything else the teams run in that
//!   repo: the config was REVIEWED by the user at proposal-accept time) and
//!   parse one number out of the output via a named strategy.
//! - `derived`  — a WHITELISTED catalog of SQL metrics over the orchestrator's
//!   own DB, scoped to the project's team. Free-text SQL is deliberately not
//!   accepted: the catalog is the contract.
//!
//! `manual` KPIs are recorded from the drawer; `connector` KPIs measure via
//! the P6 onboarding (until then this module returns a clear error for them).
//! Persona executions can also record measurements directly through the
//! `{"kpi_measurement": {...}}` protocol message (parser + dispatch).

use std::collections::HashMap;

use crate::db::models::DevKpiMeasurement;
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Bound on a codebase measurement command (coverage runs are minutes).
const CODEBASE_CMD_TIMEOUT_SECS: u64 = 300;
/// Evidence stored with a measurement is the output TAIL (verdicts/summaries
/// land at the end), bounded to keep rows small.
const EVIDENCE_MAX_CHARS: usize = 2000;

/// Evaluate one KPI now. Returns the recorded measurement.
pub async fn evaluate_kpi(pool: &DbPool, kpi_id: &str) -> Result<DevKpiMeasurement, AppError> {
    let kpi = repo::get_kpi(pool, kpi_id)?;
    if kpi.status != "active" && kpi.status != "paused" {
        return Err(AppError::Validation(format!(
            "KPI '{}' is {} — only active/paused KPIs can be measured",
            kpi.name, kpi.status
        )));
    }
    let config: serde_json::Value = serde_json::from_str(&kpi.measure_config)
        .map_err(|e| AppError::Validation(format!("KPI measure_config is not valid JSON: {e}")))?;

    let (value, evidence) = match kpi.measure_kind.as_str() {
        "codebase" => {
            let project = repo::get_project_by_id(pool, &kpi.project_id)?;
            measure_codebase(&project.root_path, &config).await?
        }
        "derived" => measure_derived(pool, &kpi.project_id, &config)?,
        "manual" => {
            return Err(AppError::Validation(
                "Manual KPIs are recorded from the KPI drawer, not evaluated".into(),
            ))
        }
        "connector" => {
            // P6: replay the KPI's ACTIVE binding deterministically. A failed
            // replay flips the binding to `degraded` (visible on the KPI) —
            // never a silent procedure change.
            let Some(binding) = repo::active_kpi_binding(pool, kpi_id)? else {
                return Err(AppError::Validation(
                    "This connector KPI has no active binding — wire it via Connect".into(),
                ));
            };
            let procedure: crate::engine::kpi_binding::Procedure =
                serde_json::from_str(&binding.procedure).map_err(|e| {
                    AppError::Internal(format!("Stored binding procedure is corrupt: {e}"))
                })?;
            match crate::engine::kpi_binding::execute_procedure(pool, &binding.credential_id, &procedure)
                .await
            {
                Ok((value, evidence)) => {
                    if let Some(mt) = kpi
                        .metric_type
                        .as_deref()
                        .and_then(crate::engine::kpi_binding::metric_type)
                    {
                        crate::engine::kpi_binding::check_invariants(mt, value)?;
                    }
                    (value, evidence)
                }
                Err(e) => {
                    let _ = repo::set_kpi_binding_status(pool, &binding.id, "degraded");
                    return Err(AppError::Validation(format!(
                        "Binding replay failed (binding marked degraded — recompose from the KPI drawer): {e}"
                    )));
                }
            }
        }
        other => {
            return Err(AppError::Validation(format!("Unknown measure_kind '{other}'")))
        }
    };

    repo::record_kpi_measurement(pool, kpi_id, value, "evaluator", Some(&evidence), None)
}

/// Evaluate every ACTIVE KPI of the project whose cadence has elapsed
/// (daily > 24h, weekly > 7d since `last_measured_at`; never-measured = due;
/// `manual`/`connector` kinds are skipped). Returns (kpi name → result) for
/// the caller to surface; failures are per-KPI, never abort the batch.
pub async fn evaluate_due_kpis(
    pool: &DbPool,
    project_id: &str,
) -> Result<HashMap<String, Result<f64, String>>, AppError> {
    let kpis = repo::list_kpis(pool, project_id, Some("active"))?;
    let mut out = HashMap::new();
    for kpi in kpis {
        if !matches!(kpi.measure_kind.as_str(), "codebase" | "derived" | "connector") {
            continue;
        }
        let due = match (kpi.cadence.as_str(), kpi.last_measured_at.as_deref()) {
            (_, None) => true,
            ("daily", Some(last)) => hours_since(last) >= 24.0,
            ("weekly", Some(last)) => hours_since(last) >= 24.0 * 7.0,
            _ => false, // manual cadence — only explicit Measure-now
        };
        if !due {
            continue;
        }
        let result = evaluate_kpi(pool, &kpi.id)
            .await
            .map(|m| m.value)
            .map_err(|e| e.to_string());
        out.insert(kpi.name.clone(), result);
    }
    Ok(out)
}

fn hours_since(sqlite_ts: &str) -> f64 {
    let normalized = sqlite_ts.replace(' ', "T");
    let parsed = chrono::DateTime::parse_from_rfc3339(&normalized)
        .map(|t| t.with_timezone(&chrono::Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(&normalized, "%Y-%m-%dT%H:%M:%S")
                .map(|n| n.and_utc())
        });
    match parsed {
        Ok(t) => (chrono::Utc::now() - t).num_seconds() as f64 / 3600.0,
        Err(_) => f64::MAX, // unparseable timestamp → treat as due
    }
}

// =============================================================================
// codebase kind
// =============================================================================

async fn measure_codebase(
    root_path: &str,
    config: &serde_json::Value,
) -> Result<(f64, String), AppError> {
    let cmd = config
        .get("cmd")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Validation("codebase measure_config needs a 'cmd'".into()))?;
    let parse = config.get("parse").and_then(|v| v.as_str()).unwrap_or("regex:([\\d.]+)");

    let output = run_shell_bounded(root_path, cmd).await?;
    let value = parse_value(&output, parse).ok_or_else(|| {
        AppError::Validation(format!(
            "Measurement command ran but '{parse}' matched nothing in the output (tail: {})",
            tail(&output, 300)
        ))
    })?;
    let evidence = serde_json::json!({
        "cmd": cmd,
        "parse": parse,
        "output_tail": tail(&output, EVIDENCE_MAX_CHARS),
    })
    .to_string();
    Ok((value, evidence))
}

/// Run a shell command string in `cwd`, bounded, capturing stdout+stderr.
async fn run_shell_bounded(cwd: &str, cmd: &str) -> Result<String, AppError> {
    let mut command = if cfg!(windows) {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", cmd]);
        c
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", cmd]);
        c
    };
    command
        .current_dir(cwd)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let fut = command.output();
    let out = tokio::time::timeout(std::time::Duration::from_secs(CODEBASE_CMD_TIMEOUT_SECS), fut)
        .await
        .map_err(|_| {
            AppError::Internal(format!(
                "Measurement command timed out after {CODEBASE_CMD_TIMEOUT_SECS}s"
            ))
        })?
        .map_err(|e| AppError::Internal(format!("Failed to run measurement command: {e}")))?;

    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    if !out.stderr.is_empty() {
        text.push('\n');
        text.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    // Exit code is NOT a failure by itself: lint counters exit non-zero when
    // errors exist — which is exactly the number being measured.
    Ok(text)
}

fn tail(s: &str, max_chars: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    let start = chars.len().saturating_sub(max_chars);
    chars[start..].iter().collect()
}

/// Parse one number out of command output via a named strategy.
fn parse_value(output: &str, strategy: &str) -> Option<f64> {
    if strategy == "coverage_pct" {
        // Try the common text-summary shapes (istanbul/vitest/jest), in order.
        for pat in [
            r"Branches\s*:?\s*\|?\s*([\d.]+)\s*%",
            r"All files\s*\|\s*([\d.]+)",
            r"Statements\s*:?\s*\|?\s*([\d.]+)\s*%",
            r"Coverage[^\d]*([\d.]+)\s*%",
        ] {
            if let Some(v) = regex_first(output, pat) {
                return Some(v);
            }
        }
        return None;
    }
    if strategy == "count_lines" {
        return Some(output.lines().filter(|l| !l.trim().is_empty()).count() as f64);
    }
    if let Some(pat) = strategy.strip_prefix("regex:") {
        return regex_first(output, pat);
    }
    if let Some(path) = strategy.strip_prefix("json_path:") {
        // Walk the LAST parseable JSON line (tools print logs before the blob).
        for line in output.lines().rev() {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
                continue;
            };
            let mut cur = &v;
            for seg in path.split('.') {
                match cur.get(seg) {
                    Some(next) => cur = next,
                    None => break,
                }
            }
            if let Some(n) = cur.as_f64() {
                return Some(n);
            }
        }
        return None;
    }
    None
}

fn regex_first(output: &str, pat: &str) -> Option<f64> {
    let re = regex::Regex::new(pat).ok()?;
    re.captures(output)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<f64>().ok())
}

// =============================================================================
// derived kind — the whitelisted orchestrator-DB metric catalog
// =============================================================================

fn measure_derived(
    pool: &DbPool,
    project_id: &str,
    config: &serde_json::Value,
) -> Result<(f64, String), AppError> {
    let metric = config
        .get("metric")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Validation("derived measure_config needs a 'metric'".into()))?;
    let conn = pool.get()?;

    // All metrics are scoped to the project's team (dev_projects.team_id).
    let team_id: Option<String> = conn
        .query_row(
            "SELECT team_id FROM dev_projects WHERE id = ?1",
            rusqlite::params![project_id],
            |r| r.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("Project {project_id} not found")))?;
    let Some(team_id) = team_id else {
        return Err(AppError::Validation(
            "Derived KPIs need the project linked to a team".into(),
        ));
    };

    let (value, basis): (f64, String) = match metric {
        // QA bounces / QA-step completions, last 7 days, as a percentage.
        "qa_bounce_rate" => {
            let bounces: f64 = conn.query_row(
                "SELECT COUNT(*) FROM team_assignment_events e
                 JOIN team_assignments a ON a.id = e.assignment_id
                 WHERE a.team_id = ?1 AND e.kind = 'qa_changes_requested_rework'
                   AND datetime(e.created_at) > datetime('now','-7 days')",
                rusqlite::params![team_id], |r| r.get(0))?;
            let merges: f64 = conn.query_row(
                "SELECT COUNT(*) FROM team_assignment_steps s
                 JOIN team_assignments a ON a.id = s.assignment_id
                 WHERE a.team_id = ?1 AND s.status = 'done'
                   AND LOWER(s.title) LIKE '%merge%'
                   AND datetime(s.completed_at) > datetime('now','-7 days')",
                rusqlite::params![team_id], |r| r.get(0))?;
            let rate = if bounces + merges > 0.0 { bounces / (bounces + merges) * 100.0 } else { 0.0 };
            (rate, format!("bounces={bounces} cleanMerges={merges} window=7d"))
        }
        // Failed / total executions of the team's members, last 7 days, %.
        "exec_failure_rate" => {
            let (failed, total): (f64, f64) = conn.query_row(
                "SELECT SUM(CASE WHEN e.status='failed' THEN 1 ELSE 0 END),
                        COUNT(*)
                 FROM persona_executions e
                 JOIN persona_team_members m ON m.persona_id = e.persona_id AND m.team_id = ?1
                 WHERE datetime(e.created_at) > datetime('now','-7 days')",
                rusqlite::params![team_id], |r| Ok((r.get::<_, Option<f64>>(0)?.unwrap_or(0.0), r.get(1)?)))?;
            let rate = if total > 0.0 { failed / total * 100.0 } else { 0.0 };
            (rate, format!("failed={failed} total={total} window=7d"))
        }
        // Open incidents attributed to the team's personas (a level, not a rate).
        "incident_rate" => {
            let n: f64 = conn.query_row(
                "SELECT COUNT(*) FROM audit_incidents i
                 WHERE i.status NOT IN ('resolved','dismissed')
                   AND i.persona_id IN (SELECT persona_id FROM persona_team_members WHERE team_id = ?1)",
                rusqlite::params![team_id], |r| r.get(0))?;
            (n, "open incidents for team personas".into())
        }
        // Age in days of the OLDEST currently-parked awaiting_review assignment.
        "parked_review_age_days" => {
            let days: Option<f64> = conn.query_row(
                "SELECT MAX(julianday('now') - julianday(datetime(created_at)))
                 FROM team_assignments
                 WHERE team_id = ?1 AND status = 'awaiting_review'",
                rusqlite::params![team_id], |r| r.get(0))?;
            (days.unwrap_or(0.0), "oldest parked awaiting_review assignment".into())
        }
        other => {
            return Err(AppError::Validation(format!(
                "Unknown derived metric '{other}'. Catalog: qa_bounce_rate, \
                 exec_failure_rate, incident_rate, parked_review_age_days"
            )))
        }
    };

    let evidence = serde_json::json!({ "metric": metric, "basis": basis }).to_string();
    Ok(((value * 100.0).round() / 100.0, evidence))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coverage_pct_prefers_branches_in_vitest_text_summary() {
        let out = "Statements   : 61.2% ( 100/163 )\nBranches     : 51.93% ( 67/129 )\n";
        assert_eq!(parse_value(out, "coverage_pct"), Some(51.93));
    }

    #[test]
    fn coverage_pct_matches_istanbul_table() {
        let out = "File      | % Stmts | % Branch\nAll files |   72.41 |    61.9\n";
        assert_eq!(parse_value(out, "coverage_pct"), Some(72.41));
    }

    #[test]
    fn regex_strategy_first_capture() {
        let out = "scanning...\n17 errors, 4 warnings\n";
        assert_eq!(parse_value(out, r"regex:(\d+) error"), Some(17.0));
    }

    #[test]
    fn json_path_walks_last_json_line() {
        let out = "log noise\n{\"total\":{\"pct\":83.5}}\n";
        assert_eq!(parse_value(out, "json_path:total.pct"), Some(83.5));
    }

    #[test]
    fn count_lines_skips_blanks() {
        assert_eq!(parse_value("a\n\nb\n", "count_lines"), Some(2.0));
    }

    #[test]
    fn unknown_strategy_is_none() {
        assert_eq!(parse_value("anything", "bogus"), None);
    }
}
