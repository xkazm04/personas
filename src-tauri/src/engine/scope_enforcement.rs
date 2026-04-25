//! Runtime scope enforcement for credential-relayed API requests (§5).
//!
//! When a credential has a non-empty `scoped_resources` blob and its
//! connector declares `enforce` rules per resource spec, this module checks
//! whether an outgoing API path operates on a scoped resource the user has
//! actually picked. Three outcomes:
//!
//! - `Allow` — credential is broad-scoped, the path doesn't match any rule,
//!   or the captured resource id is in the user's picks.
//! - `WarnOnly` — a rule matched and the captured id is NOT in the picks,
//!   but the credential's enforcement mode is `"warn"` (default). Caller
//!   logs the violation and proceeds with the request.
//! - `Block` — same match, but mode is `"block"`. Caller rejects the request
//!   with a sanitized error.
//!
//! Out of scope for v1: MCP / desktop-bridge calls don't go through the
//! credential proxy, so they bypass this gate. Handoff §5 calls them
//! "analogous gate, separate work".

use std::collections::HashMap;

use serde::Deserialize;

use crate::error::AppError;

/// What `evaluate` returns. The outer caller decides what to do based on the
/// credential's persisted enforcement mode.
#[derive(Debug, PartialEq, Eq)]
pub enum EnforcementOutcome {
    Allow,
    WarnOnly { resource: String, attempted_id: String },
    Block { resource: String, attempted_id: String },
}

/// Mode value persisted under `metadata.scope_enforcement`. Default = warn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnforcementMode {
    Warn,
    Block,
}

impl EnforcementMode {
    pub fn from_metadata(metadata_json: Option<&str>) -> Self {
        let Some(json) = metadata_json else { return Self::Warn };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return Self::Warn };
        match v.get("scope_enforcement").and_then(|x| x.as_str()) {
            Some("block") => Self::Block,
            _ => Self::Warn,
        }
    }
}

#[derive(Debug, Deserialize)]
struct EnforceRule {
    url_regex: String,
    #[serde(default = "default_capture")]
    id_capture: usize,
}

fn default_capture() -> usize { 1 }

#[derive(Debug, Deserialize)]
struct ResourceSpecForEnforce {
    id: String,
    #[serde(default)]
    enforce: Option<EnforceRule>,
}

