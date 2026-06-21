//! KPI connector BINDINGS (docs/plans/kpi-driven-orchestration.md P6 v2).
//!
//! A connector KPI is wired to a METRIC TYPE (semantic capability), never to
//! a tool. The tool is a swappable binding: vault credential + a FROZEN
//! retrieval procedure. Procedures are composed ONCE at wiring time — by a
//! curated recipe when one exists for the (service, metric_type) pair, else
//! by an LLM that reads the connector definition + the metric-type contract —
//! then TEST-RUN against the live API; only a verified, user-confirmed
//! procedure freezes into the active binding. Every subsequent measurement is
//! a deterministic HTTP replay (reqwest) — no LLM in the measurement path.
//!
//! Switching tools archives the old binding and activates a new one; the KPI
//! row and its measurement series are never touched (the story chart reads
//! binding timestamps as rebase markers).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::db::models::{DevKpi, PersonaCredential};
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;

// =============================================================================
// Metric-type registry — the contract both recipes and the composer satisfy
// =============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct MetricType {
    pub id: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    /// "up" | "down"
    pub direction: &'static str,
    /// Connector-definition categories that can plausibly measure this.
    pub categories: &'static [&'static str],
    /// The semantic the procedure must implement (fed to the composer).
    pub contract: &'static str,
    pub min: f64,
    pub integer: bool,
}

pub const METRIC_TYPES: &[MetricType] = &[
    MetricType {
        id: "unique_visitors",
        label: "Unique visitors",
        unit: "users",
        direction: "up",
        categories: &["analytics", "marketing"],
        contract: "Count of DISTINCT human visitors/users of the product over the trailing 7 days. \
                   One non-negative integer.",
        min: 0.0,
        integer: true,
    },
    MetricType {
        id: "api_requests",
        label: "API requests",
        unit: "requests",
        direction: "up",
        categories: &["analytics", "monitoring", "cloud"],
        contract: "Total backend API requests served over the trailing 7 days. One non-negative integer.",
        min: 0.0,
        integer: true,
    },
    MetricType {
        id: "llm_tokens",
        label: "LLM tokens used",
        unit: "tokens",
        direction: "down",
        categories: &["ai"],
        contract: "Total LLM tokens (input + output) consumed by the product's API key over the \
                   trailing 7 days. One non-negative integer.",
        min: 0.0,
        integer: true,
    },
    MetricType {
        id: "llm_cost",
        label: "LLM spend",
        unit: "$",
        direction: "down",
        categories: &["ai"],
        contract: "Total LLM API spend in USD for the product's API key over the trailing 7 days. \
                   One non-negative number.",
        min: 0.0,
        integer: false,
    },
    MetricType {
        id: "revenue",
        label: "Revenue",
        unit: "$",
        direction: "up",
        categories: &["finance"],
        contract: "Gross revenue collected over the trailing 7 days in USD. One non-negative number.",
        min: 0.0,
        integer: false,
    },
    MetricType {
        id: "open_errors",
        label: "Open errors",
        unit: "issues",
        direction: "down",
        categories: &["monitoring", "devops"],
        contract: "Count of currently UNRESOLVED error issues/groups for the product. \
                   One non-negative integer.",
        min: 0.0,
        integer: true,
    },
];

pub fn metric_type(id: &str) -> Option<&'static MetricType> {
    METRIC_TYPES.iter().find(|m| m.id == id)
}

// =============================================================================
// Procedure shape — the frozen, deterministic retrieval spec
// =============================================================================

/// `{{field:KEY}}` / `{{field:KEY|DEFAULT}}` placeholders render from the
/// credential's decrypted fields at execution time; secrets never persist
/// inside the procedure itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Procedure {
    pub http: HttpSpec,
    /// "json_path:<dot.path>" (numeric leaf) or "count:<dot.path>" (array length).
    pub extract: String,
    /// One-sentence plain-language plan shown to the user before verify.
    #[serde(default)]
    pub plan: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
}

// =============================================================================
// Recipe registry — pre-verified procedures for known pairs (accelerators)
// =============================================================================

