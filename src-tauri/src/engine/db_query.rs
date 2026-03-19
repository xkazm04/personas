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
use std::sync::OnceLock;
use std::time::Instant;

use serde_json::Value;

use crate::db::models::QueryResult;
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

/// Maximum rows returned per query to prevent memory exhaustion.
const MAX_ROWS: usize = 500;

/// Return the shared HTTP client (30-second timeout, connection pooling).
fn http_client() -> reqwest::Client {
    crate::SHARED_HTTP.clone()
}

/// Strip credential material from error messages before they reach the UI,
/// Sentry breadcrumbs, or log files.
///
/// Removes connection strings (`postgresql://...`), bearer tokens, API keys
/// in common header patterns, and basic auth credentials.
///
/// Regexes are compiled once and cached via `OnceLock` to avoid per-call overhead.
fn sanitize_error(msg: &str, fields: &HashMap<String, String>) -> String {
    static RE_CONNSTR: OnceLock<regex::Regex> = OnceLock::new();
    static RE_BEARER: OnceLock<regex::Regex> = OnceLock::new();
    static RE_BASIC: OnceLock<regex::Regex> = OnceLock::new();

    let mut sanitized = msg.to_string();

    // Strip all field values that look like secrets (anything non-empty)
    for (key, value) in fields {
        if value.len() >= 8 {
            // Only redact values long enough to be meaningful secrets.
            // Short values (booleans, ports) aren't sensitive.
            sanitized = sanitized.replace(value, &format!("[REDACTED:{}]", key));
        }
    }

    // Strip common connection string patterns (postgresql://user:pass@host/db)
    let re_connstr = RE_CONNSTR.get_or_init(|| {
        regex::Regex::new(r"(?i)postgres(?:ql)?://[^\s,\]})']+" ).unwrap()
    });
    sanitized = re_connstr.replace_all(&sanitized, "[REDACTED:connection_string]").to_string();

    // Strip Bearer tokens that may appear in echoed headers
    let re_bearer = RE_BEARER.get_or_init(|| {
        regex::Regex::new(r"(?i)Bearer\s+[A-Za-z0-9._\-]+").unwrap()
    });
    sanitized = re_bearer.replace_all(&sanitized, "Bearer [REDACTED]").to_string();

    // Strip Basic auth credentials
    let re_basic = RE_BASIC.get_or_init(|| {
        regex::Regex::new(r"(?i)Basic\s+[A-Za-z0-9+/=]+").unwrap()
    });
    sanitized = re_basic.replace_all(&sanitized, "Basic [REDACTED]").to_string();

    sanitized
}

/// Execute a query against the database credential's service.
///
/// `user_db` is required for `personas_database` (built-in SQLite) queries.
/// Pass `None` when the caller does not have access to the user database pool
/// (legacy call sites) -- `personas_database` queries will return an error.
pub async fn execute_query(
    pool: &DbPool,
    credential_id: &str,
    query_text: &str,
    user_db: Option<&UserDbPool>,
) -> Result<QueryResult, AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;

    let start = Instant::now();
    let service = credential.service_type.as_str();

    // Built-in local database -- no external credentials needed
    if service == "personas_database" {
        let udb = user_db.ok_or_else(|| {
            AppError::Internal("User database pool not available".to_string())
        })?;
        let mut qr = execute_local_sqlite(udb, query_text)?;
        qr.duration_ms = start.elapsed().as_millis() as u64;
        qr.row_count = qr.rows.len();
        return Ok(qr);
    }

    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;
    let _ = audit_log::log_decrypt(pool, credential_id, &credential.name, "db_query:execute", None, None);

    let result = match service {
        "supabase" => execute_supabase(&fields, query_text).await,
        "neon" => execute_neon(&fields, query_text).await,
        "upstash" => execute_upstash(&fields, query_text).await,
        "planetscale" => execute_planetscale(&fields, query_text).await,
        "convex" => execute_convex(&fields, query_text).await,
        other => Err(AppError::Internal(format!(
            "Direct query execution is not yet supported for '{other}'. \
             Supported connectors with REST APIs: Supabase, Neon, Upstash, PlanetScale, Convex."
        ))),
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(mut qr) => {
            qr.duration_ms = duration_ms;
            tracing::info!(
                service_type = %service,
                credential_id = %credential_id,
                duration_ms = duration_ms,
                row_count = qr.row_count,
                truncated = qr.truncated,
                "db_query::execute_query completed"
            );
            Ok(qr)
        }
        Err(e) => {
            let sanitized = sanitize_error(&e.to_string(), &fields);
            tracing::warn!(
                service_type = %service,
                credential_id = %credential_id,
                duration_ms = duration_ms,
                error = %sanitized,
                "db_query::execute_query failed"
            );
            Err(AppError::Internal(sanitized))
        }
    }
}

// ============================================================================
// Introspection -- connector-aware table/column discovery
// ============================================================================

/// Introspect tables for a credential. Supabase uses the PostgREST OpenAPI spec;
/// SQL-based connectors use `information_schema`; Redis uses SCAN.
pub async fn introspect_tables(
    pool: &DbPool,
    credential_id: &str,
    user_db: Option<&UserDbPool>,
) -> Result<QueryResult, AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;

    if credential.service_type == "personas_database" {
        let udb = user_db.ok_or_else(|| {
            AppError::Internal("User database pool not available".to_string())
        })?;
        let start = Instant::now();
        let mut qr = introspect_local_sqlite_tables(udb)?;
        qr.duration_ms = start.elapsed().as_millis() as u64;
        qr.row_count = qr.rows.len();
        return Ok(qr);
    }

    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;
    let _ = audit_log::log_decrypt(pool, credential_id, &credential.name, "db_query:introspect_tables", None, None);
    let start = Instant::now();

    let result = match credential.service_type.as_str() {
        "supabase" => introspect_supabase_tables(&fields).await,
        "neon" => {
            let q = "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name";
            execute_neon(&fields, q).await
        }
        "planetscale" => {
            let q = "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name";
            execute_planetscale(&fields, q).await
        }
        "upstash" | "redis" => {
            execute_upstash(&fields, "SCAN 0 MATCH * COUNT 100").await
        }
        "convex" => introspect_convex_tables(&fields).await,
        other => Err(AppError::Internal(format!(
            "Table introspection is not supported for '{other}'."
        ))),
    };

    let duration_ms = start.elapsed().as_millis() as u64;
    let service = credential.service_type.as_str();
    match result {
        Ok(mut qr) => {
            qr.duration_ms = duration_ms;
            tracing::info!(
                service_type = %service,
                credential_id = %credential_id,
                duration_ms = duration_ms,
                row_count = qr.row_count,
                truncated = qr.truncated,
                "db_query::introspect_tables completed"
            );
            Ok(qr)
        }
        Err(e) => {
            let sanitized = sanitize_error(&e.to_string(), &fields);
            tracing::warn!(
                service_type = %service,
                credential_id = %credential_id,
                duration_ms = duration_ms,
                error = %sanitized,
                "db_query::introspect_tables failed"
            );
            Err(AppError::Internal(sanitized))
        }
    }
}