/// Evaluate a relayed API request against the credential's scope.
///
/// `path` is the path portion fed to the API proxy (everything after the
/// connector's resolved base URL). Scope picks live under
/// `scoped_resources_json[<resource_id>][].id` — if the regex captures a
/// value not in that list, we have a violation.
pub fn evaluate(
    connector_resources_json: Option<&str>,
    scoped_resources_json: Option<&str>,
    path: &str,
    mode: EnforcementMode,
) -> Result<EnforcementOutcome, AppError> {
    // Broad scope (NULL or empty `{}`) → no enforcement.
    let Some(picks_blob) = scoped_resources_json else {
        return Ok(EnforcementOutcome::Allow);
    };
    let picks: HashMap<String, serde_json::Value> = serde_json::from_str(picks_blob)
        .unwrap_or_default();
    if picks.is_empty() {
        return Ok(EnforcementOutcome::Allow);
    }

    // Connector hasn't declared resources[] → nothing to enforce against.
    let Some(specs_json) = connector_resources_json else {
        return Ok(EnforcementOutcome::Allow);
    };
    let specs: Vec<ResourceSpecForEnforce> = serde_json::from_str(specs_json)
        .map_err(|e| AppError::Internal(format!("Malformed connector resources[]: {e}")))?;

    for spec in specs {
        let Some(rule) = spec.enforce else { continue };
        let re = match regex::Regex::new(&rule.url_regex) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(
                    resource = %spec.id,
                    pattern = %rule.url_regex,
                    error = %e,
                    "skipping enforce rule with invalid regex"
                );
                continue;
            }
        };
        let Some(caps) = re.captures(path) else { continue };
        let Some(captured) = caps.get(rule.id_capture).map(|m| m.as_str().to_string()) else {
            continue;
        };

        // Picks for this resource — array of objects each with `id`.
        let allowed_ids: Vec<String> = picks
            .get(&spec.id)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|p| p.get("id").and_then(|x| x.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        // No picks under this resource = the user didn't scope it. Treat as
        // broad for that resource (rather than blocking everything).
        if allowed_ids.is_empty() {
            continue;
        }

        if !allowed_ids.iter().any(|id| id == &captured) {
            return Ok(match mode {
                EnforcementMode::Warn => EnforcementOutcome::WarnOnly {
                    resource: spec.id,
                    attempted_id: captured,
                },
                EnforcementMode::Block => EnforcementOutcome::Block {
                    resource: spec.id,
                    attempted_id: captured,
                },
            });
        }
    }

    Ok(EnforcementOutcome::Allow)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GH_RESOURCES: &str = r#"[{
        "id": "repositories",
        "label": "Repositories",
        "list_endpoint": { "method": "GET", "url": "x" },
        "response_mapping": { "items_path": "$", "id": "full_name", "label": "full_name" },
        "enforce": { "url_regex": "^/?repos/([^/?#]+/[^/?#]+)", "id_capture": 1 }
    }]"#;

    const SCOPED_TO_PERSONAS: &str = r#"{
        "repositories": [{ "id": "xkazm04/personas", "label": "xkazm04/personas" }]
    }"#;

    #[test]
    fn broad_scope_always_allows() {
        let r = evaluate(Some(GH_RESOURCES), None, "/repos/anyone/anything/issues", EnforcementMode::Block).unwrap();
        assert_eq!(r, EnforcementOutcome::Allow);
    }

    #[test]
    fn empty_scope_blob_allows() {
        let r = evaluate(Some(GH_RESOURCES), Some("{}"), "/repos/anyone/anything/issues", EnforcementMode::Block).unwrap();
        assert_eq!(r, EnforcementOutcome::Allow);
    }

    #[test]
    fn matching_repo_allows() {
        let r = evaluate(
            Some(GH_RESOURCES),
            Some(SCOPED_TO_PERSONAS),
            "/repos/xkazm04/personas/issues?state=open",
            EnforcementMode::Block,
        ).unwrap();
        assert_eq!(r, EnforcementOutcome::Allow);
    }

    #[test]
    fn unrelated_repo_blocks_in_block_mode() {
        let r = evaluate(
            Some(GH_RESOURCES),
            Some(SCOPED_TO_PERSONAS),
            "/repos/microsoft/vscode/issues",
            EnforcementMode::Block,
        ).unwrap();
        assert_eq!(r, EnforcementOutcome::Block {
            resource: "repositories".into(),
            attempted_id: "microsoft/vscode".into(),
        });
    }

    #[test]
    fn unrelated_repo_warns_in_warn_mode() {
        let r = evaluate(
            Some(GH_RESOURCES),
            Some(SCOPED_TO_PERSONAS),
            "/repos/microsoft/vscode/issues",
            EnforcementMode::Warn,
        ).unwrap();
        assert_eq!(r, EnforcementOutcome::WarnOnly {
            resource: "repositories".into(),
            attempted_id: "microsoft/vscode".into(),
        });
    }

    #[test]
    fn non_matching_path_allows() {
        // /user/profile doesn't operate on a repository.
        let r = evaluate(
            Some(GH_RESOURCES),
            Some(SCOPED_TO_PERSONAS),
            "/user/profile",
            EnforcementMode::Block,
        ).unwrap();
        assert_eq!(r, EnforcementOutcome::Allow);
    }

    #[test]
    fn missing_picks_for_resource_allows() {
        // User scoped organizations but not repositories — repo paths shouldn't
        // be blocked by an empty pick list.
        let scoped = r#"{ "organizations": [{"id": "x", "label": "x"}] }"#;
        let r = evaluate(
            Some(GH_RESOURCES),
            Some(scoped),
            "/repos/microsoft/vscode/issues",
            EnforcementMode::Block,
        ).unwrap();
        assert_eq!(r, EnforcementOutcome::Allow);
    }

    #[test]
    fn invalid_regex_skipped_not_panicked() {
        let bad = r#"[{
            "id": "repositories",
            "label": "x",
            "list_endpoint": { "method": "GET", "url": "x" },
            "response_mapping": { "items_path": "$", "id": "id", "label": "id" },
            "enforce": { "url_regex": "[unclosed", "id_capture": 1 }
        }]"#;
        let r = evaluate(
            Some(bad),
            Some(SCOPED_TO_PERSONAS),
            "/repos/microsoft/vscode/issues",
            EnforcementMode::Block,
        ).unwrap();
        assert_eq!(r, EnforcementOutcome::Allow);
    }

    #[test]
    fn enforcement_mode_from_metadata() {
        assert_eq!(EnforcementMode::from_metadata(None), EnforcementMode::Warn);
        assert_eq!(
            EnforcementMode::from_metadata(Some(r#"{"scope_enforcement":"block"}"#)),
            EnforcementMode::Block,
        );
        assert_eq!(
            EnforcementMode::from_metadata(Some(r#"{"scope_enforcement":"warn"}"#)),
            EnforcementMode::Warn,
        );
        assert_eq!(
            EnforcementMode::from_metadata(Some(r#"{"other":"thing"}"#)),
            EnforcementMode::Warn,
        );
        assert_eq!(EnforcementMode::from_metadata(Some("not json")), EnforcementMode::Warn);
    }
}
