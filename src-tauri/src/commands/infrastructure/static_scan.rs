//! Static-analysis idea source — sibling to LLM-driven `idea_scanner.rs`.
//!
//! Spawns a configured static-analysis CLI (e.g. Fallow, Knip, jscpd) inside
//! a dev-tools project's working directory, captures its JSON output, and
//! writes findings as `DevIdea` records via the existing repo. The runner is
//! deterministic, zero-LLM, and intentionally read-only — this surface
//! observes; the existing task runner executes any fix.
//!
//! The tool dispatcher accepts multiple parser shapes; today only Fallow is
//! wired with a permissive parser. To add a new tool, add a variant to
//! `StaticScanTool`, a slug in `tool_slug`, and a parser in `parse_tool_output`.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use tokio::process::Command;
use ts_rs::TS;

use crate::db::models::DevProject;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// ============================================================================
// Public types
// ============================================================================

/// Tools the runner knows how to spawn and parse. Adding a variant requires a
/// matching arm in `tool_slug` and `parse_tool_output`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum StaticScanTool {
    Fallow,
    Knip,
    Jscpd,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StaticScanConfig {
    pub tool: StaticScanTool,
    /// Argv passed to the spawned process. The first element is the executable
    /// (typically `npx`); the rest are its arguments. Personas does NOT inject
    /// any flags — the user is responsible for passing whatever the chosen
    /// tool needs to produce parseable JSON output.
    pub command: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StaticScanResult {
    pub scan_id: String,
    pub project_id: String,
    pub tool: String,
    pub ideas_created: i32,
    pub stderr: Option<String>,
    pub raw_output_excerpt: Option<String>,
}

// ============================================================================
// Tauri commands
// ============================================================================

#[tauri::command]
pub async fn dev_tools_set_static_scan_config(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    config: Option<StaticScanConfig>,
) -> Result<DevProject, AppError> {
    require_auth(&state).await?;
    let json_str = match config {
        Some(c) => Some(serde_json::to_string(&c)?),
        None => None,
    };
    repo::update_static_scan_config(&state.db, &project_id, json_str.as_deref())
}

#[tauri::command]
pub async fn dev_tools_run_static_scan(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    config_override: Option<StaticScanConfig>,
) -> Result<StaticScanResult, AppError> {
    require_auth(&state).await?;

    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let config = resolve_config(&project, config_override)?;

    let exe = config.command.first().ok_or_else(|| {
        AppError::Validation("Static scan command must have at least one argv element".into())
    })?;
    let args: Vec<String> = config.command.iter().skip(1).cloned().collect();

    let output = Command::new(exe)
        .args(&args)
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to spawn {exe}: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_str = if output.stderr.is_empty() {
        None
    } else {
        Some(String::from_utf8_lossy(&output.stderr).to_string())
    };

    let findings = parse_tool_output(config.tool, &stdout)?;

    let scan_type = format!("static:{}", tool_slug(config.tool));
    let scan = repo::create_scan(&state.db, Some(&project_id), &scan_type, Some("running"))?;

    let mut ideas_created: i32 = 0;
    for f in &findings {
        repo::create_idea(
            &state.db,
            Some(&project_id),
            None,
            &scan_type,
            Some("technical"),
            &f.title,
            f.description.as_deref(),
            f.reasoning.as_deref(),
            None,
            f.effort,
            f.impact,
            f.risk,
            None,
            None,
        )?;
        ideas_created += 1;
    }

    let _ = repo::update_scan(
        &state.db,
        &scan.id,
        Some("complete"),
        Some(ideas_created),
        None,
        None,
        None,
        None,
    );

    let raw_output_excerpt = if stdout.is_empty() {
        None
    } else if stdout.len() > 4096 {
        Some(format!("{}…", &stdout[..4096]))
    } else {
        Some(stdout)
    };

    Ok(StaticScanResult {
        scan_id: scan.id,
        project_id,
        tool: tool_slug(config.tool).to_string(),
        ideas_created,
        stderr: stderr_str,
        raw_output_excerpt,
    })
}

// ============================================================================
// Internals
// ============================================================================

fn tool_slug(tool: StaticScanTool) -> &'static str {
    match tool {
        StaticScanTool::Fallow => "fallow",
        StaticScanTool::Knip => "knip",
        StaticScanTool::Jscpd => "jscpd",
    }
}

fn resolve_config(
    project: &DevProject,
    override_config: Option<StaticScanConfig>,
) -> Result<StaticScanConfig, AppError> {
    if let Some(c) = override_config {
        return Ok(c);
    }
    if let Some(json) = &project.static_scan_config {
        return serde_json::from_str(json)
            .map_err(|e| AppError::Validation(format!("Invalid static_scan_config JSON: {e}")));
    }
    Err(AppError::Validation(
        "No static_scan_config set on this project. Configure one or pass an override.".into(),
    ))
}

#[derive(Debug, Clone)]
struct Finding {
    title: String,
    description: Option<String>,
    reasoning: Option<String>,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
}

