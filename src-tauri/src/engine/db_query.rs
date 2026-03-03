//! REST-based database query execution engine.
//!
//! Dispatches queries to connector-specific HTTP APIs:
//! - Supabase: SQL-over-HTTP via `/pg/query`
//! - Neon: serverless driver HTTP endpoint
//! - Upstash: Redis REST API
//! - PlanetScale: Vitess HTTP API
//!
//! Connectors without REST APIs (raw postgres, mongodb, redis, duckdb) return
//! a "not yet supported" error with guidance.

use std::collections::HashMap;
use std::time::Instant;

use crate::db::models::QueryResult;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Maximum rows returned per query to prevent memory exhaustion.
const MAX_ROWS: usize = 500;

/// Execute a query against the database credential's service.
pub async fn execute_query(
    pool: &DbPool,
    credential_id: &str,
    query_text: &str,
) -> Result<QueryResult, AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;
    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;

    let start = Instant::now();
    let service = credential.service_type.as_str();

    let result = match service {
        "supabase" => execute_supabase(&fields, query_text).await,
        "neon" => execute_neon(&fields, query_text).await,
        "upstash" => execute_upstash(&fields, query_text).await,
        "planetscale" => execute_planetscale(&fields, query_text).await,
        other => Err(AppError::Internal(format!(
            "Direct query execution is not yet supported for '{other}'. \
             Supported connectors with REST APIs: Supabase, Neon, Upstash, PlanetScale."
        ))),
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(mut qr) => {
            qr.duration_ms = duration_ms;
            Ok(qr)
        }
        Err(e) => Err(e),
    }
}

// ============================================================================
// Supabase — SQL-over-HTTP via PostgREST pg/query endpoint
// ============================================================================

async fn execute_supabase(
    fields: &HashMap<String, String>,
    query_text: &str,
) -> Result<QueryResult, AppError> {
    let project_url = fields
        .get("project_url")
        .ok_or_else(|| AppError::Validation("Missing project_url field".into()))?;

    // Prefer service_role_key for full access; fall back to anon_key
    let api_key = fields
        .get("service_role_key")
        .or_else(|| fields.get("anon_key"))
        .ok_or_else(|| {
            AppError::Validation("Missing service_role_key or anon_key field".into())
        })?;

    let _rpc_url = format!("{}/rest/v1/rpc", project_url.trim_end_matches('/'));

    // Supabase supports raw SQL via the pg endpoint (requires service role)
    // POST /rest/v1/rpc with a custom SQL function, or use the /pg endpoint
    // We'll use the PostgREST rpc approach with a helper function.
    // Actually, Supabase has a direct SQL endpoint at /pg/query for service role.
    let sql_url = format!("{}/pg/query", project_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let resp = client
        .post(&sql_url)
        .header("apikey", api_key)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": query_text }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Supabase request failed: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read Supabase response: {e}")))?;

    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "Supabase query failed (HTTP {status}): {body}"
        )));
    }

    parse_postgres_json_response(&body)
}

// ============================================================================
// Neon — Serverless SQL-over-HTTP
// ============================================================================

async fn execute_neon(
    fields: &HashMap<String, String>,
    query_text: &str,
) -> Result<QueryResult, AppError> {
    // Neon serverless driver uses the connection string host
    let connection_string = fields
        .get("connection_string")
        .or_else(|| fields.get("database_url"))
        .ok_or_else(|| AppError::Validation("Missing connection_string field for Neon".into()))?;

    // Extract the host from the connection string for the SQL-over-HTTP endpoint
    // Format: postgresql://user:pass@ep-xxx.region.neon.tech/dbname
    let host = extract_pg_host(connection_string).ok_or_else(|| {
        AppError::Validation("Cannot extract host from Neon connection string".into())
    })?;

    let sql_url = format!("https://{}/sql", host);

    let client = reqwest::Client::new();
    let resp = client
        .post(&sql_url)
        .header("Neon-Connection-String", connection_string)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": query_text, "params": [] }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Neon request failed: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read Neon response: {e}")))?;

    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "Neon query failed (HTTP {status}): {body}"
        )));
    }

    parse_neon_response(&body)
}