/// (service_type, metric_type) → frozen procedure JSON. A recipe is just a
/// pre-composed, pre-verified procedure for the same contract; misses fall
/// through to the LLM composer.
pub fn recipe(service_type: &str, metric_type_id: &str) -> Option<Procedure> {
    let svc = normalize_service(service_type);
    let json = match (svc.as_str(), metric_type_id) {
        ("posthog", "unique_visitors") => Some(
            r#"{
              "http": {
                "method": "POST",
                "url": "{{field:host|https://us.posthog.com}}/api/projects/@current/query",
                "headers": {"Authorization": "Bearer {{field:personal_api_key}}", "Content-Type": "application/json"},
                "body": {"query": {"kind": "HogQLQuery", "query": "SELECT count(DISTINCT person_id) FROM events WHERE event = '$pageview' AND timestamp > now() - INTERVAL 7 DAY"}}
              },
              "extract": "json_path:results.0.0",
              "plan": "Asks PostHog for the count of distinct persons with a pageview in the last 7 days."
            }"#,
        ),
        ("posthog", "api_requests") => Some(
            r#"{
              "http": {
                "method": "POST",
                "url": "{{field:host|https://us.posthog.com}}/api/projects/@current/query",
                "headers": {"Authorization": "Bearer {{field:personal_api_key}}", "Content-Type": "application/json"},
                "body": {"query": {"kind": "HogQLQuery", "query": "SELECT count() FROM events WHERE event = 'api_request' AND timestamp > now() - INTERVAL 7 DAY"}}
              },
              "extract": "json_path:results.0.0",
              "plan": "Asks PostHog for the count of api_request events captured in the last 7 days."
            }"#,
        ),
        _ => None,
    };
    json.and_then(|j| serde_json::from_str(j).ok())
}

fn normalize_service(s: &str) -> String {
    s.to_lowercase().replace(['-', '_'], "")
}

// =============================================================================
// Matching — which vault credentials can measure a metric type
// =============================================================================

#[derive(Debug, Serialize)]
pub struct MatchingCredential {
    pub credential_id: String,
    pub name: String,
    pub service_type: String,
    pub connector_label: String,
    pub category: String,
    pub has_recipe: bool,
}

/// Vault credential instances whose connector definition's category matches
/// the metric type's compatible categories. Service-type ↔ definition-name
/// matching normalizes kebab/snake case.
pub fn find_matching_credentials(
    pool: &DbPool,
    metric_type_id: &str,
) -> Result<Vec<MatchingCredential>, AppError> {
    let Some(mt) = metric_type(metric_type_id) else {
        return Err(AppError::Validation(format!("Unknown metric type '{metric_type_id}'")));
    };
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.service_type, d.label, d.category
         FROM persona_credentials c
         JOIN connector_definitions d
           ON REPLACE(REPLACE(LOWER(d.name), '-', ''), '_', '') =
              REPLACE(REPLACE(LOWER(c.service_type), '-', ''), '_', '')
         ORDER BY c.name",
    )?;
    let rows: Vec<(String, String, String, String, String)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .filter_map(Result::ok)
        .collect();
    Ok(rows
        .into_iter()
        .filter(|(_, _, _, _, cat)| mt.categories.contains(&cat.as_str()))
        .map(|(id, name, service_type, label, category)| MatchingCredential {
            has_recipe: recipe(&service_type, metric_type_id).is_some(),
            credential_id: id,
            name,
            service_type,
            connector_label: label,
            category,
        })
        .collect())
}

// =============================================================================
// Deterministic execution — render templates, call the API, extract a number
// =============================================================================

