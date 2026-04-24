//! Resource listing — calls a connector's declared list endpoint to surface
//! user-pickable sub-resources (repos, projects, tables, folders, …).
//!
//! This is the HTTP dispatcher used by the ResourcePicker UI. It mirrors the
//! healthcheck pattern: load credential → decrypt fields → resolve URL/header
//! templates → fetch → map response → paginate → return picker items.
//!
//! Narrow by design: no rate-limit bookkeeping, no write operations, no
//! filesystem side effects.  Failure modes surface as `AppError::External`
//! with sanitized messages.
use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::engine::healthcheck::{resolve_template, validate_healthcheck_url};
use crate::error::AppError;
use crate::utils::sanitization::sanitize_secrets;

// ---------------------------------------------------------------------------
// Wire types (match TypeScript ResourceSpec in src/lib/types/types.ts)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ResourceSpec {
    id: String,
    #[serde(default)]
    #[allow(dead_code)]
    label: String,
    #[serde(default)]
    depends_on: Vec<String>,
    list_endpoint: ListEndpoint,
    response_mapping: ResponseMapping,
    #[serde(default = "default_ttl")]
    #[allow(dead_code)]
    cache_ttl_seconds: u32,
}

fn default_ttl() -> u32 { 600 }

#[derive(Debug, Deserialize)]
struct ListEndpoint {
    #[serde(default = "default_method")]
    method: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

fn default_method() -> String { "GET".to_string() }

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Pagination {
    None,
    LinkHeader { #[serde(default = "default_pages")] max_pages: u32 },
    PageParam {
        page_param: String,
        #[serde(default)]
        per_page: Option<u32>,
        #[serde(default = "default_pages")]
        max_pages: u32,
    },
    Cursor {
        cursor_param: String,
        cursor_path: String,
        #[serde(default = "default_pages")]
        max_pages: u32,
    },
}

fn default_pages() -> u32 { 5 }

#[derive(Debug, Deserialize)]
struct ResponseMapping {
    items_path: String,
    id: String,
    label: String,
    #[serde(default)]
    sublabel: Option<String>,
    #[serde(default)]
    meta: HashMap<String, String>,
}

/// One item surfaced to the picker.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResourceItem {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sublabel: Option<String>,
    #[serde(default)]
    pub meta: HashMap<String, serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/// List sub-resources for a given credential + resource id.
///
/// `depends_on_context` carries prior picks so `{{selected.<id>.<prop>}}`
/// templates can resolve (e.g. Figma team picked first, then project listing
/// for that team). Empty map is fine when the resource has no `depends_on`.
pub async fn list_resources(
    pool: &DbPool,
    credential_id: &str,
    resource_id: &str,
    depends_on_context: &HashMap<String, serde_json::Value>,
) -> Result<Vec<ResourceItem>, AppError> {
    // 1. Load credential + connector
    let cred = cred_repo::get_by_id(pool, credential_id)?;
    let connector = connector_repo::get_by_name(pool, &cred.service_type)?
        .ok_or_else(|| AppError::NotFound(format!("Connector {}", cred.service_type)))?;

    // 2. Parse resources spec and find the requested one
    let resources_json = connector
        .resources
        .ok_or_else(|| AppError::Validation(format!(
            "Connector {} declares no resources[]", cred.service_type
        )))?;
    let specs: Vec<ResourceSpec> = serde_json::from_str(&resources_json)
        .map_err(|e| AppError::Internal(format!("Malformed resources[] JSON: {e}")))?;
    let spec = specs
        .into_iter()
        .find(|s| s.id == resource_id)
        .ok_or_else(|| AppError::NotFound(format!(
            "Resource spec '{resource_id}' on connector '{}'", cred.service_type
        )))?;

    // 3. Verify dependent resources are in context
    for dep in &spec.depends_on {
        if !depends_on_context.contains_key(dep) {
            return Err(AppError::Validation(format!(
                "Resource '{resource_id}' requires '{dep}' to be picked first"
            )));
        }
    }

    // 4. Build template-substitution map: credential fields + prior selections.
    //    Flatten `selected.<id>.<prop>` paths so resolve_template can look them
    //    up with a single HashMap.
    let fields = cred_repo::get_decrypted_fields(pool, &cred)?;
    let mut values: HashMap<String, String> = HashMap::new();
    for (k, v) in &fields {
        values.insert(k.clone(), v.clone());
    }
    for (dep_id, dep_value) in depends_on_context {
        // Support both `{{selected.<id>}}` (for scalar selections) and
        // `{{selected.<id>.<prop>}}` (for object selections).
        match dep_value {
            serde_json::Value::String(s) => {
                values.insert(format!("selected.{dep_id}"), s.clone());
            }
            serde_json::Value::Object(map) => {
                for (prop, val) in map {
                    if let Some(s) = val.as_str() {
                        values.insert(format!("selected.{dep_id}.{prop}"), s.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    // 5. HTTP fetch with pagination
    let items = fetch_all_pages(&spec, &values).await?;

    // 6. Map each raw item through response_mapping
    let mapped = items
        .into_iter()
        .filter_map(|raw| map_item(&raw, &spec.response_mapping))
        .collect();

    Ok(mapped)
}

// ---------------------------------------------------------------------------
// HTTP fetching
// ---------------------------------------------------------------------------

async fn fetch_all_pages(
    spec: &ResourceSpec,
    values: &HashMap<String, String>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .dns_resolver(std::sync::Arc::new(
            crate::engine::ssrf_safe_dns::SsrfSafeDnsResolver,
        ))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let pagination = spec
        .list_endpoint
        .pagination
        .as_ref()
        .unwrap_or(&Pagination::None);

    let mut all: Vec<serde_json::Value> = Vec::new();
    match pagination {
        Pagination::None => {
            let body = fetch_one(&client, spec, values, None, None, None).await?;
            all.extend(extract_items(&body, &spec.response_mapping.items_path));
        }
        Pagination::LinkHeader { max_pages } => {
            let mut next_url: Option<String> = None;
            for _ in 0..*max_pages {
                let (body, next) = fetch_one_with_headers(&client, spec, values, next_url.as_deref()).await?;
                all.extend(extract_items(&body, &spec.response_mapping.items_path));
                match next {
                    Some(n) => next_url = Some(n),
                    None => break,
                }
            }
        }
        Pagination::PageParam { page_param, per_page, max_pages } => {
            for page in 1..=*max_pages {
                let mut query = vec![(page_param.clone(), page.to_string())];
                if let Some(pp) = per_page {
                    query.push(("per_page".to_string(), pp.to_string()));
                }
                let body = fetch_one(&client, spec, values, None, Some(&query), None).await?;
                let items = extract_items(&body, &spec.response_mapping.items_path);
                let empty = items.is_empty();
                all.extend(items);
                if empty { break; }
            }
        }
        Pagination::Cursor { cursor_param, cursor_path, max_pages } => {
            let mut cursor: Option<String> = None;
            for _ in 0..*max_pages {
                let query = cursor.as_ref()
                    .map(|c| vec![(cursor_param.clone(), c.clone())])
                    .unwrap_or_default();
                let body = fetch_one(&client, spec, values, None, Some(&query), None).await?;
                all.extend(extract_items(&body, &spec.response_mapping.items_path));
                cursor = jsonpath_get(&body, cursor_path)
                    .and_then(|v| v.as_str().map(String::from));
                if cursor.is_none() { break; }
            }
        }
    }
    Ok(all)
}

async fn fetch_one(
    client: &reqwest::Client,
    spec: &ResourceSpec,
    values: &HashMap<String, String>,
    override_url: Option<&str>,
    extra_query: Option<&[(String, String)]>,
    _page: Option<u32>,
) -> Result<serde_json::Value, AppError> {
    let (body, _link) = fetch_one_with_headers_inner(client, spec, values, override_url, extra_query).await?;
    Ok(body)
}

async fn fetch_one_with_headers(
    client: &reqwest::Client,
    spec: &ResourceSpec,
    values: &HashMap<String, String>,
    override_url: Option<&str>,
) -> Result<(serde_json::Value, Option<String>), AppError> {
    fetch_one_with_headers_inner(client, spec, values, override_url, None).await
}

async fn fetch_one_with_headers_inner(
    client: &reqwest::Client,
    spec: &ResourceSpec,
    values: &HashMap<String, String>,
    override_url: Option<&str>,
    extra_query: Option<&[(String, String)]>,
) -> Result<(serde_json::Value, Option<String>), AppError> {
    // Resolve URL (or use the pre-resolved link-header next URL)
    let url = match override_url {
        Some(u) => u.to_string(),
        None => resolve_template(&spec.list_endpoint.url, values),
    };

    // Reject credentials still containing `{{...}}` placeholders
    if url.contains("{{") {
        return Err(AppError::Validation(
            "Unresolved template variables in list_endpoint.url — credential fields missing?".into(),
        ));
    }
    validate_healthcheck_url(&url)?;

    let method = spec.list_endpoint.method.to_uppercase();
    let mut req = match method.as_str() {
        "POST" => client.post(&url),
        _ => client.get(&url),
    };

    for (hname, htpl) in &spec.list_endpoint.headers {
        let hval = resolve_template(htpl, values);
        req = req.header(hname, hval);
    }

    if let Some(q) = extra_query {
        req = req.query(q);
    }

    if let Some(body_tpl) = &spec.list_endpoint.body {
        req = req.body(resolve_template(body_tpl, values));
    }

    let resp = req.send().await.map_err(|e| {
        AppError::External(format!("Resource list request failed: {}", sanitize_secrets(&e.to_string())))
    })?;
    let status = resp.status();
    let next_link = parse_link_header_next(resp.headers().get("link"));

    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        return Err(AppError::External(format!(
            "Resource list returned HTTP {}: {}",
            status.as_u16(),
            sanitize_secrets(&body_text).chars().take(200).collect::<String>()
        )));
    }

    let body = resp.json::<serde_json::Value>().await.map_err(|e| {
        AppError::External(format!("Response not JSON: {}", sanitize_secrets(&e.to_string())))
    })?;
    Ok((body, next_link))
}

fn parse_link_header_next(hv: Option<&reqwest::header::HeaderValue>) -> Option<String> {
    let s = hv?.to_str().ok()?;
    // Parse RFC 5988: `<url>; rel="next", <url>; rel="prev"`
    for part in s.split(',') {
        let part = part.trim();
        if !part.contains("rel=\"next\"") { continue; }
        if let Some(start) = part.find('<') {
            if let Some(end) = part.find('>') {
                return Some(part[start + 1..end].to_string());
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// JSON path-lite (just dotted + `$` root). Not full JSONPath.
// ---------------------------------------------------------------------------

fn extract_items(root: &serde_json::Value, items_path: &str) -> Vec<serde_json::Value> {
    if items_path == "$" || items_path.is_empty() {
        return match root {
            serde_json::Value::Array(arr) => arr.clone(),
            _ => Vec::new(),
        };
    }
    match jsonpath_get(root, items_path.trim_start_matches('$').trim_start_matches('.')) {
        Some(serde_json::Value::Array(arr)) => arr,
        _ => Vec::new(),
    }
}

/// Dotted-path getter.  Does not support array indexing or wildcards.
fn jsonpath_get<'a>(root: &'a serde_json::Value, path: &str) -> Option<serde_json::Value> {
    let mut cur = root;
    for seg in path.split('.').filter(|s| !s.is_empty()) {
        cur = cur.get(seg)?;
    }
    Some(cur.clone())
}

fn map_item(raw: &serde_json::Value, mapping: &ResponseMapping) -> Option<ResourceItem> {
    let id = jsonpath_get(raw, &mapping.id)?
        .as_str()
        .map(String::from)
        .or_else(|| jsonpath_get(raw, &mapping.id).map(|v| v.to_string()))?;
    let label = jsonpath_get(raw, &mapping.label)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| id.clone());
    let sublabel = mapping
        .sublabel
        .as_deref()
        .and_then(|p| jsonpath_get(raw, p))
        .and_then(|v| v.as_str().map(String::from));
    let mut meta = HashMap::new();
    for (k, p) in &mapping.meta {
        if let Some(v) = jsonpath_get(raw, p) {
            meta.insert(k.clone(), v);
        }
    }
    Some(ResourceItem { id, label, sublabel, meta })
}