// ============================================================================
// Upstash — Redis REST API
// ============================================================================

async fn execute_upstash(
    fields: &HashMap<String, String>,
    query_text: &str,
) -> Result<QueryResult, AppError> {
    let redis_url = fields
        .get("redis_rest_url")
        .or_else(|| fields.get("url"))
        .or_else(|| fields.get("endpoint"))
        .ok_or_else(|| AppError::Validation("Missing redis_rest_url field for Upstash".into()))?;

    let token = fields
        .get("redis_rest_token")
        .or_else(|| fields.get("token"))
        .or_else(|| fields.get("password"))
        .ok_or_else(|| {
            AppError::Validation("Missing redis_rest_token field for Upstash".into())
        })?;

    // Split the query into command parts (e.g., "GET mykey" → ["GET", "mykey"])
    let parts: Vec<&str> = query_text.split_whitespace().collect();
    if parts.is_empty() {
        return Err(AppError::Validation("Empty Redis command".into()));
    }

    let url = format!("{}", redis_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&parts)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Upstash request failed: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read Upstash response: {e}")))?;

    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "Upstash query failed (HTTP {status}): {body}"
        )));
    }

    parse_upstash_response(&body)
}

// ============================================================================
// PlanetScale — Vitess HTTP API
// ============================================================================

async fn execute_planetscale(
    fields: &HashMap<String, String>,
    query_text: &str,
) -> Result<QueryResult, AppError> {
    let host = fields
        .get("host")
        .or_else(|| fields.get("database_host"))
        .ok_or_else(|| AppError::Validation("Missing host field for PlanetScale".into()))?;

    let username = fields
        .get("username")
        .ok_or_else(|| AppError::Validation("Missing username field for PlanetScale".into()))?;

    let password = fields
        .get("password")
        .ok_or_else(|| AppError::Validation("Missing password field for PlanetScale".into()))?;

    let url = format!("https://{}/psdb.v1alpha1.Database/Execute", host);

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .basic_auth(username, Some(password))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "query": query_text
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("PlanetScale request failed: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read PlanetScale response: {e}")))?;

    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "PlanetScale query failed (HTTP {status}): {body}"
        )));
    }

    parse_planetscale_response(&body)
}

// ============================================================================
// Response Parsers
// ============================================================================

/// Parse a generic Postgres-style JSON response (array of objects).
fn parse_postgres_json_response(body: &str) -> Result<QueryResult, AppError> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|e| AppError::Internal(format!("Invalid JSON: {e}")))?;

    // Response may be an array of row objects or wrapped in a result key
    let rows_val = if parsed.is_array() {
        &parsed
    } else if let Some(rows) = parsed.get("rows").or(parsed.get("result")) {
        rows
    } else {
        // Single result — wrap in array
        return Ok(QueryResult {
            columns: vec!["result".into()],
            rows: vec![vec![parsed]],
            row_count: 1,
            duration_ms: 0,
            truncated: false,
        });
    };

    let arr = rows_val
        .as_array()
        .ok_or_else(|| AppError::Internal("Expected array of rows".into()))?;

    if arr.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            duration_ms: 0,
            truncated: false,
        });
    }

    // Extract columns from first row keys
    let columns: Vec<String> = if let Some(first) = arr.first().and_then(|r| r.as_object()) {
        first.keys().cloned().collect()
    } else {
        vec!["value".into()]
    };

    let truncated = arr.len() > MAX_ROWS;
    let take = arr.len().min(MAX_ROWS);

    let rows: Vec<Vec<serde_json::Value>> = arr[..take]
        .iter()
        .map(|row| {
            if let Some(obj) = row.as_object() {
                columns.iter().map(|c| obj.get(c).cloned().unwrap_or(serde_json::Value::Null)).collect()
            } else {
                vec![row.clone()]
            }
        })
        .collect();

    let row_count = rows.len();

    Ok(QueryResult {
        columns,
        rows,
        row_count,
        duration_ms: 0,
        truncated,
    })
}