fn render_template(s: &str, fields: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("{{field:") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 8..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let spec = &after[..end];
        let (key, default) = match spec.split_once('|') {
            Some((k, d)) => (k, Some(d)),
            None => (spec, None),
        };
        match fields.get(key).filter(|v| !v.trim().is_empty()) {
            Some(v) => out.push_str(v),
            None => out.push_str(default.unwrap_or("")),
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

fn extract_value(body: &serde_json::Value, extract: &str) -> Option<f64> {
    let (mode, path) = extract.split_once(':')?;
    // Root-of-document spellings LLM composers reach for: "", "$", ".".
    let path = path.trim().trim_start_matches('$').trim_start_matches('.');
    let mut cur = body;
    for seg in path.split('.').filter(|s| !s.is_empty()) {
        cur = match seg.parse::<usize>() {
            Ok(idx) => cur.get(idx)?,
            Err(_) => cur.get(seg)?,
        };
    }
    match mode {
        "json_path" => cur.as_f64().or_else(|| cur.as_str().and_then(|s| s.parse().ok())),
        "count" => cur.as_array().map(|a| a.len() as f64),
        _ => None,
    }
}

/// Execute a frozen procedure against a credential. Returns (value, evidence).
pub async fn execute_procedure(
    pool: &DbPool,
    credential_id: &str,
    procedure: &Procedure,
) -> Result<(f64, String), AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;
    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;

    let url = render_template(&procedure.http.url, &fields);
    let method = reqwest::Method::from_bytes(procedure.http.method.to_uppercase().as_bytes())
        .map_err(|_| AppError::Validation(format!("Bad HTTP method '{}'", procedure.http.method)))?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client: {e}")))?;

    let mut req = client.request(method, &url);
    for (k, v) in &procedure.http.headers {
        req = req.header(k, render_template(v, &fields));
    }
    if let Some(body) = &procedure.http.body {
        // Render templates inside the JSON body via its string form.
        let rendered = render_template(&body.to_string(), &fields);
        let parsed: serde_json::Value = serde_json::from_str(&rendered)
            .map_err(|e| AppError::Validation(format!("Procedure body is not valid JSON after templating: {e}")))?;
        req = req.json(&parsed);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Measurement request failed: {e}")))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Measurement response unreadable: {e}")))?;
    if !status.is_success() {
        return Err(AppError::Validation(format!(
            "Measurement API returned {status}: {}",
            crate::utils::text::truncate_on_char_boundary(&text, 300)
        )));
    }
    let body: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| AppError::Validation("Measurement response is not JSON".into()))?;
    let value = extract_value(&body, &procedure.extract).ok_or_else(|| {
        AppError::Validation(format!(
            "Extractor '{}' found no number (response excerpt: {})",
            procedure.extract,
            crate::utils::text::truncate_on_char_boundary(&text, 300)
        ))
    })?;

    let evidence = serde_json::json!({
        "service": credential.service_type,
        "credential": credential.name,
        "url": url,
        "extract": procedure.extract,
        "response_excerpt": crate::utils::text::truncate_on_char_boundary(&text, 600),
    })
    .to_string();
    Ok((value, evidence))
}

/// Contract invariants — a value that violates them never freezes a binding
/// and never records a measurement.
pub fn check_invariants(mt: &MetricType, value: f64) -> Result<(), AppError> {
    if !value.is_finite() {
        return Err(AppError::Validation("Measured value is not a finite number".into()));
    }
    if value < mt.min {
        return Err(AppError::Validation(format!(
            "Measured value {value} violates the '{}' contract (min {})",
            mt.id, mt.min
        )));
    }
    if mt.integer && value.fract().abs() > 1e-9 {
        return Err(AppError::Validation(format!(
            "Measured value {value} violates the '{}' contract (must be an integer count)",
            mt.id
        )));
    }
    Ok(())
}

// =============================================================================
// Composition — recipe hit, else LLM composes once (then freeze-on-confirm)
// =============================================================================

#[derive(Debug, Deserialize)]
struct ProcedureEnvelope {
    kpi_procedure: Procedure,
}

fn parse_procedure(blob: &str) -> Option<Procedure> {
    let marker = "\"kpi_procedure\"";
    let mut result = None;
    let mut from = 0;
    while let Some(rel) = blob[from..].find(marker) {
        let pos = from + rel;
        from = pos + marker.len();
        let Some(open) = blob[..pos].rfind('{') else { continue };
        if let Some(close) = crate::companion::athena_reaction::match_braces(&blob[open..]) {
            if let Ok(env) = serde_json::from_str::<ProcedureEnvelope>(&blob[open..open + close + 1]) {
                result = Some(env.kpi_procedure);
            }
        }
    }
    result
}

