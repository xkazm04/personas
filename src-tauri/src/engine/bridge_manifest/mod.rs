//! Declarative desktop-bridge dispatcher.
//!
//! See `DESIGN.md` for full rationale. Short version: today
//! `engine/desktop_bridges.rs` holds 4 hand-coded typed bridges. This module
//! introduces a manifest-driven runtime dispatcher so a new bridge becomes a
//! `<id>.json` file plus a `cargo build` (v1: bundled-only; runtime
//! discovery from app-data is a follow-up).
//!
//! Module surface:
//! - [`BridgeManifest`] / [`BridgeAction`] / [`BridgeParam`] — types
//! - [`parse_manifest_str`] — JSON → struct, with validation
//! - [`interpolate_args`] — pure args-template substitution (testable)
//! - [`dispatch`] — interpolation + tokio spawn, returns
//!   [`super::desktop_bridges::BridgeActionResult`] for compatibility with
//!   the existing typed-bridge surface

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::desktop_bridges::BridgeActionResult;
use crate::error::AppError;

/// Maximum captured stdout/stderr per dispatch. Mirrors the typed-bridge
/// `MAX_OUTPUT_BYTES` in `desktop_bridges.rs`.
const MAX_OUTPUT_BYTES: usize = 50 * 1024;
/// Default per-dispatch timeout. Matches the typed-bridge default.
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// One declarative bridge definition (one CLI binary).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BridgeManifest {
    /// Stable identifier used as filename and in dispatch calls.
    pub id: String,
    /// Human-readable label.
    pub label: String,
    /// Multi-sentence description of what the underlying CLI does.
    #[serde(default)]
    pub description: String,
    /// Binary name looked up on `PATH`. On Windows the dispatcher also tries
    /// `<binary>.exe` and `<binary>.cmd`.
    pub binary: String,
    /// Available actions on this bridge.
    pub actions: Vec<BridgeAction>,
}

/// One named operation on a bridge.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BridgeAction {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// CLI arg list. Strings beginning with `$` are param interpolation
    /// placeholders; everything else is literal.
    pub args: Vec<String>,
    /// Parameter schema keyed by name. Use a map (not Vec) so the JSON
    /// shape is the natural `{ "title": { "type": "string", ... } }` form.
    #[serde(default)]
    pub params: HashMap<String, BridgeParam>,
}

/// Schema for a single action parameter.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BridgeParam {
    /// Logical type. v1 supports `string`, `integer`, `boolean`. Unknown
    /// values are rejected at parse time.
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub description: Option<String>,
    /// Default value substituted when the param is optional and not
    /// provided. Untyped JSON for flexibility (the dispatcher coerces to
    /// string at interpolation time).
    #[serde(default)]
    pub default: Option<Value>,
}

/// Parse one manifest from its JSON body. Performs schema validation
/// (action names unique, param types known, action args reference declared
/// params).
pub fn parse_manifest_str(json: &str) -> Result<BridgeManifest, AppError> {
    let manifest: BridgeManifest = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("bridge manifest parse failed: {e}")))?;

    if manifest.id.trim().is_empty() {
        return Err(AppError::Validation("bridge manifest id is empty".into()));
    }
    if manifest.binary.trim().is_empty() {
        return Err(AppError::Validation(format!(
            "bridge manifest '{}' has empty binary",
            manifest.id
        )));
    }

    // Action name uniqueness.
    let mut seen = std::collections::HashSet::new();
    for action in &manifest.actions {
        if !seen.insert(&action.name) {
            return Err(AppError::Validation(format!(
                "bridge '{}' has duplicate action '{}'",
                manifest.id, action.name
            )));
        }
        // Parameter type check.
        for (pname, p) in &action.params {
            match p.kind.as_str() {
                "string" | "integer" | "boolean" => {}
                other => {
                    return Err(AppError::Validation(format!(
                        "bridge '{}' action '{}' param '{}' has unknown type '{}' \
                         (expected string|integer|boolean)",
                        manifest.id, action.name, pname, other
                    )))
                }
            }
        }
        // Args reference check: every $param must be declared.
        for arg in &action.args {
            if let Some(name) = arg.strip_prefix('$') {
                if !action.params.contains_key(name) {
                    return Err(AppError::Validation(format!(
                        "bridge '{}' action '{}' references undeclared param '${}' \
                         in args template",
                        manifest.id, action.name, name
                    )));
                }
            }
        }
    }

    Ok(manifest)
}