fn parse_tool_output(tool: StaticScanTool, stdout: &str) -> Result<Vec<Finding>, AppError> {
    match tool {
        StaticScanTool::Fallow => Ok(parse_fallow(stdout)),
        StaticScanTool::Knip | StaticScanTool::Jscpd => Err(AppError::Internal(format!(
            "Parser for tool {} is not yet implemented.",
            tool_slug(tool)
        ))),
    }
}

/// Permissive parser for Fallow's JSON output. Looks at multiple known shapes:
/// top-level `findings`/`issues`/`results` arrays, per-command keys
/// (`dead_code`, `duplications`, `boundary_violations`), and bare arrays.
/// Unknown shapes safely yield zero findings rather than failing, so a tool
/// schema change doesn't break the runner — the user gets an empty result and
/// can inspect `raw_output_excerpt` to diagnose.
fn parse_fallow(stdout: &str) -> Vec<Finding> {
    let value: Value = serde_json::from_str(stdout.trim()).unwrap_or(Value::Null);
    let mut out: Vec<Finding> = Vec::new();
    let known_keys = [
        "findings",
        "issues",
        "results",
        "dead_code",
        "duplications",
        "boundary_violations",
    ];
    match &value {
        Value::Object(map) => {
            for k in known_keys {
                if let Some(arr) = map.get(k).and_then(|v| v.as_array()) {
                    for item in arr {
                        out.push(item_to_finding(item, k));
                    }
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                out.push(item_to_finding(item, "fallow"));
            }
        }
        _ => {}
    }
    out
}

fn item_to_finding(v: &Value, source_key: &str) -> Finding {
    let title_raw = v
        .get("title")
        .or_else(|| v.get("message"))
        .or_else(|| v.get("name"))
        .and_then(|x| x.as_str())
        .unwrap_or("Static-analysis finding")
        .to_string();
    let file = v
        .get("file")
        .or_else(|| v.get("path"))
        .or_else(|| v.get("filePath"))
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let line = v
        .get("line")
        .or_else(|| v.get("lineNumber"))
        .and_then(|x| x.as_i64());

    let title = if !file.is_empty() {
        if let Some(l) = line {
            format!("[{source_key}] {title_raw} ({file}:{l})")
        } else {
            format!("[{source_key}] {title_raw} ({file})")
        }
    } else {
        format!("[{source_key}] {title_raw}")
    };

    let description = v
        .get("description")
        .or_else(|| v.get("details"))
        .or_else(|| v.get("rationale"))
        .and_then(|x| x.as_str())
        .map(str::to_string);

    let reasoning = v
        .get("reasoning")
        .or_else(|| v.get("evidence"))
        .or_else(|| v.get("snippet"))
        .and_then(|x| x.as_str())
        .map(str::to_string);

    let confidence = v
        .get("confidence")
        .or_else(|| v.get("score"))
        .and_then(|x| x.as_f64())
        .unwrap_or(0.5);
    let impact = ((confidence * 6.0) + 2.0).round().clamp(1.0, 10.0) as i32;
    let effort = if source_key.contains("dupli") || source_key.contains("boundary") {
        4
    } else {
        2
    };
    let risk = 2;

    Finding {
        title,
        description,
        reasoning,
        effort: Some(effort),
        impact: Some(impact),
        risk: Some(risk),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_fallow_findings_object() {
        let stdout = r#"{"findings":[{"file":"src/foo.ts","line":42,"title":"Unused export","confidence":0.9}]}"#;
        let findings = parse_fallow(stdout);
        assert_eq!(findings.len(), 1);
        assert!(findings[0].title.contains("src/foo.ts:42"));
        assert_eq!(findings[0].risk, Some(2));
    }

    #[test]
    fn parse_fallow_per_command_shape() {
        let stdout = r#"{"dead_code":[{"path":"a.ts","title":"unused"}],"duplications":[{"file":"b.ts","title":"dup"}]}"#;
        let findings = parse_fallow(stdout);
        assert_eq!(findings.len(), 2);
        // Dupes get effort 4; dead_code gets effort 2.
        let dup = findings.iter().find(|f| f.title.contains("dup")).unwrap();
        let dead = findings.iter().find(|f| f.title.contains("unused")).unwrap();
        assert_eq!(dup.effort, Some(4));
        assert_eq!(dead.effort, Some(2));
    }

    #[test]
    fn parse_fallow_array() {
        let stdout = r#"[{"file":"x.ts","title":"a"},{"file":"y.ts","title":"b"}]"#;
        let findings = parse_fallow(stdout);
        assert_eq!(findings.len(), 2);
    }

    #[test]
    fn parse_fallow_empty_or_unknown_safely_yields_zero() {
        assert_eq!(parse_fallow("").len(), 0);
        assert_eq!(parse_fallow("{}").len(), 0);
        assert_eq!(parse_fallow(r#"{"unknown_shape":[1,2,3]}"#).len(), 0);
    }

    #[test]
    fn impact_clamps_within_range() {
        let v: Value =
            serde_json::from_str(r#"{"file":"a.ts","title":"t","confidence":2.0}"#).unwrap();
        let f = item_to_finding(&v, "findings");
        assert!(f.impact.unwrap() <= 10);
        assert!(f.impact.unwrap() >= 1);
    }
}