fn connector_brief(pool: &DbPool, service_type: &str) -> String {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    conn.query_row(
        "SELECT label, category, fields, COALESCE(metadata,'') FROM connector_definitions
         WHERE REPLACE(REPLACE(LOWER(name),'-',''),'_','') = REPLACE(REPLACE(LOWER(?1),'-',''),'_','')",
        rusqlite::params![service_type],
        |r| {
            let label: String = r.get(0)?;
            let category: String = r.get(1)?;
            let fields: String = r.get(2)?;
            let metadata: String = r.get(3)?;
            Ok(format!(
                "Connector: {label} (category {category})\nCredential fields (use as {{{{field:KEY}}}} placeholders): {fields}\nMetadata: {}",
                crate::utils::text::truncate_on_char_boundary(&metadata, 600)
            ))
        },
    )
    .unwrap_or_default()
}

/// Compose a procedure for (kpi, credential): recipe hit is instant; a miss
/// asks the LLM to compose against the connector definition + the metric-type
/// contract. The returned procedure is NOT yet frozen — the caller verifies
/// it live and only persists on user confirmation.
pub async fn compose_procedure(
    pool: &DbPool,
    kpi: &DevKpi,
    credential_id: &str,
) -> Result<(Procedure, &'static str), AppError> {
    let mt_id = kpi
        .metric_type
        .as_deref()
        .ok_or_else(|| AppError::Validation("KPI has no metric_type set".into()))?;
    let mt = metric_type(mt_id)
        .ok_or_else(|| AppError::Validation(format!("Unknown metric type '{mt_id}'")))?;
    let credential = cred_repo::get_by_id(pool, credential_id)?;

    if let Some(p) = recipe(&credential.service_type, mt_id) {
        return Ok((p, "recipe"));
    }

    let brief = connector_brief(pool, &credential.service_type);
    let field_keys: Vec<String> = cred_repo::get_decrypted_fields(pool, &credential)
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    let prompt = format!(
        r#"You are composing a deterministic metric-retrieval procedure for an autonomous KPI system. The procedure is FROZEN after one successful verification and replayed mechanically — design it to be stable, single-request, and unambiguous.

METRIC TYPE CONTRACT
- id: {mt_id}
- semantic: {contract}
- output: exactly one number ({unit}), {int_rule}

CONNECTOR
{brief}
Available credential field keys on this instance: {field_keys:?}

KPI context: "{kpi_name}" for a software product. {kpi_desc}

Compose ONE HTTPS request against this connector's public REST API that returns the contract's number, plus an extractor:
- Use {{{{field:KEY}}}} placeholders for secrets/hosts (NEVER inline real values). Optional default: {{{{field:KEY|https://default.host}}}}.
- "extract" is "json_path:<dot.path>" to a numeric leaf in the response (array indices are numeric segments, e.g. results.0.0) or "count:<dot.path>" for an array length. When the response ROOT is the target array, use "count:" with an empty path. No JSONPath operators ($, [*], filters) — dot-paths only.
- Prefer the API's native aggregation over client-side math; trailing 7-day window where the contract says so.
- A single-request approximation IS acceptable where the API paginates (e.g. a count capped at one page of results) — prefer that over declining, and state the bound in the plan.
- "plan" = one sentence a non-technical user reads before approving.

Emit {{"kpi_procedure": null}} ONLY when the connector's API genuinely cannot produce this metric at all (wrong domain, no relevant endpoint) — not because of pagination limits or approximation concerns.

Respond with your analysis, then EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"kpi_procedure": {{"http": {{"method": "GET", "url": "...", "headers": {{}}, "body": null}}, "extract": "json_path:...", "plan": "..."}}}}
"#,
        mt_id = mt_id,
        contract = mt.contract,
        unit = mt.unit,
        int_rule = if mt.integer { "integer" } else { "decimal allowed" },
        brief = brief,
        field_keys = field_keys,
        kpi_name = kpi.name,
        kpi_desc = kpi.description.as_deref().unwrap_or(""),
    );

    // The CLI round-trip is non-deterministic and can also fail fast (early
    // exit, drained-stderr error, contention with background cli_text users
    // like Athena reactions) — retry once before giving up. An explicit
    // `"kpi_procedure": null` is the model DECLINING the contract; that is an
    // answer, not a flake, so it does not retry.
    let mut declined = false;
    for attempt in 0..2u8 {
        let (blob, usage) =
            crate::companion::athena_reaction::cli_text_with_usage(prompt.clone()).await?;
        // tiger #1: record headless spend per attempt (best-effort).
        if let Some(u) = &usage {
            crate::db::repos::llm_spend::record(
                pool,
                &crate::db::models::LlmSpendInsert {
                    source: "kpi".to_string(),
                    trigger_kind: "kpi_binding".to_string(),
                    model: Some("claude-sonnet-4-6".to_string()),
                    input_tokens: u.input_tokens,
                    output_tokens: u.output_tokens,
                    cache_read_tokens: u.cache_read_tokens,
                    cache_creation_tokens: u.cache_creation_tokens,
                    cost_usd: u.cost_usd,
                    duration_ms: u.duration_ms,
                    num_turns: u.num_turns,
                    is_error: u.is_error,
                    persona_id: None,
                    project_id: Some(kpi.project_id.clone()),
                },
            );
        }
        if let Some(procedure) = parse_procedure(&blob) {
            return Ok((procedure, "llm"));
        }
        declined = blob.contains("\"kpi_procedure\": null") || blob.contains("\"kpi_procedure\":null");
        if declined {
            break;
        }
        tracing::warn!(
            attempt,
            blob_len = blob.len(),
            excerpt = %crate::utils::text::truncate_on_char_boundary(&blob, 200),
            "kpi_binding: composer output had no parseable procedure"
        );
    }
    Err(AppError::Validation(if declined {
        "The composer judged this connector's API unable to answer this metric type with a \
         single request — try a different connector, or wire this KPI manually"
            .into()
    } else {
        "The composer could not produce a confident procedure for this connector — \
         try again or pick a different connector"
            .into()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_renders_fields_and_defaults() {
        let mut f = HashMap::new();
        f.insert("personal_api_key".to_string(), "phx_123".to_string());
        assert_eq!(
            render_template("Bearer {{field:personal_api_key}}", &f),
            "Bearer phx_123"
        );
        assert_eq!(
            render_template("{{field:host|https://us.posthog.com}}/api", &f),
            "https://us.posthog.com/api"
        );
        f.insert("host".to_string(), "https://eu.posthog.com".to_string());
        assert_eq!(
            render_template("{{field:host|https://us.posthog.com}}/api", &f),
            "https://eu.posthog.com/api"
        );
    }

    #[test]
    fn extractor_walks_paths_and_counts() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"results":[[42]],"items":[1,2,3],"s":{"n":"7.5"}}"#).unwrap();
        assert_eq!(extract_value(&v, "json_path:results.0.0"), Some(42.0));
        assert_eq!(extract_value(&v, "count:items"), Some(3.0));
        assert_eq!(extract_value(&v, "json_path:s.n"), Some(7.5));
        assert_eq!(extract_value(&v, "json_path:missing"), None);
        // Root-array spellings (empty path, "$", ".") all count the root.
        let root = serde_json::json!([1, 2]);
        assert_eq!(extract_value(&root, "count:"), Some(2.0));
        assert_eq!(extract_value(&root, "count:$"), Some(2.0));
        assert_eq!(extract_value(&root, "count:."), Some(2.0));
    }

    #[test]
    fn invariants_reject_contract_violations() {
        let mt = metric_type("unique_visitors").unwrap();
        assert!(check_invariants(mt, 10.0).is_ok());
        assert!(check_invariants(mt, -1.0).is_err());
        assert!(check_invariants(mt, 3.5).is_err()); // integer contract
        let cost = metric_type("llm_cost").unwrap();
        assert!(check_invariants(cost, 3.5).is_ok());
    }

    #[test]
    fn recipes_exist_for_posthog_pairs() {
        assert!(recipe("posthog", "unique_visitors").is_some());
        assert!(recipe("posthog", "api_requests").is_some());
        assert!(recipe("sentry", "open_errors").is_none()); // LLM path
    }
}