/// Load all `*.json` manifests from a directory. Returns the parsed set,
/// skipping (with a warning) any file that fails parse — one bad manifest
/// never blocks the rest.
#[allow(dead_code)]
pub fn load_manifests_from_dir(dir: &std::path::Path) -> Vec<BridgeManifest> {
    let read = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!(
                error = %e,
                dir = %dir.display(),
                "bridge_manifest: directory not readable — returning empty"
            );
            return Vec::new();
        }
    };

    let mut out = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let body = match std::fs::read_to_string(&path) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = %e, path = %path.display(),
                    "bridge_manifest: read failed — skipping");
                continue;
            }
        };
        match parse_manifest_str(&body) {
            Ok(m) => out.push(m),
            Err(e) => {
                tracing::warn!(error = %e, path = %path.display(),
                    "bridge_manifest: parse failed — skipping");
            }
        }
    }
    out
}

/// Stringify a JSON value for argument interpolation. Booleans → `true`/
/// `false`; integers → digits; strings → unquoted; arrays/objects rejected.
fn stringify_param(name: &str, value: &Value) -> Result<String, AppError> {
    match value {
        Value::String(s) => Ok(s.clone()),
        Value::Bool(b) => Ok(if *b { "true".into() } else { "false".into() }),
        Value::Number(n) => Ok(n.to_string()),
        Value::Null => Err(AppError::Validation(format!(
            "param '{name}' is null — cannot interpolate"
        ))),
        Value::Array(_) | Value::Object(_) => Err(AppError::Validation(format!(
            "param '{name}' is structured (array/object) — only string/integer/boolean \
             are supported in v1"
        ))),
    }
}

/// Interpolate the `args` template with the provided params. Pure function;
/// no I/O.
///
/// Drops `--flag $param` pairs cleanly when an optional param without a
/// default is missing — see `DESIGN.md` "Interpolation rules".
pub fn interpolate_args(
    action: &BridgeAction,
    params: &HashMap<String, Value>,
) -> Result<Vec<String>, AppError> {
    let mut out: Vec<String> = Vec::with_capacity(action.args.len());
    for arg in &action.args {
        if let Some(name) = arg.strip_prefix('$') {
            // `$name` placeholder.
            let schema = match action.params.get(name) {
                Some(s) => s,
                None => {
                    return Err(AppError::Validation(format!(
                        "action '{}' references undeclared param '${}'",
                        action.name, name
                    )))
                }
            };
            let provided = params.get(name);
            let value: Option<&Value> = provided.or(schema.default.as_ref());
            match value {
                Some(v) => {
                    let s = stringify_param(name, v)?;
                    out.push(s);
                }
                None => {
                    if schema.required {
                        return Err(AppError::Validation(format!(
                            "action '{}' missing required param '{}'",
                            action.name, name
                        )));
                    }
                    // Optional + no value + no default → drop. If the
                    // immediately-preceding emitted argument starts with `-`,
                    // drop it too (collapses `--body $body` cleanly).
                    if let Some(prev) = out.last() {
                        if prev.starts_with('-') {
                            out.pop();
                        }
                    }
                }
            }
        } else {
            out.push(arg.clone());
        }
    }
    Ok(out)
}

/// Resolve a binary name to a runnable path. On Windows tries `<binary>`,
/// `<binary>.exe`, `<binary>.cmd`. Returns the first variant where the OS
/// `which` succeeds; falls back to the raw input string otherwise (the
/// spawn will then fail with a clean error from `tokio::process`).
fn resolve_binary(binary: &str) -> String {
    let candidates: Vec<String> = if cfg!(target_os = "windows") {
        vec![
            binary.to_string(),
            format!("{binary}.exe"),
            format!("{binary}.cmd"),
        ]
    } else {
        vec![binary.to_string()]
    };
    for cand in &candidates {
        if which::which(cand).is_ok() {
            return cand.clone();
        }
    }
    binary.to_string()
}

