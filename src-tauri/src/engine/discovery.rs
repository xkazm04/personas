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
//!   extracts values from the JSON response via simple dotted paths. Supports
//!   optional body (for POST / GraphQL) and static extra headers (e.g.
//!   `Notion-Version`).
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
        /// Optional static JSON body for POST/PATCH requests. Sent verbatim.
        /// Used by Notion search (`POST /v1/search` with filter body) and
        /// GraphQL endpoints (Linear, Monday) whose query lives in the body.
        body: Option<&'static str>,
        /// Static extra headers beyond the credential strategy's auth header.
        /// Example: `Notion-Version: 2022-06-28` for the Notion API.
        headers: &'static [(&'static str, &'static str)],
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
    // GET /api/0/organizations/{org}/projects/ → [{ id, slug, name, ... }, ...]
    m.insert(
        ("sentry", "list_projects"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/api/0/organizations/{{organization_slug}}/projects/",
            body: None,
            headers: &[],
            items_path: None,
            value_path: "slug",
            label_path: Some("name"),
            sublabel_path: Some("platform"),
        },
    );
    // GET /api/0/organizations/{org}/tags/environment/values/
    m.insert(
        ("sentry", "list_environments"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/api/0/organizations/{{organization_slug}}/tags/environment/values/",
            body: None,
            headers: &[],
            items_path: None,
            value_path: "value",
            label_path: Some("name"),
            sublabel_path: None,
        },
    );

    // ---------------- GitHub ----------------
    m.insert(
        ("github", "list_repos"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/user/repos?per_page=100&sort=updated",
            body: None,
            headers: &[],
            items_path: None,
            value_path: "full_name",
            label_path: Some("full_name"),
            sublabel_path: Some("description"),
        },
    );
    m.insert(
        ("github", "list_orgs"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/user/orgs?per_page=100",
            body: None,
            headers: &[],
            items_path: None,
            value_path: "login",
            label_path: Some("login"),
            sublabel_path: None,
        },
    );
    m.insert(
        ("github_actions", "list_repos"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/user/repos?per_page=100&sort=updated",
            body: None,
            headers: &[],
            items_path: None,
            value_path: "full_name",
            label_path: Some("full_name"),
            sublabel_path: Some("description"),
        },
    );

    // ---------------- Slack ----------------
    m.insert(
        ("slack", "list_channels"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/conversations.list?types=public_channel,private_channel&limit=200&exclude_archived=true",
            body: None,
            headers: &[],
            items_path: Some("channels"),
            value_path: "name",
            label_path: Some("name"),
            sublabel_path: Some("topic.value"),
        },
    );

    // ---------------- Notion ----------------
    // POST /v1/search filtered to databases. Notion's search endpoint is
    // POST-only and requires the Notion-Version header; both are served by
    // the body + headers fields on the Http op.
    m.insert(
        ("notion", "list_databases"),
        DiscoveryOp::Http {
            method: "POST",
            path: "/v1/search",
            body: Some(r#"{"filter":{"value":"database","property":"object"},"page_size":100}"#),
            headers: &[("Notion-Version", "2022-06-28")],
            items_path: Some("results"),
            value_path: "id",
            // Notion titles are an array of rich_text blocks. We walk to the
            // first element's `plain_text` which is populated for unstyled titles.
            label_path: Some("title.0.plain_text"),
            sublabel_path: None,
        },
    );

    // ---------------- Jira ----------------
    // Jira credentials carry `domain` (e.g. `your-company.atlassian.net`) so
    // api_proxy constructs `https://{domain}` as the base URL. Uses Basic
    // Auth (email:api_token) via the JiraStrategy registered in
    // connector_strategy.rs.
    m.insert(
        ("jira", "list_projects"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/rest/api/3/project/search?maxResults=100&expand=description",
            body: None,
            headers: &[("Accept", "application/json")],
            items_path: Some("values"),
            value_path: "key",
            label_path: Some("name"),
            sublabel_path: Some("projectTypeKey"),
        },
    );

    // ---------------- Confluence ----------------
    // Same Atlassian Basic Auth + domain-based base URL as Jira.
    m.insert(
        ("confluence", "list_spaces"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/wiki/rest/api/space?limit=100",
            body: None,
            headers: &[("Accept", "application/json")],
            items_path: Some("results"),
            value_path: "key",
            label_path: Some("name"),
            sublabel_path: Some("type"),
        },
    );

    // ---------------- Linear ----------------
    // Linear is GraphQL-only; we POST the query as a JSON body.
    // Response shape: { data: { teams: { nodes: [{ id, name, ... }] } } }
    m.insert(
        ("linear", "list_teams"),
        DiscoveryOp::Http {
            method: "POST",
            path: "/graphql",
            body: Some(r#"{"query":"{ teams(first: 100) { nodes { id name key } } }"}"#),
            headers: &[],
            items_path: Some("data.teams.nodes"),
            value_path: "id",
            label_path: Some("name"),
            sublabel_path: Some("key"),
        },
    );
    m.insert(
        ("linear", "list_projects"),
        DiscoveryOp::Http {
            method: "POST",
            path: "/graphql",
            body: Some(r#"{"query":"{ projects(first: 100) { nodes { id name state } } }"}"#),
            headers: &[],
            items_path: Some("data.projects.nodes"),
            value_path: "id",
            label_path: Some("name"),
            sublabel_path: Some("state"),
        },
    );

    // ---------------- Monday.com ----------------
    // Monday also GraphQL-only. Auth field is `api_key_v2` — see the
    // TOKEN_KEYS extension in connector_strategy.rs so the default resolver
    // finds it.
    m.insert(
        ("monday_com", "list_boards"),
        DiscoveryOp::Http {
            method: "POST",
            path: "/v2",
            body: Some(r#"{"query":"{ boards(limit: 100) { id name state } }"}"#),
            headers: &[],
            items_path: Some("data.boards"),
            value_path: "id",
            label_path: Some("name"),
            sublabel_path: Some("state"),
        },
    );
    // Also register under "monday" for credentials created via older code
    // paths that use the short name.
    m.insert(
        ("monday", "list_boards"),
        DiscoveryOp::Http {
            method: "POST",
            path: "/v2",
            body: Some(r#"{"query":"{ boards(limit: 100) { id name state } }"}"#),
            headers: &[],
            items_path: Some("data.boards"),
            value_path: "id",
            label_path: Some("name"),
            sublabel_path: Some("state"),
        },
    );

    // ---------------- Google Drive ----------------
    // GET /drive/v3/files?q=mimeType='application/vnd.google-apps.folder'
    // Auth via GoogleOAuthStrategy (handles refresh). Credentials have no
    // fields locally — tokens live in the OAuth session store.
    // service_type aliases: multiple Google credentials exist, we support
    // google_workspace_oauth_template (the unified entry) as well as the
    // specific google_sheets and gmail service types.
    const DRIVE_FOLDERS_Q: &str =
        "/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.folder%27\
         +and+trashed%3Dfalse&fields=files(id,name,parents)&pageSize=100";
    const DRIVE_SHEETS_Q: &str =
        "/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27\
         +and+trashed%3Dfalse&fields=files(id,name,modifiedTime)&pageSize=100";

    for svc in ["google_workspace_oauth_template", "google_sheets", "gmail"].iter() {
        m.insert(
            (svc, "list_drive_folders"),
            DiscoveryOp::Http {
                method: "GET",
                path: DRIVE_FOLDERS_Q,
                body: None,
                headers: &[],
                items_path: Some("files"),
                value_path: "id",
                label_path: Some("name"),
                sublabel_path: None,
            },
        );
        m.insert(
            (svc, "list_sheets"),
            DiscoveryOp::Http {
                method: "GET",
                path: DRIVE_SHEETS_Q,
                body: None,
                headers: &[],
                items_path: Some("files"),
                value_path: "id",
                label_path: Some("name"),
                sublabel_path: Some("modifiedTime"),
            },
        );
    }

    // ---------------- Gmail ----------------
    // GET /gmail/v1/users/me/labels → { labels: [{ id, name, type, ... }] }
    // Registered under both `gmail` and the unified Google template so either
    // credential works.
    for svc in ["gmail", "google_workspace_oauth_template"].iter() {
        m.insert(
            (svc, "list_gmail_labels"),
            DiscoveryOp::Http {
                method: "GET",
                path: "/gmail/v1/users/me/labels",
                body: None,
                headers: &[],
                items_path: Some("labels"),
                value_path: "name",
                label_path: Some("name"),
                sublabel_path: Some("type"),
            },
        );
    }

    // ---------------- Airtable ----------------
    m.insert(
        ("airtable", "list_bases"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/v0/meta/bases",
            body: None,
            headers: &[],
            items_path: Some("bases"),
            value_path: "id",
            label_path: Some("name"),
            sublabel_path: Some("permissionLevel"),
        },
    );

    // ---------------- Asana ----------------
    m.insert(
        ("asana", "list_workspaces"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/workspaces?opt_fields=name&limit=100",
            body: None,
            headers: &[],
            items_path: Some("data"),
            value_path: "gid",
            label_path: Some("name"),
            sublabel_path: None,
        },
    );
    m.insert(
        ("asana", "list_projects"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/projects?opt_fields=name,owner&limit=100",
            body: None,
            headers: &[],
            items_path: Some("data"),
            value_path: "gid",
            label_path: Some("name"),
            sublabel_path: None,
        },
    );

    // ---------------- ClickUp ----------------
    m.insert(
        ("clickup", "list_teams"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/team",
            body: None,
            headers: &[],
            items_path: Some("teams"),
            value_path: "id",
            label_path: Some("name"),
            sublabel_path: None,
        },
    );

    // ---------------- Netlify ----------------
    m.insert(
        ("netlify", "list_sites"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/api/v1/sites?per_page=100",
            body: None,
            headers: &[],
            items_path: None,
            value_path: "name",
            label_path: Some("name"),
            sublabel_path: Some("url"),
        },
    );

    // ---------------- Vercel ----------------
    m.insert(
        ("vercel", "list_projects"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/v9/projects?limit=100",
            body: None,
            headers: &[],
            items_path: Some("projects"),
            value_path: "name",
            label_path: Some("name"),
            sublabel_path: Some("framework"),
        },
    );

    // ---------------- Cloudflare ----------------
    m.insert(
        ("cloudflare", "list_zones"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/zones?per_page=50",
            body: None,
            headers: &[],
            items_path: Some("result"),
            value_path: "name",
            label_path: Some("name"),
            sublabel_path: Some("status"),
        },
    );

    // ---------------- Neon ----------------
    m.insert(
        ("neon", "list_projects"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/projects",
            body: None,
            headers: &[],
            items_path: Some("projects"),
            value_path: "id",
            label_path: Some("name"),
            sublabel_path: Some("region_id"),
        },
    );

    // ---------------- BetterStack ----------------
    m.insert(
        ("betterstack", "list_monitors"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/api/v2/monitors?per_page=50",
            body: None,
            headers: &[],
            items_path: Some("data"),
            value_path: "id",
            label_path: Some("attributes.url"),
            sublabel_path: Some("attributes.monitor_type"),
        },
    );

    // ---------------- PostHog ----------------
    m.insert(
        ("posthog", "list_projects"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/api/projects/",
            body: None,
            headers: &[],
            items_path: Some("results"),
            value_path: "id",
            label_path: Some("name"),
            sublabel_path: None,
        },
    );

    // ---------------- HubSpot ----------------
    m.insert(
        ("hubspot", "list_deal_pipelines"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/crm/v3/pipelines/deals",
            body: None,
            headers: &[],
            items_path: Some("results"),
            value_path: "id",
            label_path: Some("label"),
            sublabel_path: None,
        },
    );
    m.insert(
        ("hubspot", "list_ticket_pipelines"),
        DiscoveryOp::Http {
            method: "GET",
            path: "/crm/v3/pipelines/tickets",
            body: None,
            headers: &[],
            items_path: Some("results"),
            value_path: "id",
            label_path: Some("label"),
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
            body,
            headers,
            items_path,
            value_path,
            label_path,
            sublabel_path,
        } => {
            if credential_id.is_empty() {
                return Err(AppError::Validation(
                    "Discovery op requires a credential_id".into(),
                ));
            }
            let credential = cred_repo::get_by_id(pool, credential_id)?;

            if credential.service_type != *service_type {
                return Err(AppError::Validation(format!(
                    "Credential service_type '{}' does not match discovery op '{}'",
                    credential.service_type, service_type
                )));
            }

            let fields = cred_repo::get_decrypted_fields(pool, &credential)?;
            let rendered_path = interpolate(path, &fields, &params)?;

            let mut custom_headers: HashMap<String, String> = HashMap::new();
            for (k, v) in headers.iter() {
                custom_headers.insert((*k).to_string(), (*v).to_string());
            }
            let body_arg = body.map(|s| s.to_string());

            let response = super::api_proxy::execute_api_request(
                pool,
                credential_id,
                method,
                &rendered_path,
                custom_headers,
                body_arg,
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
/// Rejects any resolved value that contains `/`, `?`, `#`, or control
/// characters so a malicious credential field can't break out of the
/// intended path segment.
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

/// Walk a dotted path through a JSON value. Numeric segments index into
/// arrays (so `title.0.plain_text` walks a Notion rich-text title).
fn extract_path<'a>(val: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut cur = val;
    for part in path.split('.') {
        // Array index (all-digit segment) — walk into the N-th element.
        if let Ok(idx) = part.parse::<usize>() {
            cur = cur.get(idx)?;
        } else {
            cur = cur.get(part)?;
        }
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

    #[test]
    fn extract_path_walks_array_indices() {
        // Notion title shape: title[0].plain_text
        let v: serde_json::Value = serde_json::json!({
            "title": [
                { "plain_text": "My Database", "type": "text" }
            ]
        });
        assert_eq!(
            extract_string(&v, "title.0.plain_text").as_deref(),
            Some("My Database")
        );
    }
}
