//! Dynamic resource discovery for adoption questionnaires.
//!
//! Lets template adoption questions pull their option lists from real data —
//! a Sentry question lists the user's actual projects, a codebases question
//! lists the actual registered dev projects — instead of asking the user to
//! type identifiers they have to look up manually.
//!
//! Discovery ops live in a compiled-in registry keyed by
//! `(service_type, operation)`. Two backing kinds:
//!
//! - `Http` — renders a path template (interpolating credential fields and
//!   caller-supplied params), routes the request through `api_proxy`, and
//!   extracts values from the JSON response via simple dotted paths.
//! - `LocalCodebases` — bypasses the HTTP proxy and reads from the
//!   `dev_projects` table directly (codebases is a builtin bridge connector,
//!   not an HTTP API).
//!
//! Credential secrets never cross to the frontend: field interpolation and
//! API invocation all happen server-side, and only `{value, label, sublabel}`
//! triples are returned.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::Serialize;
use ts_rs::TS;

use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredItem {
    pub value: String,
    pub label: String,
    pub sublabel: Option<String>,
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

enum DiscoveryOp {
    /// Proxies an HTTP call through the credential's auth strategy and
    /// extracts an array of items from the JSON response.
    Http {
        method: &'static str,
        /// Path relative to the credential's resolved base URL. May embed
        /// `{{field}}` (credential field) or `{{param.x}}` (caller-supplied).
        path: &'static str,
        /// Dotted path to the array root in the response. `None` means the
        /// response body itself is the array.
        items_path: Option<&'static str>,
        /// Dotted path inside each item that yields the stored value.
        value_path: &'static str,
        /// Dotted path inside each item that yields the display label.
        /// Defaults to `value_path` if omitted.
        label_path: Option<&'static str>,
        /// Dotted path inside each item that yields an optional secondary
        /// label (e.g. platform, workspace).
        sublabel_path: Option<&'static str>,
    },
    /// Reads the registered codebases from the local `dev_projects` table.
    LocalCodebases,
}

type RegistryKey = (&'static str, &'static str);

static REGISTRY: LazyLock<HashMap<RegistryKey, DiscoveryOp>> = LazyLock::new(|| {
    let mut m: HashMap<RegistryKey, DiscoveryOp> = HashMap::new();

    // ---------------- Sentry ----------------
    //
    // GET /api/0/organizations/{org}/projects/ →
    //   [{ id, slug, name, platform, ... }, ...]
    m.insert(
        ("sentry", "list_projects"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/api/0/organizations/{{organization_slug}}/projects/",
            items_path: None,
            value_path: "slug",
            label_path: Some("name"),
            sublabel_path: Some("platform"),
        },
    );
    //
    // GET /api/0/organizations/{org}/tags/environment/values/ →
    //   { results: [{ key, name, value, count, ... }, ...] }
    // (Sentry's tag-values endpoint returns a paginated object.)
    m.insert(
        ("sentry", "list_environments"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/api/0/organizations/{{organization_slug}}/tags/environment/values/",
            items_path: None,
            value_path: "value",
            label_path: Some("name"),
            sublabel_path: None,
        },
    );

    // ---------------- Codebases (local dev projects) ----------------
    m.insert(("codebases", "list_projects"), DiscoveryOp::LocalCodebases);

    m
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Resolve a discovery op for a given credential and return the list of
/// `{value, label, sublabel}` items the questionnaire should render.
///
/// `service_type` is the connector type (e.g. `"sentry"`, `"codebases"`) and
/// MUST match the op's registry key — this prevents a template from asking
/// us to run a `sentry.list_projects` op against a non-Sentry credential.
pub async fn discover_resources(
    pool: &DbPool,
    credential_id: &str,
    service_type: &str,
    operation: &str,
    params: HashMap<String, String>,
) -> Result<Vec<DiscoveredItem>, AppError> {
    let op = REGISTRY.get(&(service_type, operation)).ok_or_else(|| {
        AppError::NotFound(format!(
            "Discovery operation '{}.{}' is not registered",
            service_type, operation
        ))
    })?;

    match op {
        DiscoveryOp::LocalCodebases => {
            let projects = crate::db::repos::dev_tools::list_projects(pool, None)?;
            Ok(projects
                .into_iter()
                .map(|p| DiscoveredItem {
                    value: p.name.clone(),
                    label: p.name,
                    sublabel: p.tech_stack,
                })
                .collect())
        }
        DiscoveryOp::Http {
            method,
            path,
            items_path,
            value_path,
            label_path,
            sublabel_path,
        } => {
            // Codebases is the only op that ignores the credential; every
            // other op requires a real credential.
            if credential_id.is_empty() {
                return Err(AppError::Validation(
                    "Discovery op requires a credential_id".into(),
                ));
            }
            let credential = cred_repo::get_by_id(pool, credential_id)?;

            // Guard against mismatched service_type: the registry key says
            // "sentry" so the credential must actually be a Sentry credential.
            if credential.service_type != *service_type {
                return Err(AppError::Validation(format!(
                    "Credential service_type '{}' does not match discovery op '{}'",
                    credential.service_type, service_type
                )));
            }

            let fields = cred_repo::get_decrypted_fields(pool, &credential)?;
            let rendered_path = interpolate(path, &fields, &params)?;

            let response = super::api_proxy::execute_api_request(
                pool,
                credential_id,
                method,
                &rendered_path,
                HashMap::new(),
                None,
            )
            .await?;

            if response.status >= 400 {
                let snippet: String = response.body.chars().take(200).collect();
                return Err(AppError::Internal(format!(
                    "Discovery {} {} failed: HTTP {} — {}",
                    method, rendered_path, response.status, snippet
                )));
            }

            let root: serde_json::Value = serde_json::from_str(&response.body)
                .map_err(|e| AppError::Internal(format!("Discovery response is not JSON: {e}")))?;

            let items_value = match items_path {
                None => &root,
                Some(p) => extract_path(&root, p).ok_or_else(|| {
                    AppError::Internal(format!(
                        "Discovery response missing items_path '{}'",
                        p
                    ))
                })?,
            };

            let arr = items_value.as_array().ok_or_else(|| {
                AppError::Internal(
                    "Discovery response items did not resolve to a JSON array".into(),
                )
            })?;

            let mut out = Vec::with_capacity(arr.len());
            for item in arr {
                let Some(value) = extract_string(item, value_path) else {
                    continue;
                };
                let label = label_path
                    .and_then(|p| extract_string(item, p))
                    .unwrap_or_else(|| value.clone());
                let sublabel = sublabel_path.and_then(|p| extract_string(item, p));
                out.push(DiscoveredItem {
                    value,
                    label,
                    sublabel,
                });
            }
            Ok(out)
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Interpolate `{{field}}` and `{{param.x}}` tokens in a path template.
///
/// Rejects any resolved value that contains `/` or control characters so a
/// malicious credential field can't break out of the intended path segment.
fn interpolate(
    template: &str,
    fields: &HashMap<String, String>,
    params: &HashMap<String, String>,
) -> Result<String, AppError> {
    let mut out = String::with_capacity(template.len());
    let mut cursor = 0;
    let bytes = template.as_bytes();

    while cursor < template.len() {
        if let Some(start) = template[cursor..].find("{{") {
            out.push_str(&template[cursor..cursor + start]);
            let open = cursor + start + 2;
            let close = template[open..].find("}}").ok_or_else(|| {
                AppError::Validation("Unterminated '{{' in discovery path template".into())
            })?;
            let key = template[open..open + close].trim();
            let resolved = if let Some(pk) = key.strip_prefix("param.") {
                params.get(pk).ok_or_else(|| {
                    AppError::Validation(format!("Missing discovery param '{}'", pk))
                })?
            } else {
                fields.get(key).ok_or_else(|| {
                    AppError::Validation(format!(
                        "Credential is missing field '{}' required by discovery op",
                        key
                    ))
                })?
            };
            if resolved.contains('/')
                || resolved.contains('?')
                || resolved.contains('#')
                || resolved.chars().any(|c| c.is_control())
            {
                return Err(AppError::Validation(format!(
                    "Discovery token '{}' contains unsafe characters",
                    key
                )));
            }
            out.push_str(resolved);
            cursor = open + close + 2;
        } else {
            out.push_str(&template[cursor..]);
            cursor = bytes.len();
        }
    }
    Ok(out)
}

/// Walk a dotted path through a JSON value.
fn extract_path<'a>(val: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut cur = val;
    for part in path.split('.') {
        cur = cur.get(part)?;
    }
    Some(cur)
}

/// Like [`extract_path`] but coerces the result to a `String` (accepting
/// strings, numbers, and booleans).
fn extract_string(val: &serde_json::Value, path: &str) -> Option<String> {
    let leaf = extract_path(val, path)?;
    match leaf {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolate_substitutes_fields_and_params() {
        let mut fields = HashMap::new();
        fields.insert("organization_slug".to_string(), "my-org".to_string());
        let mut params = HashMap::new();
        params.insert("project".to_string(), "api".to_string());

        let rendered = interpolate(
            "/api/0/projects/{{organization_slug}}/{{param.project}}/environments/",
            &fields,
            &params,
        )
        .unwrap();
        assert_eq!(rendered, "/api/0/projects/my-org/api/environments/");
    }

    #[test]
    fn interpolate_rejects_slash_in_resolved_value() {
        let mut fields = HashMap::new();
        fields.insert("organization_slug".to_string(), "evil/../admin".into());
        let err = interpolate("/api/0/{{organization_slug}}/", &fields, &HashMap::new())
            .unwrap_err();
        assert!(err.to_string().contains("unsafe"));
    }

    #[test]
    fn interpolate_errors_on_missing_field() {
        let err = interpolate("/{{missing}}", &HashMap::new(), &HashMap::new()).unwrap_err();
        assert!(err.to_string().contains("missing"));
    }

    #[test]
    fn extract_string_walks_dots() {
        let v: serde_json::Value = serde_json::json!({
            "project": { "slug": "web-api", "meta": { "count": 42 } }
        });
        assert_eq!(extract_string(&v, "project.slug").as_deref(), Some("web-api"));
        assert_eq!(extract_string(&v, "project.meta.count").as_deref(), Some("42"));
        assert_eq!(extract_string(&v, "missing"), None);
    }
}