/// Dispatch one action on one bridge with provided params.
///
/// Spawns the binary via `tokio::process::Command`, captures stdout/stderr,
/// applies a 30-second default timeout. Returns a
/// [`BridgeActionResult`] for compatibility with the typed-bridge surface so
/// callers can treat both kinds uniformly.
pub async fn dispatch(
    manifest: &BridgeManifest,
    action_name: &str,
    params: &HashMap<String, Value>,
) -> Result<BridgeActionResult, AppError> {
    let action = manifest
        .actions
        .iter()
        .find(|a| a.name == action_name)
        .ok_or_else(|| {
            AppError::Validation(format!(
                "bridge '{}' has no action '{}'",
                manifest.id, action_name
            ))
        })?;

    let interpolated = interpolate_args(action, params)?;

    let binary = resolve_binary(&manifest.binary);
    let start = Instant::now();
    let mut cmd = tokio::process::Command::new(&binary);
    cmd.args(&interpolated);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let timeout = Duration::from_secs(DEFAULT_TIMEOUT_SECS);
    let output_res = tokio::time::timeout(timeout, cmd.output()).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    let bridge_id = manifest.id.clone();
    let action_label = action_name.to_string();

    let output = match output_res {
        Err(_) => {
            return Ok(BridgeActionResult {
                success: false,
                output: String::new(),
                error: Some(format!(
                    "Bridge '{bridge_id}' action '{action_label}' timed out after \
                     {DEFAULT_TIMEOUT_SECS}s"
                )),
                duration_ms,
                bridge: bridge_id,
                action: action_label,
            });
        }
        Ok(Err(e)) => {
            return Ok(BridgeActionResult {
                success: false,
                output: String::new(),
                error: Some(format!("Failed to spawn '{}': {e}", manifest.binary)),
                duration_ms,
                bridge: bridge_id,
                action: action_label,
            });
        }
        Ok(Ok(o)) => o,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    let combined = if output.status.success() {
        stdout.to_string()
    } else {
        format!("STDERR: {stderr}\nSTDOUT: {stdout}")
    };
    let truncated = if combined.len() > MAX_OUTPUT_BYTES {
        format!(
            "{}...\n[truncated at {} bytes, total {} bytes]",
            &combined[..MAX_OUTPUT_BYTES],
            MAX_OUTPUT_BYTES,
            combined.len()
        )
    } else {
        combined
    };

    if output.status.success() {
        Ok(BridgeActionResult {
            success: true,
            output: truncated,
            error: None,
            duration_ms,
            bridge: bridge_id,
            action: action_label,
        })
    } else {
        Ok(BridgeActionResult {
            success: false,
            output: String::new(),
            error: Some(truncated),
            duration_ms,
            bridge: bridge_id,
            action: action_label,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_manifest_json() -> &'static str {
        r#"{
            "id": "gh",
            "label": "GitHub CLI",
            "description": "Wraps the gh CLI.",
            "binary": "gh",
            "actions": [
                {
                    "name": "auth_status",
                    "description": "Show auth status.",
                    "args": ["auth", "status"],
                    "params": {}
                },
                {
                    "name": "issue_create",
                    "description": "Create an issue.",
                    "args": ["issue", "create", "--repo", "$repo",
                             "--title", "$title", "--body", "$body"],
                    "params": {
                        "repo":  { "type": "string", "required": true },
                        "title": { "type": "string", "required": true },
                        "body":  { "type": "string", "required": false }
                    }
                }
            ]
        }"#
    }

    #[test]
    fn parse_manifest_round_trip() {
        let m = parse_manifest_str(sample_manifest_json()).expect("parse");
        assert_eq!(m.id, "gh");
        assert_eq!(m.binary, "gh");
        assert_eq!(m.actions.len(), 2);
        assert_eq!(m.actions[0].name, "auth_status");
        assert!(m.actions[1].params.contains_key("title"));
    }

    #[test]
    fn parse_rejects_unknown_param_type() {
        let bad = r#"{
            "id": "x", "label": "X", "binary": "x",
            "actions": [{
                "name": "a", "args": ["--p", "$p"],
                "params": { "p": { "type": "decimal" } }
            }]
        }"#;
        let err = parse_manifest_str(bad).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("unknown type 'decimal'"), "got: {msg}");
    }

    #[test]
    fn parse_rejects_undeclared_param_reference() {
        let bad = r#"{
            "id": "x", "label": "X", "binary": "x",
            "actions": [{
                "name": "a", "args": ["--p", "$missing"],
                "params": {}
            }]
        }"#;
        let err = parse_manifest_str(bad).unwrap_err();
        assert!(format!("{err}").contains("undeclared param '$missing'"));
    }

    #[test]
    fn parse_rejects_duplicate_action_names() {
        let bad = r#"{
            "id": "x", "label": "X", "binary": "x",
            "actions": [
                { "name": "a", "args": [], "params": {} },
                { "name": "a", "args": [], "params": {} }
            ]
        }"#;
        let err = parse_manifest_str(bad).unwrap_err();
        assert!(format!("{err}").contains("duplicate action 'a'"));
    }

    #[test]
    fn interpolate_required_param_present() {
        let m = parse_manifest_str(sample_manifest_json()).unwrap();
        let action = m
            .actions
            .iter()
            .find(|a| a.name == "issue_create")
            .unwrap();
        let mut params = HashMap::new();
        params.insert("repo".into(), json!("foo/bar"));
        params.insert("title".into(), json!("Hello"));
        params.insert("body".into(), json!("World"));

        let args = interpolate_args(action, &params).unwrap();
        assert_eq!(
            args,
            vec![
                "issue",
                "create",
                "--repo",
                "foo/bar",
                "--title",
                "Hello",
                "--body",
                "World"
            ]
        );
    }

    #[test]
    fn interpolate_required_param_missing_rejects() {
        let m = parse_manifest_str(sample_manifest_json()).unwrap();
        let action = m.actions.iter().find(|a| a.name == "issue_create").unwrap();
        let mut params = HashMap::new();
        params.insert("repo".into(), json!("foo/bar"));
        // missing required `title`
        let err = interpolate_args(action, &params).unwrap_err();
        assert!(format!("{err}").contains("missing required param 'title'"));
    }

    #[test]
    fn interpolate_optional_param_missing_drops_flag() {
        let m = parse_manifest_str(sample_manifest_json()).unwrap();
        let action = m.actions.iter().find(|a| a.name == "issue_create").unwrap();
        let mut params = HashMap::new();
        params.insert("repo".into(), json!("foo/bar"));
        params.insert("title".into(), json!("Hello"));
        // `body` omitted; optional with no default → `--body $body` collapses

        let args = interpolate_args(action, &params).unwrap();
        assert_eq!(
            args,
            vec!["issue", "create", "--repo", "foo/bar", "--title", "Hello"]
        );
    }

    #[test]
    fn interpolate_optional_param_with_default() {
        let manifest_json = r#"{
            "id": "x", "label": "X", "binary": "x",
            "actions": [{
                "name": "a",
                "args": ["--n", "$n"],
                "params": { "n": { "type": "integer", "default": 42 } }
            }]
        }"#;
        let m = parse_manifest_str(manifest_json).unwrap();
        let action = &m.actions[0];

        let args = interpolate_args(action, &HashMap::new()).unwrap();
        assert_eq!(args, vec!["--n", "42"]);
    }

    #[test]
    fn interpolate_boolean_and_integer_stringify() {
        let manifest_json = r#"{
            "id": "x", "label": "X", "binary": "x",
            "actions": [{
                "name": "a",
                "args": ["--flag", "$flag", "--count", "$count"],
                "params": {
                    "flag":  { "type": "boolean", "required": true },
                    "count": { "type": "integer", "required": true }
                }
            }]
        }"#;
        let m = parse_manifest_str(manifest_json).unwrap();
        let action = &m.actions[0];

        let mut params = HashMap::new();
        params.insert("flag".into(), json!(true));
        params.insert("count".into(), json!(7));

        let args = interpolate_args(action, &params).unwrap();
        assert_eq!(args, vec!["--flag", "true", "--count", "7"]);
    }
}