/// Introspect columns for a specific table. Supabase uses OpenAPI spec;
/// SQL connectors use `information_schema.columns`.
pub async fn introspect_columns(
    pool: &DbPool,
    credential_id: &str,
    table_name: &str,
    user_db: Option<&UserDbPool>,
) -> Result<QueryResult, AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;

    if credential.service_type == "personas_database" {
        let udb = user_db.ok_or_else(|| {
            AppError::Internal("User database pool not available".to_string())
        })?;
        let start = Instant::now();
        let mut qr = introspect_local_sqlite_columns(udb, table_name)?;
        qr.duration_ms = start.elapsed().as_millis() as u64;
        qr.row_count = qr.rows.len();
        return Ok(qr);
    }

    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;
    let _ = audit_log::log_decrypt(pool, credential_id, &credential.name, "db_query:introspect_columns", None, None);
    let start = Instant::now();
    let safe_name = table_name.replace(|c: char| !c.is_alphanumeric() && c != '_', "");

    let result = match credential.service_type.as_str() {
        "supabase" => introspect_supabase_columns(&fields, &safe_name).await,
        "neon" => {
            execute_neon_parameterized(
                &fields,
                "SELECT column_name, data_type, is_nullable, column_default \
                 FROM information_schema.columns \
                 WHERE table_schema = 'public' AND table_name = $1 \
                 ORDER BY ordinal_position",
                &[&safe_name],
            )
            .await
        }
        "planetscale" => {
            execute_planetscale_parameterized(
                &fields,
                "SELECT column_name, column_type, is_nullable, column_default \
                 FROM information_schema.columns \
                 WHERE table_schema = DATABASE() AND table_name = ? \
                 ORDER BY ordinal_position",
                &[&safe_name],
            )
            .await
        }
        "convex" => introspect_convex_columns(&fields, &safe_name).await,
        other => Err(AppError::Internal(format!(
            "Column introspection is not supported for '{other}'."
        ))),
    };

    let duration_ms = start.elapsed().as_millis() as u64;
    let service = credential.service_type.as_str();
    match result {
        Ok(mut qr) => {
            qr.duration_ms = duration_ms;
            tracing::info!(
                service_type = %service,
                credential_id = %credential_id,
                duration_ms = duration_ms,
                row_count = qr.row_count,
                truncated = qr.truncated,
                table_name = %safe_name,
                "db_query::introspect_columns completed"
            );
            Ok(qr)
        }
        Err(e) => {
            let sanitized = sanitize_error(&e.to_string(), &fields);
            tracing::warn!(
                service_type = %service,
                credential_id = %credential_id,
                duration_ms = duration_ms,
                table_name = %safe_name,
                error = %sanitized,
                "db_query::introspect_columns failed"
            );
            Err(AppError::Internal(sanitized))
        }
    }
}

// -- Supabase OpenAPI introspection --------------------------------------

/// Fetch the PostgREST OpenAPI spec and extract table names.
async fn introspect_supabase_tables(
    fields: &HashMap<String, String>,
) -> Result<QueryResult, AppError> {
    let spec = fetch_supabase_openapi_spec(fields).await?;

    let definitions = spec
        .get("definitions")
        .and_then(|d| d.as_object())
        .ok_or_else(|| AppError::Internal("OpenAPI spec has no definitions".into()))?;

    let rows: Vec<Vec<Value>> = definitions
        .keys()
        .map(|name| {
            vec![
                Value::String(name.clone()),
                Value::String("BASE TABLE".to_string()),
            ]
        })
        .collect();

    let row_count = rows.len();
    Ok(QueryResult {
        columns: vec!["table_name".into(), "table_type".into()],
        rows,
        row_count,
        duration_ms: 0,
        truncated: false,
    })
}

/// Fetch the PostgREST OpenAPI spec and extract column details for one table.
async fn introspect_supabase_columns(
    fields: &HashMap<String, String>,
    table_name: &str,
) -> Result<QueryResult, AppError> {
    let spec = fetch_supabase_openapi_spec(fields).await?;

    let definitions = spec
        .get("definitions")
        .and_then(|d| d.as_object())
        .ok_or_else(|| AppError::Internal("OpenAPI spec has no definitions".into()))?;

    let table_def = definitions
        .get(table_name)
        .ok_or_else(|| AppError::Internal(format!("Table '{table_name}' not found in schema")))?;

    let empty_map = serde_json::Map::new();
    let properties = table_def
        .get("properties")
        .and_then(|p| p.as_object())
        .unwrap_or(&empty_map);

    let required: Vec<String> = table_def
        .get("required")
        .and_then(|r| r.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let rows: Vec<Vec<Value>> = properties
        .iter()
        .map(|(col_name, col_def)| {
            let pg_type = col_def
                .get("format")
                .and_then(|f| f.as_str())
                .or_else(|| col_def.get("type").and_then(|t| t.as_str()))
                .unwrap_or("unknown");

            let is_nullable = if required.contains(col_name) {
                "NO"
            } else {
                "YES"
            };

            let default_val = col_def
                .get("default")
                .map(|d| Value::String(d.to_string()))
                .unwrap_or(Value::Null);

            vec![
                Value::String(col_name.clone()),
                Value::String(pg_type.to_string()),
                Value::String(is_nullable.to_string()),
                default_val,
            ]
        })
        .collect();

    let row_count = rows.len();
    Ok(QueryResult {
        columns: vec![
            "column_name".into(),
            "data_type".into(),
            "is_nullable".into(),
            "column_default".into(),
        ],
        rows,
        row_count,
        duration_ms: 0,
        truncated: false,
    })
}

/// Fetch the PostgREST OpenAPI spec from `GET {project_url}/rest/v1/`.
async fn fetch_supabase_openapi_spec(
    fields: &HashMap<String, String>,
) -> Result<Value, AppError> {
    let project_url = fields
        .get("project_url")
        .ok_or_else(|| AppError::Validation("Missing project_url field".into()))?;

    let api_key = fields
        .get("service_role_key")
        .or_else(|| fields.get("anon_key"))
        .ok_or_else(|| {
            AppError::Validation("Missing service_role_key or anon_key field".into())
        })?;

    let spec_url = format!("{}/rest/v1/", project_url.trim_end_matches('/'));

    let client = http_client();
    let resp = client
        .get(&spec_url)
        .header("apikey", api_key)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/openapi+json")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Supabase OpenAPI request failed: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read Supabase response: {e}")))?;

    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "Supabase OpenAPI request failed (HTTP {status}): {body}"
        )));
    }

    serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("Failed to parse OpenAPI spec: {e}")))
}

// ============================================================================
// Supabase -- PostgREST REST API (SELECT queries converted to REST calls)
// ============================================================================

