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
    /// Impeccable's design anti-pattern detector (`npx impeccable detect --json`).
    /// The only *design* sensor in this lane — every other tool here reports code
    /// hygiene. Zero-LLM, zero-dependency, ~5s over a 1200-component tree.
    Impeccable,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
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

    // Insert findings one at a time, mirroring `idea_scanner`'s log-and-continue
    // discipline: a single failed insert (constraint violation, busy lock) must
    // NOT abort the whole command via `?`. The trailing `?` here used to strand
    // the scan row in 'running' forever, next to a half-written idea set that is
    // impossible to reconcile by hand. We persist what we can, count failures,
    // and always drive the scan to a terminal status below.
    let mut ideas_created: i32 = 0;
    let mut ideas_deduped: i32 = 0;
    let mut insert_failures: u32 = 0;
    for f in &findings {
        // Static tools are deterministic: re-running one over unchanged code
        // re-emits byte-identical findings. The dedup gate
        // (docs/plans/backlog-memory-loop.md Phase 1) is what keeps a second run
        // from cloning the whole backlog.
        let dedup_key = repo::scan_dedup_key(&scan_type, None, &f.title);
        match repo::create_idea_deduped(
            &state.db,
            &project_id,
            None,
            &scan_type,
            Some("technical"),
            &f.title,
            f.description.as_deref(),
            f.reasoning.as_deref(),
            f.effort,
            f.impact,
            f.risk,
            None,
            None,
            &dedup_key,
        ) {
            Ok(Some(_)) => ideas_created += 1,
            Ok(None) => ideas_deduped += 1,
            Err(e) => {
                insert_failures += 1;
                tracing::warn!(error = %e, title = %f.title, "static scan: failed to persist finding");
            }
        }
    }
    if ideas_deduped > 0 {
        tracing::info!(
            project_id = %project_id,
            suppressed = ideas_deduped,
            "static scan: suppressed findings already in the backlog"
        );
    }

    // Guarantee a terminal status so the UI never polls a stuck 'running' scan.
    // A partial write (some findings failed to persist) is surfaced as 'error'
    // with detail rather than silently reported as 'complete' — that partial,
    // un-reconcilable state is exactly what this guard exists to expose.
    let (scan_status, error_detail) = if insert_failures == 0 {
        ("complete", None)
    } else {
        (
            "error",
            Some(format!(
                "{insert_failures} of {} findings failed to persist; {ideas_created} saved",
                findings.len()
            )),
        )
    };
    let _ = repo::update_scan(
        &state.db,
        &scan.id,
        Some(scan_status),
        Some(ideas_created),
        None,
        None,
        None,
        Some(error_detail.as_deref()),
    );

    let raw_output_excerpt = if stdout.is_empty() {
        None
    } else if stdout.len() > 4096 {
        Some(format!("{}…", crate::utils::text::truncate_on_char_boundary(&stdout, 4096)))
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
        StaticScanTool::Impeccable => "impeccable",
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
        StaticScanTool::Impeccable => Ok(parse_impeccable(stdout)),
        StaticScanTool::Knip | StaticScanTool::Jscpd => Err(AppError::Internal(format!(
            "Parser for tool {} is not yet implemented.",
            tool_slug(tool)
        ))),
    }
}

/// Anti-pattern families this lane deliberately DROPS.
///
/// `design-system-*` compares every literal colour / size / radius / font
/// against a root `DESIGN.md` token ramp. On a real codebase that is thousands
/// of rows — a field trial over ~1200 components produced **69 findings without
/// a DESIGN.md and 1038 with one**, of which 965 were this family. That is a
/// token-drift *report*, not a backlog: dumping it into `dev_ideas` would bury
/// every genuine finding under arbitrary-value noise the repo's own ESLint
/// design-token rules already track.
///
/// The remaining rules are the "slop" family — recognizable generated-UI tells
/// (side-tab accent borders, bounce easing, AI palettes, broken images). Those
/// are low-volume, high-signal, and nothing else in the app detects them.
const IMPECCABLE_DROPPED_PREFIXES: [&str; 1] = ["design-system-"];