/// Parse Neon serverless response.
fn parse_neon_response(body: &str) -> Result<QueryResult, AppError> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|e| AppError::Internal(format!("Invalid JSON: {e}")))?;

    // Neon response: { fields: [{name, dataTypeID}], rows: [[val, ...]], ...}
    let columns: Vec<String> = if let Some(fields) = parsed.get("fields").and_then(|f| f.as_array()) {
        fields
            .iter()
            .filter_map(|f| f.get("name").and_then(|n| n.as_str()).map(String::from))
            .collect()
    } else {
        vec![]
    };

    let raw_rows = parsed
        .get("rows")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let truncated = raw_rows.len() > MAX_ROWS;
    let take = raw_rows.len().min(MAX_ROWS);

    let rows: Vec<Vec<serde_json::Value>> = raw_rows[..take]
        .iter()
        .filter_map(|r| r.as_array().cloned())
        .collect();

    let row_count = rows.len();

    Ok(QueryResult {
        columns,
        rows,
        row_count,
        duration_ms: 0,
        truncated,
    })
}

/// Parse Upstash Redis REST response.
fn parse_upstash_response(body: &str) -> Result<QueryResult, AppError> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|e| AppError::Internal(format!("Invalid JSON: {e}")))?;

    // Upstash response: { result: <value> } or { result: [items...] }
    let result = parsed.get("result").cloned().unwrap_or(parsed.clone());

    match &result {
        serde_json::Value::Array(arr) => {
            let truncated = arr.len() > MAX_ROWS;
            let take = arr.len().min(MAX_ROWS);
            let rows: Vec<Vec<serde_json::Value>> =
                arr[..take].iter().map(|v| vec![v.clone()]).collect();
            let row_count = rows.len();
            Ok(QueryResult {
                columns: vec!["value".into()],
                rows,
                row_count,
                duration_ms: 0,
                truncated,
            })
        }
        serde_json::Value::Null => Ok(QueryResult {
            columns: vec!["result".into()],
            rows: vec![vec![serde_json::Value::Null]],
            row_count: 1,
            duration_ms: 0,
            truncated: false,
        }),
        other => Ok(QueryResult {
            columns: vec!["result".into()],
            rows: vec![vec![other.clone()]],
            row_count: 1,
            duration_ms: 0,
            truncated: false,
        }),
    }
}

/// Parse PlanetScale Vitess HTTP response.
fn parse_planetscale_response(body: &str) -> Result<QueryResult, AppError> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|e| AppError::Internal(format!("Invalid JSON: {e}")))?;

    // PlanetScale response has { result: { fields: [...], rows: [...] } }
    let result = parsed.get("result").unwrap_or(&parsed);

    let columns: Vec<String> = result
        .get("fields")
        .and_then(|f| f.as_array())
        .map(|fields| {
            fields
                .iter()
                .filter_map(|f| f.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let raw_rows = result
        .get("rows")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let truncated = raw_rows.len() > MAX_ROWS;
    let take = raw_rows.len().min(MAX_ROWS);

    let rows: Vec<Vec<serde_json::Value>> = raw_rows[..take]
        .iter()
        .map(|row| {
            if let Some(obj) = row.as_object() {
                columns
                    .iter()
                    .map(|c| obj.get(c).cloned().unwrap_or(serde_json::Value::Null))
                    .collect()
            } else if let Some(arr) = row.as_array() {
                arr.clone()
            } else {
                vec![row.clone()]
            }
        })
        .collect();

    let row_count = rows.len();

    Ok(QueryResult {
        columns,
        rows,
        row_count,
        duration_ms: 0,
        truncated,
    })
}

/// Extract the host portion from a PostgreSQL connection string.
fn extract_pg_host(conn_str: &str) -> Option<String> {
    // postgresql://user:pass@host:port/db?params
    if let Some(at_idx) = conn_str.find('@') {
        let after_at = &conn_str[at_idx + 1..];
        // Take up to the next / or ?
        let end = after_at
            .find('/')
            .unwrap_or(after_at.find('?').unwrap_or(after_at.len()));
        let host_port = &after_at[..end];
        // Strip port if present
        if let Some(colon) = host_port.rfind(':') {
            Some(host_port[..colon].to_string())
        } else {
            Some(host_port.to_string())
        }
    } else {
        None
    }
}