pub(crate) async fn execute_supabase(
    fields: &HashMap<String, String>,
    query_text: &str,
) -> Result<QueryResult, AppError> {
    let project_url = fields
        .get("project_url")
        .ok_or_else(|| AppError::Validation("Missing project_url field".into()))?;

    let api_key = fields
        .get("service_role_key")
        .or_else(|| fields.get("anon_key"))
        .ok_or_else(|| {
            AppError::Validation("Missing service_role_key or anon_key field".into())
        })?;

    let base = project_url.trim_end_matches('/');
    let sql = query_text.trim().trim_end_matches(';').trim();

    // Parse SELECT queries and convert to PostgREST REST API calls.
    // Supabase cloud does not have a raw SQL endpoint.
    let parsed = parse_select_to_postgrest(sql).ok_or_else(|| {
        AppError::Internal(
            "Supabase REST API only supports SELECT queries. \
             Complex SQL (JOINs, subqueries, aggregates, INSERT/UPDATE/DELETE) \
             is not available via the PostgREST API. \
             Use simple queries like: SELECT * FROM table_name LIMIT 100"
                .into(),
        )
    })?;

    let mut url = format!("{}/rest/v1/{}?select={}", base, parsed.table, parsed.select);

    if let Some(limit) = parsed.limit {
        url.push_str(&format!("&limit={limit}"));
    }
    if let Some(ref order) = parsed.order {
        url.push_str(&format!("&order={order}"));
    }
    for filter in &parsed.filters {
        url.push_str(&format!("&{filter}"));
    }

    let client = http_client();
    let resp = client
        .get(&url)
        .header("apikey", api_key)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .header("Prefer", "count=exact")
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

/// Parsed SELECT query components for PostgREST conversion.
struct PostgrestSelect {
    table: String,
    select: String,
    limit: Option<u32>,
    order: Option<String>,
    filters: Vec<String>,
}

/// Parse a simple SELECT SQL query into PostgREST components.
///
/// Supports: SELECT [cols] FROM table [WHERE simple_conds] [ORDER BY cols] [LIMIT n]
/// Does NOT support: JOINs, subqueries, GROUP BY, HAVING, UNION, CTEs, aggregates.
fn parse_select_to_postgrest(sql: &str) -> Option<PostgrestSelect> {
    let upper = sql.to_uppercase();
    if !upper.starts_with("SELECT") {
        return None;
    }

    // Reject unsupported constructs
    for kw in &["JOIN ", "GROUP BY", "HAVING ", "UNION ", "WITH ", "INSERT ", "UPDATE ", "DELETE "] {
        if upper.contains(kw) {
            return None;
        }
    }

    // Split into clauses by finding keyword positions
    let from_pos = upper.find(" FROM ")?;
    let select_part = sql[6..from_pos].trim(); // after "SELECT"

    let after_from = &sql[from_pos + 6..]; // after " FROM "
    let after_from_upper = upper[from_pos + 6..].to_string();

    // Extract table name (first word after FROM, stripping quotes)
    let table_end = after_from
        .find(|c: char| c.is_whitespace())
        .unwrap_or(after_from.len());
    let table = after_from[..table_end]
        .trim_matches(|c: char| c == '"' || c == '`' || c == '\'')
        .to_string();

    if table.is_empty() {
        return None;
    }

    // Strip schema prefix (e.g., "public.table_name" -> "table_name")
    let table = if let Some(dot_pos) = table.find('.') {
        table[dot_pos + 1..].to_string()
    } else {
        table
    };

    let remainder = after_from[table_end..].trim();
    let remainder_upper = after_from_upper[table_end..].trim().to_string();

    // Parse SELECT columns
    let select = if select_part == "*" {
        "*".to_string()
    } else {
        select_part
            .split(',')
            .map(|c| c.trim().trim_matches(|ch: char| ch == '"' || ch == '`'))
            .collect::<Vec<_>>()
            .join(",")
    };

    let mut limit: Option<u32> = None;
    let mut order: Option<String> = None;
    let mut filters: Vec<String> = Vec::new();

    // Extract LIMIT
    if let Some(lim_pos) = remainder_upper.find("LIMIT ") {
        let after_limit = remainder[lim_pos + 6..].trim();
        if let Some(num) = after_limit.split_whitespace().next() {
            limit = num.parse().ok();
        }
    }

    // Extract ORDER BY
    if let Some(ord_pos) = remainder_upper.find("ORDER BY ") {
        let after_order = &remainder[ord_pos + 9..];
        // Take until LIMIT or end
        let end = after_order
            .to_uppercase()
            .find("LIMIT ")
            .unwrap_or(after_order.len());
        let order_str = after_order[..end].trim();

        let order_parts: Vec<String> = order_str
            .split(',')
            .map(|part| {
                let part = part.trim();
                let upper_part = part.to_uppercase();
                if upper_part.ends_with(" DESC") {
                    let col = part[..part.len() - 5]
                        .trim()
                        .trim_matches(|c: char| c == '"' || c == '`');
                    format!("{col}.desc")
                } else if upper_part.ends_with(" ASC") {
                    let col = part[..part.len() - 4]
                        .trim()
                        .trim_matches(|c: char| c == '"' || c == '`');
                    format!("{col}.asc")
                } else {
                    let col = part.trim_matches(|c: char| c == '"' || c == '`');
                    format!("{col}.asc")
                }
            })
            .collect();

        order = Some(order_parts.join(","));
    }

    // Extract simple WHERE conditions
    if let Some(where_pos) = remainder_upper.find("WHERE ") {
        let after_where = &remainder[where_pos + 6..];
        // Take until ORDER BY or LIMIT or end
        let end = ["ORDER BY", "LIMIT "]
            .iter()
            .filter_map(|kw| after_where.to_uppercase().find(kw))
            .min()
            .unwrap_or(after_where.len());
        let where_str = after_where[..end].trim();

        // Parse simple AND-separated conditions: col = val, col > val, etc.
        for cond in where_str.split(" AND ") {
            let cond = cond.trim();
            if let Some(filter) = parse_postgrest_filter(cond) {
                filters.push(filter);
            }
        }
    }

    // Default limit if none specified
    if limit.is_none() {
        limit = Some(500);
    }

    Some(PostgrestSelect {
        table,
        select,
        limit,
        order,
        filters,
    })
}

/// Parse a single WHERE condition into a PostgREST filter parameter.
/// Supports: col = val, col != val, col > val, col < val, col >= val, col <= val,
///           col IS NULL, col IS NOT NULL, col LIKE val, col IN (a, b, c)
fn parse_postgrest_filter(cond: &str) -> Option<String> {
    let cond = cond.trim();
    let upper = cond.to_uppercase();

    // IS NOT NULL
    if upper.ends_with("IS NOT NULL") {
        let col = cond[..cond.len() - 11]
            .trim()
            .trim_matches(|c: char| c == '"' || c == '`');
        return Some(format!("{col}=not.is.null"));
    }
    // IS NULL
    if upper.ends_with("IS NULL") {
        let col = cond[..cond.len() - 7]
            .trim()
            .trim_matches(|c: char| c == '"' || c == '`');
        return Some(format!("{col}=is.null"));
    }

    // Operator-based: >=, <=, !=, <>, =, >, <, LIKE, ILIKE
    let operators = [
        (">=", "gte"),
        ("<=", "lte"),
        ("!=", "neq"),
        ("<>", "neq"),
        ("=", "eq"),
        (">", "gt"),
        ("<", "lt"),
    ];

    for (op, pg_op) in &operators {
        if let Some(pos) = cond.find(op) {
            let col = cond[..pos]
                .trim()
                .trim_matches(|c: char| c == '"' || c == '`');
            let val = cond[pos + op.len()..]
                .trim()
                .trim_matches(|c: char| c == '\'' || c == '"');
            return Some(format!("{}={}.{}", col, pg_op, urlencoding::encode(val)));
        }
    }

    // LIKE / ILIKE
    if let Some(pos) = upper.find(" LIKE ") {
        let col = cond[..pos]
            .trim()
            .trim_matches(|c: char| c == '"' || c == '`');
        let val = cond[pos + 6..]
            .trim()
            .trim_matches(|c: char| c == '\'' || c == '"')
            .replace('%', "*");
        return Some(format!("{}=like.{}", col, urlencoding::encode(&val)));
    }
    if let Some(pos) = upper.find(" ILIKE ") {
        let col = cond[..pos]
            .trim()
            .trim_matches(|c: char| c == '"' || c == '`');
        let val = cond[pos + 7..]
            .trim()
            .trim_matches(|c: char| c == '\'' || c == '"')
            .replace('%', "*");
        return Some(format!("{}=ilike.{}", col, urlencoding::encode(&val)));
    }

    None
}

// ============================================================================
// Neon -- Serverless SQL-over-HTTP
// ============================================================================

pub(crate) async fn execute_neon(
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

    let sql_url = format!("https://{host}/sql");

    let client = http_client();
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

/// Execute a parameterized query against Neon (used for introspection to prevent SQL injection).
async fn execute_neon_parameterized(
    fields: &HashMap<String, String>,
    query_text: &str,
    params: &[&str],
) -> Result<QueryResult, AppError> {
    let connection_string = fields
        .get("connection_string")
        .or_else(|| fields.get("database_url"))
        .ok_or_else(|| AppError::Validation("Missing connection_string field for Neon".into()))?;

    let host = extract_pg_host(connection_string).ok_or_else(|| {
        AppError::Validation("Cannot extract host from Neon connection string".into())
    })?;

    let sql_url = format!("https://{}/sql", host);

    let client = http_client();
    let resp = client
        .post(&sql_url)
        .header("Neon-Connection-String", connection_string)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": query_text, "params": params }))
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
// Upstash -- Redis REST API
// ============================================================================

pub(crate) async fn execute_upstash(
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

    // Split the query into command parts (e.g., "GET mykey" -> ["GET", "mykey"])
    let parts: Vec<&str> = query_text.split_whitespace().collect();
    if parts.is_empty() {
        return Err(AppError::Validation("Empty Redis command".into()));
    }

    let url = redis_url.trim_end_matches('/').to_string();

    let client = http_client();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
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
// PlanetScale -- Vitess HTTP API
// ============================================================================

pub(crate) async fn execute_planetscale(
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

    let url = format!("https://{host}/psdb.v1alpha1.Database/Execute");

    let client = http_client();
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

/// Execute a parameterized query against PlanetScale (used for introspection to prevent SQL injection).
async fn execute_planetscale_parameterized(
    fields: &HashMap<String, String>,
    query_text: &str,
    params: &[&str],
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

    // PlanetScale Vitess API accepts typed bind variables
    let bind_vars: serde_json::Map<String, Value> = params
        .iter()
        .enumerate()
        .map(|(i, v)| {
            (
                format!("v{}", i + 1),
                serde_json::json!({ "type": "VARCHAR", "value": v }),
            )
        })
        .collect();

    // Replace ? placeholders with :v1, :v2, etc. for Vitess bind variable syntax
    let mut vitess_query = query_text.to_string();
    for i in (0..params.len()).rev() {
        if let Some(pos) = vitess_query.rfind('?') {
            vitess_query.replace_range(pos..pos + 1, &format!(":v{}", i + 1));
        }
    }

    let client = http_client();
    let resp = client
        .post(&url)
        .basic_auth(username, Some(password))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "query": vitess_query,
            "bindings": bind_vars
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
pub(crate) fn parse_postgres_json_response(body: &str) -> Result<QueryResult, AppError> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|e| AppError::Internal(format!("Invalid JSON: {e}")))?;

    // Response may be an array of row objects or wrapped in a result key
    let rows_val = if parsed.is_array() {
        &parsed
    } else if let Some(rows) = parsed.get("rows").or(parsed.get("result")) {
        rows
    } else {
        // Single result -- wrap in array
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
pub(crate) fn parse_neon_response(body: &str) -> Result<QueryResult, AppError> {
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
pub(crate) fn parse_upstash_response(body: &str) -> Result<QueryResult, AppError> {
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
pub(crate) fn parse_planetscale_response(body: &str) -> Result<QueryResult, AppError> {
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
pub(crate) fn extract_pg_host(conn_str: &str) -> Option<String> {
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

// ============================================================================
// Convex -- function execution & schema introspection via HTTP API
// ============================================================================

/// Extract deploy key and deployment URL from credential fields.
fn convex_creds(fields: &HashMap<String, String>) -> Result<(String, String), AppError> {
    let deployment_url = fields
        .get("deployment_url")
        .ok_or_else(|| AppError::Validation("Missing deployment_url field".into()))?
        .trim_end_matches('/')
        .to_string();
    let deploy_key = fields
        .get("deploy_key")
        .ok_or_else(|| AppError::Validation("Missing deploy_key field".into()))?
        .clone();
    Ok((deployment_url, deploy_key))
}

/// Execute a Convex query or mutation via the HTTP API.
///
/// The query text should be a JSON body for the `/api/query` or `/api/mutation`
/// endpoint, e.g.: `{ "path": "messages:list", "args": {} }`
///
/// Alternatively, a shorthand like `tableName` or `tableName:functionName` is
/// accepted and expanded into a list_snapshot request for table browsing.
async fn execute_convex(
    fields: &HashMap<String, String>,
    query_text: &str,
) -> Result<QueryResult, AppError> {
    let (deployment_url, deploy_key) = convex_creds(fields)?;
    let trimmed = query_text.trim();

    // If it looks like JSON, treat as a raw function call
    if trimmed.starts_with('{') {
        let body: Value = serde_json::from_str(trimmed).map_err(|e| {
            AppError::Validation(format!("Invalid JSON body: {e}"))
        })?;

        // Determine endpoint: presence of "mutation" key or path containing "mutation" -> /api/mutation
        let path_str = body.get("path").and_then(|p| p.as_str()).unwrap_or("");
        let endpoint = if path_str.contains("mutation") || body.get("mutation").is_some() {
            "mutation"
        } else if path_str.contains("action") || body.get("action").is_some() {
            "action"
        } else {
            "query"
        };

        let url = format!("{deployment_url}/api/{endpoint}");
        let client = http_client();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Convex {deploy_key}"))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Convex request failed: {e}")))?;

        let status = resp.status();
        let resp_body: Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to parse Convex response: {e}")))?;

        if !status.is_success() || resp_body.get("status").and_then(|s| s.as_str()) == Some("error") {
            let msg = resp_body
                .get("errorMessage")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            return Err(AppError::Internal(format!("Convex {endpoint} failed: {msg}")));
        }

        return convex_value_to_query_result(&resp_body.get("value").cloned().unwrap_or(Value::Null));
    }

    // Shorthand: treat as table name -- list documents via /api/list_snapshot
    let table_name = trimmed
        .trim_matches('"')
        .trim_matches('\'');
    convex_list_snapshot(&deployment_url, &deploy_key, Some(table_name)).await
}

/// List documents from a Convex table via the streaming export snapshot API.
async fn convex_list_snapshot(
    deployment_url: &str,
    deploy_key: &str,
    table_name: Option<&str>,
) -> Result<QueryResult, AppError> {
    let mut url = format!("{deployment_url}/api/list_snapshot?format=json");
    if let Some(tn) = table_name {
        url.push_str(&format!("&tableName={tn}"));
    }

    let client = http_client();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Convex {deploy_key}"))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Convex list_snapshot failed: {e}")))?;

    let status = resp.status();

    // list_snapshot is also part of Streaming Export -- requires Professional plan
    if status == reqwest::StatusCode::FORBIDDEN {
        let tn_hint = table_name.map(|n| format!(" '{n}'")).unwrap_or_default();
        return Err(AppError::Internal(format!(
            "Browsing table{tn_hint} via list_snapshot requires the Convex Professional plan. \
             On the free plan, call your query functions instead:\n\n\
             {{\"path\": \"myModule:listItems\", \"args\": {{}}}}"
        )));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Convex response: {e}")))?;

    if !status.is_success() {
        let msg = body
            .get("errorMessage")
            .or_else(|| body.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(AppError::Internal(format!(
            "Convex list_snapshot failed (HTTP {status}): {msg}"
        )));
    }

    let values = body
        .get("values")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if values.is_empty() {
        return Ok(QueryResult {
            columns: vec!["(no documents)".into()],
            rows: vec![],
            row_count: 0,
            duration_ms: 0,
            truncated: false,
        });
    }

    // Collect all unique keys from documents to build columns (_id first)
    let mut columns = vec!["_id".to_string()];
    for doc in &values {
        if let Some(obj) = doc.as_object() {
            for key in obj.keys() {
                if key != "_id" && !columns.contains(key) {
                    columns.push(key.clone());
                }
            }
        }
    }

    let truncated = values.len() > MAX_ROWS;
    let rows: Vec<Vec<Value>> = values
        .iter()
        .take(MAX_ROWS)
        .map(|doc| {
            columns
                .iter()
                .map(|col| doc.get(col).cloned().unwrap_or(Value::Null))
                .collect()
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

/// Introspect Convex tables via the `/api/json_schemas` streaming export endpoint.
///
/// This endpoint requires the Convex Professional plan. On free plans it returns
/// a 403, in which case we fall back to an empty result with guidance.
async fn introspect_convex_tables(
    fields: &HashMap<String, String>,
) -> Result<QueryResult, AppError> {
    let (deployment_url, deploy_key) = convex_creds(fields)?;
    let url = format!("{deployment_url}/api/json_schemas?format=json");

    let client = http_client();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Convex {deploy_key}"))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Convex json_schemas request failed: {e}")))?;

    let status = resp.status();

    // 403 = Streaming Export requires Professional plan -- return helpful guidance
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::Internal(
            "Schema introspection requires the Convex Professional plan (Streaming Export API). \
             On the free Starter plan, use the Console tab to query tables directly:\n\n\
             * Enter a table name to browse its documents\n\
             * Use JSON to call your functions: {\"path\": \"myModule:myQuery\", \"args\": {}}"
                .into(),
        ));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Convex schema response: {e}")))?;

    if !status.is_success() {
        let msg = body
            .get("errorMessage")
            .or_else(|| body.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(AppError::Internal(format!(
            "Convex json_schemas failed (HTTP {status}): {msg}"
        )));
    }

    // The response is a JSON Schema with table definitions under various paths.
    let tables = extract_convex_table_names(&body);

    let rows: Vec<Vec<Value>> = tables
        .iter()
        .map(|name| {
            vec![
                Value::String(name.clone()),
                Value::String("DOCUMENT".to_string()),
            ]
        })
        .collect();

    let row_count = rows.len();
    Ok(QueryResult {
        columns: vec!["table_name".into(), "table_type".into()],
        rows,
        row_count,
        duration_ms: 0,
        truncated: false,
    })
}

/// Extract table names from Convex JSON Schema response.
///
/// The schema has `$defs` with entries like `"tableName"` or uses `oneOf`
/// with `$ref` paths. We look for object definitions that have `properties`
/// containing `_id` (which indicates a document table).
fn extract_convex_table_names(schema: &Value) -> Vec<String> {
    let mut tables = Vec::new();

    // Method 1: Look in "$defs" for table definitions
    if let Some(defs) = schema.get("$defs").and_then(|d| d.as_object()) {
        for (name, def) in defs {
            // Skip internal/system tables
            if name.starts_with('_') {
                continue;
            }
            // Table definitions typically have "type": "object" with properties
            if def.get("type").and_then(|t| t.as_str()) == Some("object") {
                tables.push(name.clone());
            }
        }
    }

    // Method 2: Look in "anyOf" / "oneOf" for $ref table references
    for key in &["anyOf", "oneOf"] {
        if let Some(variants) = schema.get(key).and_then(|v| v.as_array()) {
            for variant in variants {
                if let Some(ref_path) = variant.get("$ref").and_then(|r| r.as_str()) {
                    // "$ref": "#/$defs/tableName" -> extract tableName
                    if let Some(name) = ref_path.strip_prefix("#/$defs/") {
                        if !name.starts_with('_') && !tables.contains(&name.to_string()) {
                            tables.push(name.to_string());
                        }
                    }
                }
                // Also check if the variant has a $description with table name
                if let Some(desc) = variant.get("$description").and_then(|d| d.as_str()) {
                    if desc.contains("table:") {
                        if let Some(name) = desc.strip_prefix("table:") {
                            let name = name.trim().to_string();
                            if !name.starts_with('_') && !tables.contains(&name) {
                                tables.push(name);
                            }
                        }
                    }
                }
            }
        }
    }

    tables.sort();
    tables
}

/// Introspect columns (document fields) for a Convex table.
///
/// Like table introspection, this requires the Professional plan.
async fn introspect_convex_columns(
    fields: &HashMap<String, String>,
    table_name: &str,
) -> Result<QueryResult, AppError> {
    let (deployment_url, deploy_key) = convex_creds(fields)?;
    let url = format!("{deployment_url}/api/json_schemas?format=json");

    let client = http_client();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Convex {deploy_key}"))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Convex json_schemas request failed: {e}")))?;

    let status = resp.status();

    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::Internal(
            "Column introspection requires the Convex Professional plan (Streaming Export API). \
             Browse documents directly using the Console tab instead."
                .into(),
        ));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Convex schema response: {e}")))?;

    if !status.is_success() {
        let msg = body
            .get("errorMessage")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(AppError::Internal(format!(
            "Convex json_schemas failed (HTTP {status}): {msg}"
        )));
    }

    // Find the table definition in $defs
    let table_def = body
        .get("$defs")
        .and_then(|d| d.get(table_name))
        .ok_or_else(|| {
            AppError::Internal(format!("Table '{table_name}' not found in Convex schema"))
        })?;

    let empty_map = serde_json::Map::new();
    let properties = table_def
        .get("properties")
        .and_then(|p| p.as_object())
        .unwrap_or(&empty_map);

    let required: Vec<String> = table_def
        .get("required")
        .and_then(|r| r.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let rows: Vec<Vec<Value>> = properties
        .iter()
        .map(|(col_name, col_def)| {
            // Convex types: use "type" field or "$description" annotation
            let convex_type = col_def
                .get("$description")
                .and_then(|d| d.as_str())
                .or_else(|| col_def.get("type").and_then(|t| t.as_str()))
                .unwrap_or("unknown");

            let is_nullable = if required.contains(col_name) {
                "NO"
            } else {
                "YES"
            };

            vec![
                Value::String(col_name.clone()),
                Value::String(convex_type.to_string()),
                Value::String(is_nullable.to_string()),
                Value::Null, // no default concept in Convex
            ]
        })
        .collect();

    let row_count = rows.len();
    Ok(QueryResult {
        columns: vec![
            "column_name".into(),
            "data_type".into(),
            "is_nullable".into(),
            "column_default".into(),
        ],
        rows,
        row_count,
        duration_ms: 0,
        truncated: false,
    })
}

/// Convert a Convex function return value into a QueryResult.
fn convex_value_to_query_result(value: &Value) -> Result<QueryResult, AppError> {
    match value {
        Value::Array(arr) => {
            if arr.is_empty() {
                return Ok(QueryResult {
                    columns: vec!["(empty)".into()],
                    rows: vec![],
                    row_count: 0,
                    duration_ms: 0,
                    truncated: false,
                });
            }

            // Collect all unique keys from array items (_id first)
            let mut columns = vec!["_id".to_string()];
            for item in arr {
                if let Some(obj) = item.as_object() {
                    for key in obj.keys() {
                        if key != "_id" && !columns.contains(key) {
                            columns.push(key.clone());
                        }
                    }
                }
            }

            let truncated = arr.len() > MAX_ROWS;
            let rows: Vec<Vec<Value>> = arr
                .iter()
                .take(MAX_ROWS)
                .map(|item| {
                    columns
                        .iter()
                        .map(|col| item.get(col).cloned().unwrap_or(Value::Null))
                        .collect()
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
        Value::Object(_) => {
            // Single document result -- present as single-row table
            let columns: Vec<String> = value
                .as_object()
                .map(|o| o.keys().cloned().collect())
                .unwrap_or_default();
            let row: Vec<Value> = columns
                .iter()
                .map(|col| value.get(col).cloned().unwrap_or(Value::Null))
                .collect();
            Ok(QueryResult {
                columns,
                rows: vec![row],
                row_count: 1,
                duration_ms: 0,
                truncated: false,
            })
        }
        _ => {
            // Scalar result
            Ok(QueryResult {
                columns: vec!["result".into()],
                rows: vec![vec![value.clone()]],
                row_count: 1,
                duration_ms: 0,
                truncated: false,
            })
        }
    }
}

// ============================================================================
// Local SQLite (Built-in Database)
// ============================================================================

/// Execute a SQL query against the local user-facing SQLite database.
/// This is completely isolated from the internal app database.
pub fn execute_local_sqlite(
    user_db: &UserDbPool,
    query_text: &str,
) -> Result<QueryResult, AppError> {
    let conn = user_db.get().map_err(|e| {
        AppError::Internal(format!("Failed to connect to user database: {e}"))
    })?;

    let trimmed = query_text.trim();

    // Detect if this is a SELECT/PRAGMA/EXPLAIN (returns rows) or a write statement
    let upper = trimmed.to_uppercase();
    let is_read = upper.starts_with("SELECT")
        || upper.starts_with("PRAGMA")
        || upper.starts_with("EXPLAIN")
        || upper.starts_with("WITH");

    if is_read {
        let mut stmt = conn.prepare(trimmed).map_err(|e| {
            AppError::Internal(format!("SQL prepare error: {e}"))
        })?;

        let col_count = stmt.column_count();
        let columns: Vec<String> = (0..col_count)
            .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
            .collect();

        let mut rows_out: Vec<Vec<Value>> = Vec::new();
        let mut rows_iter = stmt.query([]).map_err(|e| {
            AppError::Internal(format!("SQL query error: {e}"))
        })?;

        while let Some(row) = rows_iter.next().map_err(|e| {
            AppError::Internal(format!("Row fetch error: {e}"))
        })? {
            if rows_out.len() >= MAX_ROWS {
                break;
            }
            let mut row_vals: Vec<Value> = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let val: Value = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Null) => Value::Null,
                    Ok(rusqlite::types::ValueRef::Integer(n)) => Value::Number(n.into()),
                    Ok(rusqlite::types::ValueRef::Real(f)) => {
                        serde_json::Number::from_f64(f)
                            .map(Value::Number)
                            .unwrap_or(Value::Null)
                    }
                    Ok(rusqlite::types::ValueRef::Text(t)) => {
                        Value::String(String::from_utf8_lossy(t).to_string())
                    }
                    Ok(rusqlite::types::ValueRef::Blob(b)) => {
                        Value::String(format!("<blob {} bytes>", b.len()))
                    }
                    Err(_) => Value::Null,
                };
                row_vals.push(val);
            }
            rows_out.push(row_vals);
        }

        Ok(QueryResult {
            columns,
            rows: rows_out,
            row_count: 0, // set by caller
            duration_ms: 0,
            truncated: false,
        })
    } else {
        // Deny-list: block statements that could escape the database sandbox
        let upper = trimmed.to_uppercase();
        let forbidden = ["ATTACH ", "DETACH ", "VACUUM INTO"];
        for kw in &forbidden {
            if upper.starts_with(kw) {
                return Err(AppError::Validation(format!("Statement type '{}' is not allowed", kw.trim())));
            }
        }

        // Write statement (CREATE TABLE, INSERT, UPDATE, DELETE, etc.)
        let affected = conn.execute(trimmed, []).map_err(|e| {
            AppError::Internal(format!("SQL execute error: {e}"))
        })?;

        Ok(QueryResult {
            columns: vec!["affected_rows".to_string()],
            rows: vec![vec![Value::Number(affected.into())]],
            row_count: affected,
            duration_ms: 0,
            truncated: false,
        })
    }
}

/// Introspect tables in the local user database.
pub fn introspect_local_sqlite_tables(
    user_db: &UserDbPool,
) -> Result<QueryResult, AppError> {
    execute_local_sqlite(
        user_db,
        "SELECT name AS table_name, type AS table_type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
}

/// Introspect columns of a specific table in the local user database.
pub fn introspect_local_sqlite_columns(
    user_db: &UserDbPool,
    table_name: &str,
) -> Result<QueryResult, AppError> {
    let safe_name = table_name.replace(|c: char| !c.is_alphanumeric() && c != '_', "");
    execute_local_sqlite(
        user_db,
        &format!("PRAGMA table_info('{}')", safe_name),
    )
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // -- extract_pg_host ---------------------------------------------

    #[test]
    fn test_extract_host_standard() {
        let result =
            extract_pg_host("postgresql://user:pass@ep-cool-cloud-123.us-east-2.neon.tech/mydb");
        assert_eq!(
            result,
            Some("ep-cool-cloud-123.us-east-2.neon.tech".to_string())
        );
    }

    #[test]
    fn test_extract_host_with_port() {
        let result = extract_pg_host("postgresql://user:pass@myhost:5432/db");
        assert_eq!(result, Some("myhost".to_string()));
    }

    #[test]
    fn test_extract_host_with_params() {
        let result = extract_pg_host("postgresql://user:pass@myhost/db?sslmode=require");
        assert_eq!(result, Some("myhost".to_string()));
    }

    #[test]
    fn test_extract_host_no_at_symbol() {
        let result = extract_pg_host("invalid-connection-string");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_host_minimal() {
        let result = extract_pg_host("postgresql://u:p@h/d");
        assert_eq!(result, Some("h".to_string()));
    }

    #[test]
    fn test_extract_host_port_and_params() {
        let result =
            extract_pg_host("postgresql://user:pass@host:5432/db?sslmode=require&timeout=10");
        assert_eq!(result, Some("host".to_string()));
    }

    // -- parse_postgres_json_response --------------------------------

    #[test]
    fn test_parse_pg_array_of_objects() {
        let body = r#"[{"id":1,"name":"alice"},{"id":2,"name":"bob"}]"#;
        let result = parse_postgres_json_response(body).unwrap();
        assert_eq!(result.row_count, 2);
        assert!(!result.truncated);
        assert!(result.columns.contains(&"id".to_string()));
        assert!(result.columns.contains(&"name".to_string()));
        assert_eq!(result.rows.len(), 2);
    }

    #[test]
    fn test_parse_pg_wrapped_in_rows_key() {
        let body = r#"{"rows":[{"id":1},{"id":2}]}"#;
        let result = parse_postgres_json_response(body).unwrap();
        assert_eq!(result.row_count, 2);
        assert_eq!(result.columns, vec!["id"]);
    }

    #[test]
    fn test_parse_pg_wrapped_in_result_key() {
        let body = r#"{"result":[{"val":"hello"}]}"#;
        let result = parse_postgres_json_response(body).unwrap();
        assert_eq!(result.row_count, 1);
        assert_eq!(result.columns, vec!["val"]);
    }

    #[test]
    fn test_parse_pg_empty_array() {
        let body = "[]";
        let result = parse_postgres_json_response(body).unwrap();
        assert_eq!(result.row_count, 0);
        assert!(result.columns.is_empty());
        assert!(result.rows.is_empty());
        assert!(!result.truncated);
    }

    #[test]
    fn test_parse_pg_single_value() {
        let body = r#"{"count":42}"#;
        let result = parse_postgres_json_response(body).unwrap();
        assert_eq!(result.row_count, 1);
        assert_eq!(result.columns, vec!["result"]);
        // The entire JSON object is stored as the single cell
        assert_eq!(result.rows[0][0], json!({"count": 42}));
    }

    #[test]
    fn test_parse_pg_large_set_truncation() {
        // Build a JSON array with 600 rows
        let rows: Vec<serde_json::Value> = (0..600)
            .map(|i| json!({"id": i, "val": format!("row_{}", i)}))
            .collect();
        let body = serde_json::to_string(&rows).unwrap();

        let result = parse_postgres_json_response(&body).unwrap();
        assert!(result.truncated);
        assert_eq!(result.row_count, 500); // MAX_ROWS
        assert_eq!(result.rows.len(), 500);
    }

    #[test]
    fn test_parse_pg_invalid_json() {
        let body = "not json at all";
        let result = parse_postgres_json_response(body);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_pg_null_values() {
        let body = r#"[{"name":null,"age":25}]"#;
        let result = parse_postgres_json_response(body).unwrap();
        assert_eq!(result.row_count, 1);
        // Find the null value in the row
        let name_idx = result.columns.iter().position(|c| c == "name").unwrap();
        assert_eq!(result.rows[0][name_idx], serde_json::Value::Null);
    }

    #[test]
    fn test_parse_pg_exactly_max_rows() {
        let rows: Vec<serde_json::Value> = (0..500)
            .map(|i| json!({"id": i}))
            .collect();
        let body = serde_json::to_string(&rows).unwrap();

        let result = parse_postgres_json_response(&body).unwrap();
        assert!(!result.truncated); // Exactly 500 -- not truncated
        assert_eq!(result.row_count, 500);
    }

    // -- parse_neon_response -----------------------------------------

    #[test]
    fn test_parse_neon_standard() {
        let body = r#"{"fields":[{"name":"id","dataTypeID":23},{"name":"name","dataTypeID":25}],"rows":[[1,"alice"],[2,"bob"]]}"#;
        let result = parse_neon_response(body).unwrap();
        assert_eq!(result.columns, vec!["id", "name"]);
        assert_eq!(result.row_count, 2);
        assert_eq!(result.rows[0], vec![json!(1), json!("alice")]);
        assert_eq!(result.rows[1], vec![json!(2), json!("bob")]);
    }

    #[test]
    fn test_parse_neon_empty() {
        let body = r#"{"fields":[],"rows":[]}"#;
        let result = parse_neon_response(body).unwrap();
        assert!(result.columns.is_empty());
        assert_eq!(result.row_count, 0);
        assert!(!result.truncated);
    }

    #[test]
    fn test_parse_neon_missing_fields() {
        let body = r#"{"rows":[[1],[2]]}"#;
        let result = parse_neon_response(body).unwrap();
        assert!(result.columns.is_empty());
        assert_eq!(result.row_count, 2);
    }

    #[test]
    fn test_parse_neon_truncation() {
        let rows: Vec<serde_json::Value> = (0..600).map(|i| json!([i])).collect();
        let body = json!({"fields": [{"name": "id"}], "rows": rows}).to_string();

        let result = parse_neon_response(&body).unwrap();
        assert!(result.truncated);
        assert_eq!(result.row_count, 500);
    }

    #[test]
    fn test_parse_neon_mixed_types() {
        let body = r#"{"fields":[{"name":"a"},{"name":"b"},{"name":"c"}],"rows":[["hello",42,true],[null,0,false]]}"#;
        let result = parse_neon_response(body).unwrap();
        assert_eq!(result.row_count, 2);
        assert_eq!(result.rows[0], vec![json!("hello"), json!(42), json!(true)]);
        assert_eq!(result.rows[1], vec![json!(null), json!(0), json!(false)]);
    }

    // -- parse_upstash_response --------------------------------------

    #[test]
    fn test_parse_upstash_string_result() {
        let body = r#"{"result":"OK"}"#;
        let result = parse_upstash_response(body).unwrap();
        assert_eq!(result.columns, vec!["result"]);
        assert_eq!(result.row_count, 1);
        assert_eq!(result.rows[0][0], json!("OK"));
    }

    #[test]
    fn test_parse_upstash_array_result() {
        let body = r#"{"result":["val1","val2","val3"]}"#;
        let result = parse_upstash_response(body).unwrap();
        assert_eq!(result.columns, vec!["value"]);
        assert_eq!(result.row_count, 3);
        assert_eq!(result.rows[0][0], json!("val1"));
        assert_eq!(result.rows[2][0], json!("val3"));
    }

    #[test]
    fn test_parse_upstash_null_result() {
        let body = r#"{"result":null}"#;
        let result = parse_upstash_response(body).unwrap();
        assert_eq!(result.columns, vec!["result"]);
        assert_eq!(result.row_count, 1);
        assert_eq!(result.rows[0][0], serde_json::Value::Null);
    }

    #[test]
    fn test_parse_upstash_integer_result() {
        let body = r#"{"result":42}"#;
        let result = parse_upstash_response(body).unwrap();
        assert_eq!(result.columns, vec!["result"]);
        assert_eq!(result.row_count, 1);
        assert_eq!(result.rows[0][0], json!(42));
    }

    #[test]
    fn test_parse_upstash_hash_result() {
        // HGETALL returns flat key-value pairs as array
        let body = r#"{"result":["field1","value1","field2","value2"]}"#;
        let result = parse_upstash_response(body).unwrap();
        assert_eq!(result.columns, vec!["value"]);
        assert_eq!(result.row_count, 4);
    }

    #[test]
    fn test_parse_upstash_truncation() {
        let arr: Vec<serde_json::Value> = (0..600).map(|i| json!(i)).collect();
        let body = json!({"result": arr}).to_string();

        let result = parse_upstash_response(&body).unwrap();
        assert!(result.truncated);
        assert_eq!(result.row_count, 500);
    }

    #[test]
    fn test_parse_upstash_empty_array() {
        let body = r#"{"result":[]}"#;
        let result = parse_upstash_response(body).unwrap();
        assert_eq!(result.columns, vec!["value"]);
        assert_eq!(result.row_count, 0);
        assert!(!result.truncated);
    }

    // -- parse_planetscale_response ----------------------------------

    #[test]
    fn test_parse_ps_standard_object_rows() {
        let body = r#"{"result":{"fields":[{"name":"id"},{"name":"email"}],"rows":[{"id":1,"email":"a@b.com"}]}}"#;
        let result = parse_planetscale_response(body).unwrap();
        assert_eq!(result.columns, vec!["id", "email"]);
        assert_eq!(result.row_count, 1);
    }

    #[test]
    fn test_parse_ps_array_rows() {
        let body = r#"{"result":{"fields":[{"name":"id"},{"name":"name"}],"rows":[[1,"alice"],[2,"bob"]]}}"#;
        let result = parse_planetscale_response(body).unwrap();
        assert_eq!(result.columns, vec!["id", "name"]);
        assert_eq!(result.row_count, 2);
        assert_eq!(result.rows[0], vec![json!(1), json!("alice")]);
    }

    #[test]
    fn test_parse_ps_empty() {
        let body = r#"{"result":{"fields":[],"rows":[]}}"#;
        let result = parse_planetscale_response(body).unwrap();
        assert!(result.columns.is_empty());
        assert_eq!(result.row_count, 0);
    }

    #[test]
    fn test_parse_ps_truncation() {
        let rows: Vec<serde_json::Value> = (0..600).map(|i| json!([i])).collect();
        let body = json!({"result": {"fields": [{"name": "id"}], "rows": rows}}).to_string();

        let result = parse_planetscale_response(&body).unwrap();
        assert!(result.truncated);
        assert_eq!(result.row_count, 500);
    }

    #[test]
    fn test_parse_ps_no_result_wrapper() {
        // Some responses might not have the "result" wrapper
        let body = r#"{"fields":[{"name":"x"}],"rows":[[99]]}"#;
        let result = parse_planetscale_response(body).unwrap();
        assert_eq!(result.columns, vec!["x"]);
        assert_eq!(result.rows[0], vec![json!(99)]);
    }

    // -- Integration tests (env-gated) -------------------------------

    /// Helper to check if Upstash SRH Docker emulator is available.
    fn upstash_test_fields() -> Option<HashMap<String, String>> {
        let url = std::env::var("UPSTASH_TEST_URL").ok()?;
        let token = std::env::var("UPSTASH_TEST_TOKEN").ok()?;
        let mut fields = HashMap::new();
        fields.insert("redis_rest_url".to_string(), url);
        fields.insert("redis_rest_token".to_string(), token);
        Some(fields)
    }

    #[tokio::test]
    #[ignore] // Run with: cargo test -- --ignored (requires Docker SRH)
    async fn test_upstash_live_set_get() {
        let fields = upstash_test_fields().expect("UPSTASH_TEST_URL and UPSTASH_TEST_TOKEN required");

        // SET
        let set_result = execute_upstash(&fields, "SET test_key hello_world").await.unwrap();
        assert_eq!(set_result.rows[0][0], json!("OK"));

        // GET
        let get_result = execute_upstash(&fields, "GET test_key").await.unwrap();
        assert_eq!(get_result.rows[0][0], json!("hello_world"));

        // Cleanup
        let _ = execute_upstash(&fields, "DEL test_key").await;
    }

    #[tokio::test]
    #[ignore]
    async fn test_upstash_live_hset_hgetall() {
        let fields = upstash_test_fields().expect("UPSTASH_TEST_URL and UPSTASH_TEST_TOKEN required");

        let _ = execute_upstash(&fields, "DEL test_hash").await;
        let _ = execute_upstash(&fields, "HSET test_hash name alice age 30").await.unwrap();

        let result = execute_upstash(&fields, "HGETALL test_hash").await.unwrap();
        assert!(result.row_count >= 4); // ["name", "alice", "age", "30"]

        let _ = execute_upstash(&fields, "DEL test_hash").await;
    }

    #[tokio::test]
    #[ignore]
    async fn test_upstash_live_nonexistent_key() {
        let fields = upstash_test_fields().expect("UPSTASH_TEST_URL and UPSTASH_TEST_TOKEN required");

        let result = execute_upstash(&fields, "GET __surely_nonexistent_key__").await.unwrap();
        assert_eq!(result.rows[0][0], serde_json::Value::Null);
    }

    #[tokio::test]
    #[ignore]
    async fn test_upstash_live_del() {
        let fields = upstash_test_fields().expect("UPSTASH_TEST_URL and UPSTASH_TEST_TOKEN required");

        let _ = execute_upstash(&fields, "SET del_test_key value").await;
        let result = execute_upstash(&fields, "DEL del_test_key").await.unwrap();
        // DEL returns integer count of deleted keys
        assert_eq!(result.row_count, 1);
    }

    #[tokio::test]
    async fn test_upstash_empty_command() {
        let mut fields = HashMap::new();
        fields.insert("redis_rest_url".to_string(), "http://localhost:8079".to_string());
        fields.insert("redis_rest_token".to_string(), "token".to_string());

        let result = execute_upstash(&fields, "").await;
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(err_msg.contains("Empty Redis command"));
    }

    // -- PostgREST parser tests --

    #[test]
    fn test_postgrest_simple_select() {
        let result = parse_select_to_postgrest("SELECT * FROM users").unwrap();
        assert_eq!(result.table, "users");
        assert_eq!(result.select, "*");
        assert_eq!(result.limit, Some(500));
    }

    #[test]
    fn test_postgrest_select_with_limit() {
        let result = parse_select_to_postgrest("SELECT * FROM users LIMIT 100").unwrap();
        assert_eq!(result.table, "users");
        assert_eq!(result.limit, Some(100));
    }

    #[test]
    fn test_postgrest_select_columns() {
        let result = parse_select_to_postgrest("SELECT id, name, email FROM users LIMIT 50").unwrap();
        assert_eq!(result.select, "id,name,email");
        assert_eq!(result.limit, Some(50));
    }

    #[test]
    fn test_postgrest_select_with_order() {
        let result = parse_select_to_postgrest("SELECT * FROM messages ORDER BY created_at DESC LIMIT 100").unwrap();
        assert_eq!(result.table, "messages");
        assert_eq!(result.order.as_deref(), Some("created_at.desc"));
        assert_eq!(result.limit, Some(100));
    }

    #[test]
    fn test_postgrest_select_with_where() {
        let result = parse_select_to_postgrest("SELECT * FROM users WHERE active = true LIMIT 100").unwrap();
        assert_eq!(result.filters.len(), 1);
        assert_eq!(result.filters[0], "active=eq.true");
    }

    #[test]
    fn test_postgrest_strip_schema_prefix() {
        let result = parse_select_to_postgrest("SELECT * FROM public.users LIMIT 100").unwrap();
        assert_eq!(result.table, "users");
    }

    #[test]
    fn test_postgrest_strip_quotes() {
        let result = parse_select_to_postgrest("SELECT * FROM \"agent_messages\" LIMIT 100").unwrap();
        assert_eq!(result.table, "agent_messages");
    }

    #[test]
    fn test_postgrest_rejects_join() {
        let result = parse_select_to_postgrest("SELECT * FROM users JOIN orders ON users.id = orders.user_id");
        assert!(result.is_none());
    }

    #[test]
    fn test_postgrest_rejects_insert() {
        let result = parse_select_to_postgrest("INSERT INTO users (name) VALUES ('test')");
        assert!(result.is_none());
    }

    #[test]
    fn test_postgrest_rejects_group_by() {
        let result = parse_select_to_postgrest("SELECT role, COUNT(*) FROM users GROUP BY role");
        assert!(result.is_none());
    }

    // -- sanitize_error tests ------------------------------------------

    #[test]
    fn test_sanitize_strips_connection_string() {
        let fields = HashMap::new();
        let msg = "Error: postgresql://admin:s3cret@db.example.com:5432/mydb connection refused";
        let result = sanitize_error(msg, &fields);
        assert!(!result.contains("admin"));
        assert!(!result.contains("s3cret"));
        assert!(result.contains("[REDACTED:connection_string]"));
    }

    #[test]
    fn test_sanitize_strips_bearer_token() {
        let fields = HashMap::new();
        let msg = "Request failed with header Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig";
        let result = sanitize_error(msg, &fields);
        assert!(!result.contains("eyJhbGciOiJIUzI1NiJ9"));
        assert!(result.contains("Bearer [REDACTED]"));
    }

    #[test]
    fn test_sanitize_strips_basic_auth() {
        let fields = HashMap::new();
        let msg = "Auth header was Basic dXNlcjpwYXNz and it failed";
        let result = sanitize_error(msg, &fields);
        assert!(!result.contains("dXNlcjpwYXNz"));
        assert!(result.contains("Basic [REDACTED]"));
    }

    #[test]
    fn test_sanitize_strips_field_values() {
        let mut fields = HashMap::new();
        fields.insert("api_key".to_string(), "sk-super-secret-key-12345".to_string());
        fields.insert("port".to_string(), "5432".to_string()); // short -- should NOT be redacted
        let msg = "Failed with key sk-super-secret-key-12345 on port 5432";
        let result = sanitize_error(msg, &fields);
        assert!(!result.contains("sk-super-secret-key-12345"));
        assert!(result.contains("[REDACTED:api_key]"));
        assert!(result.contains("5432")); // short value not redacted
    }

    #[test]
    fn test_sanitize_no_secrets_unchanged() {
        let fields = HashMap::new();
        let msg = "Connection timed out after 30s";
        let result = sanitize_error(msg, &fields);
        assert_eq!(result, msg);
    }
}