/// Parser for `impeccable detect --json`: a flat array of
/// `{antipattern, name, description, severity, category, file, line, snippet}`.
///
/// Known limitation worth recording where the parser lives: the detector reads
/// *styling syntax*, not token indirection. `font-family: 'Inter'` is caught;
/// `--font-sans: 'Inter'` is not, and a hex sitting in a token map object is
/// not. On a well-tokenised codebase it therefore under-reports — treat a clean
/// run as "no known slop patterns", never as "no design problems".
fn parse_impeccable(stdout: &str) -> Vec<Finding> {
    let value: Value = serde_json::from_str(stdout.trim()).unwrap_or(Value::Null);
    let Some(arr) = value.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter(|item| {
            let id = item
                .get("antipattern")
                .and_then(|x| x.as_str())
                .unwrap_or_default();
            !IMPECCABLE_DROPPED_PREFIXES
                .iter()
                .any(|p| id.starts_with(p))
        })
        .map(|item| {
            let name = item
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("Design anti-pattern");
            let id = item
                .get("antipattern")
                .and_then(|x| x.as_str())
                .unwrap_or("impeccable");
            let file = item.get("file").and_then(|x| x.as_str()).unwrap_or("");
            let line = item.get("line").and_then(|x| x.as_i64());
            let title = match (file.is_empty(), line) {
                (false, Some(l)) => format!("[{id}] {name} ({file}:{l})"),
                (false, None) => format!("[{id}] {name} ({file})"),
                (true, _) => format!("[{id}] {name}"),
            };
            // `snippet` is the matched text — the single most useful thing when
            // triaging, so it leads the description with the rule's rationale
            // (`description`) as the reasoning behind it.
            let snippet = item.get("snippet").and_then(|x| x.as_str());
            let description = item
                .get("description")
                .and_then(|x| x.as_str())
                .map(str::to_string);
            // `warning` is the detector's own severity for every non-advisory
            // rule; these are visual-polish findings, so impact stays modest and
            // effort low — they are usually a one-line change.
            let impact = match item.get("severity").and_then(|x| x.as_str()) {
                Some("error") => 6,
                _ => 4,
            };
            Finding {
                title,
                description: snippet.map(|s| format!("Matched: `{s}`")),
                reasoning: description,
                effort: Some(2),
                impact: Some(impact),
                risk: Some(1),
            }
        })
        .collect()
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
        let dead = findings
            .iter()
            .find(|f| f.title.contains("unused"))
            .unwrap();
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

    #[test]
    fn impeccable_parses_flat_array_and_builds_located_titles() {
        let out = r#"[
          {"antipattern":"side-tab","name":"Side-tab accent border","description":"Thick colored border.","severity":"warning","category":"slop","file":"src/a.tsx","line":147,"snippet":"border-l-2"}
        ]"#;
        let f = parse_impeccable(out);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].title, "[side-tab] Side-tab accent border (src/a.tsx:147)");
        assert_eq!(f[0].description.as_deref(), Some("Matched: `border-l-2`"));
        assert_eq!(f[0].reasoning.as_deref(), Some("Thick colored border."));
    }

    #[test]
    fn impeccable_drops_the_design_system_family() {
        // The noisy family: 965 of 1038 findings in the field trial. Dropping it
        // is the whole reason this lane is scoped to slop rules.
        // NOTE: `r##"…"##` — the payload contains `"#` (a hex colour right after
        // a quote), which would close an ordinary `r#"…"#` literal mid-string.
        let out = r##"[
          {"antipattern":"design-system-font-size","name":"Font size outside DESIGN.md","file":"src/a.tsx","line":1,"snippet":"text-[10px]"},
          {"antipattern":"design-system-color","name":"Color outside DESIGN.md","file":"src/b.tsx","line":2,"snippet":"#6366f1"},
          {"antipattern":"bounce-easing","name":"Bounce or elastic easing","file":"src/c.css","line":3,"snippet":"cubic-bezier(0.34, 1.56, 0.64, 1)"}
        ]"##;
        let f = parse_impeccable(out);
        assert_eq!(f.len(), 1, "only the non design-system finding survives");
        assert!(f[0].title.starts_with("[bounce-easing]"));
    }

    #[test]
    fn impeccable_tolerates_empty_and_malformed_output() {
        // A clean run is the common case; a schema change must not break the
        // runner. Both yield zero findings rather than an error.
        assert!(parse_impeccable("[]").is_empty());
        assert!(parse_impeccable("").is_empty());
        assert!(parse_impeccable("not json").is_empty());
        assert!(parse_impeccable(r#"{"findings":[]}"#).is_empty());
    }

    #[test]
    fn impeccable_handles_a_finding_with_no_file() {
        let out = r#"[{"antipattern":"marquee","name":"Marquee"}]"#;
        let f = parse_impeccable(out);
        assert_eq!(f[0].title, "[marquee] Marquee");
        assert_eq!(f[0].description, None);
    }

    #[test]
    fn impeccable_scores_stay_in_range() {
        let out = r#"[{"antipattern":"x","name":"X","severity":"error","file":"a","line":1}]"#;
        let f = parse_impeccable(out);
        for v in [f[0].effort, f[0].impact, f[0].risk] {
            let v = v.unwrap();
            assert!((1..=10).contains(&v), "score {v} out of range");
        }
    }

    #[test]
    fn impeccable_tool_slug_round_trips() {
        assert_eq!(tool_slug(StaticScanTool::Impeccable), "impeccable");
    }
}
