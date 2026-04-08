//! MCP (Model Context Protocol) tool discovery and execution engine.
//!
//! Connects to MCP servers via stdio or SSE transport to:
//! - Discover available tools (`tools/list`)
//! - Execute tools (`tools/call`)
//!
//! Stdio transport uses a session pool keyed by credential_id to keep processes
//! warm between calls, eliminating the 200-500ms startup + handshake overhead
//! for repeated tool invocations during agent executions.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use ts_rs::TS;

use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::repos::resources::tool_audit_log;
use crate::db::DbPool;
use crate::engine::rate_limiter::{RateLimiter, TOOL_EXECUTION_MAX_PER_MINUTE, TOOL_EXECUTION_WINDOW};
use crate::error::AppError;

/// Maximum allowed MCP JSON-RPC response payload (10 MB).
const MAX_MCP_PAYLOAD_BYTES: usize = 10 * 1024 * 1024;

/// Maximum nesting depth for MCP tool arguments.
const MAX_ARGUMENT_DEPTH: usize = 20;

/// Maximum serialized size for MCP tool arguments (1 MB).
const MAX_ARGUMENT_BYTES: usize = 1024 * 1024;

/// Overall timeout for a complete MCP stdio session (connect + handshake + call).
const MCP_SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// TTL for cached `tools/list` responses (60 seconds).
const TOOLS_LIST_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(60);

/// Timeout for MCP stdin write + flush operations (prevents hung process accumulation).
const MCP_WRITE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Idle timeout for pooled MCP stdio sessions before they are reaped.
const STDIO_POOL_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

/// Maximum number of concurrent sessions in the pool.
const STDIO_POOL_MAX_SESSIONS: usize = 32;

/// Pool utilization threshold (75%) above which saturation warnings are logged.
const POOL_SATURATION_WARN_THRESHOLD: f64 = 0.75;

// ============================================================================
// Stdio session pool metrics
// ============================================================================

/// Lightweight atomic counters for MCP stdio session pool observability.
pub struct PoolMetrics {
    /// Sessions successfully retrieved from the pool (warm reuse).
    pub pool_hits: AtomicU64,
    /// Pool lookups that found no usable session (cold spawn required).
    pub pool_misses: AtomicU64,
    /// Sessions evicted because they exceeded the idle timeout.
    pub pool_evictions: AtomicU64,
    /// Sessions silently dropped because the pool was at capacity.
    pub pool_full_drops: AtomicU64,
    /// Cumulative spawn latency in microseconds (divide by pool_misses for avg).
    pub total_spawn_us: AtomicU64,
}

/// Snapshot of pool metrics exposed to the frontend.
#[derive(Debug, Clone, serde::Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StdioPoolMetrics {
    pub pool_hits: u64,
    pub pool_misses: u64,
    pub pool_evictions: u64,
    pub pool_full_drops: u64,
    pub active_sessions: u64,
    pub max_sessions: u64,
    pub utilization_pct: f64,
    pub avg_spawn_latency_ms: f64,
}

fn pool_metrics() -> &'static PoolMetrics {
    static METRICS: PoolMetrics = PoolMetrics {
        pool_hits: AtomicU64::new(0),
        pool_misses: AtomicU64::new(0),
        pool_evictions: AtomicU64::new(0),
        pool_full_drops: AtomicU64::new(0),
        total_spawn_us: AtomicU64::new(0),
    };
    &METRICS
}

/// Build a snapshot of the current pool metrics (called from the Tauri command).
pub async fn snapshot_pool_metrics() -> StdioPoolMetrics {
    let m = pool_metrics();
    let active = {
        let pool = stdio_session_pool().lock().await;
        pool.len() as u64
    };
    let hits = m.pool_hits.load(Ordering::Relaxed);
    let misses = m.pool_misses.load(Ordering::Relaxed);
    let evictions = m.pool_evictions.load(Ordering::Relaxed);
    let full_drops = m.pool_full_drops.load(Ordering::Relaxed);
    let total_spawn = m.total_spawn_us.load(Ordering::Relaxed);
    let utilization = (active as f64 / STDIO_POOL_MAX_SESSIONS as f64) * 100.0;
    let avg_spawn_ms = if misses > 0 {
        (total_spawn as f64 / misses as f64) / 1000.0
    } else {
        0.0
    };

    StdioPoolMetrics {
        pool_hits: hits,
        pool_misses: misses,
        pool_evictions: evictions,
        pool_full_drops: full_drops,
        active_sessions: active,
        max_sessions: STDIO_POOL_MAX_SESSIONS as u64,
        utilization_pct: utilization,
        avg_spawn_latency_ms: avg_spawn_ms,
    }
}

// ============================================================================
// tools/list response cache
// ============================================================================

/// Cached `tools/list` response with timestamp.
struct CachedToolsList {
    tools: Vec<McpTool>,
    fetched_at: Instant,
}

/// Global in-memory cache for `tools/list` responses, keyed by credential_id.
/// Eliminates redundant `tools/list` round-trips before every `tools/call`.
fn tools_list_cache() -> &'static Mutex<HashMap<String, CachedToolsList>> {
    static CACHE: std::sync::OnceLock<Mutex<HashMap<String, CachedToolsList>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Look up a cached `tools/list` response. Returns `None` if missing or expired.
fn get_cached_tools(credential_id: &str) -> Option<Vec<McpTool>> {
    let cache = tools_list_cache().lock().ok()?;
    let entry = cache.get(credential_id)?;
    if entry.fetched_at.elapsed() < TOOLS_LIST_CACHE_TTL {
        Some(entry.tools.clone())
    } else {
        None
    }
}

/// Store a `tools/list` response in the cache.
fn set_cached_tools(credential_id: &str, tools: Vec<McpTool>) {
    if let Ok(mut cache) = tools_list_cache().lock() {
        // Evict expired entries opportunistically (keep cache bounded)
        cache.retain(|_, v| v.fetched_at.elapsed() < TOOLS_LIST_CACHE_TTL);
        cache.insert(
            credential_id.to_string(),
            CachedToolsList {
                tools,
                fetched_at: Instant::now(),
            },
        );
    }
}

/// Invalidate the cache entry for a credential (e.g. after server reconnect).
#[allow(dead_code)]
pub fn invalidate_tools_cache(credential_id: &str) {
    if let Ok(mut cache) = tools_list_cache().lock() {
        cache.remove(credential_id);
    }
}

// ============================================================================
// Stdio session pool — keeps MCP processes alive between calls
// ============================================================================

/// A live MCP stdio session that has completed the initialization handshake.
/// The child process is kept alive so subsequent tool calls skip the spawn +
/// handshake overhead (~200-500ms per call).
struct PooledStdioSession {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    reader: tokio::io::BufReader<tokio::process::ChildStdout>,
    last_used: Instant,
    /// Monotonically increasing JSON-RPC request ID for this session.
    next_id: u64,
}

/// Global pool of warm MCP stdio sessions, keyed by credential_id.
fn stdio_session_pool() -> &'static tokio::sync::Mutex<HashMap<String, PooledStdioSession>> {
    static POOL: std::sync::OnceLock<tokio::sync::Mutex<HashMap<String, PooledStdioSession>>> =
        std::sync::OnceLock::new();
    POOL.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}

/// Take a live session from the pool if one exists and is still alive.
async fn take_pooled_session(credential_id: &str) -> Option<PooledStdioSession> {
    let m = pool_metrics();
    let mut pool = stdio_session_pool().lock().await;
    // Evict expired sessions opportunistically and count evictions
    let before = pool.len();
    pool.retain(|_, s| s.last_used.elapsed() < STDIO_POOL_IDLE_TIMEOUT);
    let evicted = before - pool.len();
    if evicted > 0 {
        m.pool_evictions.fetch_add(evicted as u64, Ordering::Relaxed);
    }
    let mut session = pool.remove(credential_id)?;
    // Verify the process hasn't exited while idle
    match session.child.try_wait() {
        Ok(None) => {
            m.pool_hits.fetch_add(1, Ordering::Relaxed);
            Some(session) // still running
        }
        _ => {
            let _ = session.child.start_kill();
            m.pool_misses.fetch_add(1, Ordering::Relaxed);
            None
        }
    }
}

/// Return a session to the pool for future reuse.
async fn return_pooled_session(credential_id: &str, mut session: PooledStdioSession) {
    let m = pool_metrics();
    session.last_used = Instant::now();
    let mut pool = stdio_session_pool().lock().await;
    let before = pool.len();
    pool.retain(|_, s| s.last_used.elapsed() < STDIO_POOL_IDLE_TIMEOUT);
    let evicted = before - pool.len();
    if evicted > 0 {
        m.pool_evictions.fetch_add(evicted as u64, Ordering::Relaxed);
    }
    if pool.len() >= STDIO_POOL_MAX_SESSIONS {
        m.pool_full_drops.fetch_add(1, Ordering::Relaxed);
        tracing::warn!(
            pool_size = pool.len(),
            max = STDIO_POOL_MAX_SESSIONS,
            credential_id = %credential_id,
            "MCP stdio pool full — session dropped"
        );
        return;
    }
    // Log saturation warning when utilization exceeds threshold
    let util = pool.len() as f64 / STDIO_POOL_MAX_SESSIONS as f64;
    if util >= POOL_SATURATION_WARN_THRESHOLD {
        tracing::warn!(
            pool_size = pool.len(),
            max = STDIO_POOL_MAX_SESSIONS,
            utilization_pct = format!("{:.0}", util * 100.0),
            "MCP stdio pool utilization above 75%"
        );
    }
    // If a session already exists for this credential (race), the old one is
    // dropped and killed via kill_on_drop.
    pool.insert(credential_id.to_string(), session);
}

/// Spawn a new MCP stdio process and perform the initialization handshake.
async fn spawn_stdio_session(
    fields: &HashMap<String, String>,
) -> Result<PooledStdioSession, AppError> {
    let spawn_start = Instant::now();
    let command = fields
        .get("command")
        .ok_or_else(|| AppError::Validation("MCP server has no 'command' field".into()))?;
    let env_vars = parse_env_vars(fields);

    let mut child = spawn_mcp_process(command, fields.get("working_directory"), &env_vars)?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Internal("MCP process stdin not available".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("MCP process stdout not available".into()))?;
    let reader = tokio::io::BufReader::new(stdout);

    let mut session = PooledStdioSession {
        child,
        stdin,
        reader,
        last_used: Instant::now(),
        next_id: 1,
    };

    // MCP initialize handshake
    let init_req = jsonrpc_request(session.next_id, "initialize", serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "personas-playground", "version": "1.0.0" }
    }));
    session.next_id += 1;

    write_session_jsonrpc(&mut session.stdin, &init_req).await?;
    let _init_resp = read_session_jsonrpc(&mut session.reader).await?;

    // notifications/initialized
    let initialized = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    write_session_jsonrpc(&mut session.stdin, &initialized).await?;

    // Record spawn latency
    let m = pool_metrics();
    let spawn_us = spawn_start.elapsed().as_micros() as u64;
    m.total_spawn_us.fetch_add(spawn_us, Ordering::Relaxed);

    Ok(session)
}

/// Invalidate (kill) any pooled session for a credential.
#[allow(dead_code)]
pub async fn invalidate_pooled_session(credential_id: &str) {
    let mut pool = stdio_session_pool().lock().await;
    if let Some(mut session) = pool.remove(credential_id) {
        let _ = session.child.start_kill();
    }
}

/// Kill all pooled sessions (e.g. on app shutdown).
#[allow(dead_code)]
pub async fn shutdown_stdio_pool() {
    let mut pool = stdio_session_pool().lock().await;
    for (_, mut session) in pool.drain() {
        let _ = session.child.start_kill();
    }
}

// ============================================================================
// Public types
// ============================================================================

/// An MCP tool definition as returned by `tools/list`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, TS)]
#[ts(export)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
}

/// A content block returned by tool execution.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, TS)]
#[ts(export)]
pub struct McpToolContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: Option<String>,
}

/// Result of executing an MCP tool.
#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct McpToolResult {
    pub content: Vec<McpToolContent>,
    pub is_error: bool,
    pub duration_ms: u64,
}

/// Result of an MCP server ping / connection test.
#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct PingResult {
    pub success: bool,
    pub message: String,
}

// ============================================================================
// Public API
// ============================================================================

/// Ping an MCP server using raw field values (no stored credential required).
///
/// Performs the full MCP handshake (`initialize` -> `notifications/initialized`
/// -> `tools/list`) and returns a healthcheck-style result.
pub async fn ping(fields: &HashMap<String, String>) -> Result<PingResult, AppError> {
    let connection_type = fields
        .get("connection_type")
        .map(|s| s.as_str())
        .unwrap_or("stdio");

    let result = match connection_type {
        "stdio" => list_tools_stdio(fields, None).await,
        "sse" => list_tools_sse(fields).await,
        other => Err(AppError::Validation(format!(
            "Unsupported MCP connection type: '{other}'"
        ))),
    };

    match result {
        Ok(tools) => Ok(PingResult {
            success: true,
            message: format!("Connected -- {} tool{} available", tools.len(), if tools.len() == 1 { "" } else { "s" }),
        }),
        Err(e) => Ok(PingResult {
            success: false,
            message: format!("{e}"),
        }),
    }
}

/// Sentinel connector name for MCP gateway credentials (bundles multiple MCP
/// servers under one attachment point). Introduced 2026-04-08 with the
/// gateway pattern from the LangSmith/Arcade /research run.
const MCP_GATEWAY_CONNECTOR: &str = "mcp_gateway";

/// JSON-RPC error code used by Arcade (and similar gateways) to signal that
/// a tool call requires fresh OAuth consent from the user. When we see this
/// code in a failed tool result we convert it into a typed
/// `AppError::AuthorizationRequired` so the frontend can surface the URL via
/// `PendingAuthModal` instead of treating it as a generic error.
const JSONRPC_AUTHORIZATION_REQUIRED_CODE: i64 = -32001;

/// Scan a failed `McpToolResult` for the authorization-required sentinel
/// shape. Returns `Some(authorize_url)` only when ALL of the following match:
///
/// 1. `result.is_error == true`
/// 2. At least one content block's `text` parses as JSON
/// 3. That JSON has EITHER:
///    - a top-level or nested `error.code == -32001`, OR
///    - a top-level `kind == "authorization_required"`
/// 4. AND carries an `authorize_url` (or `error.data.authorize_url`) that
///    starts with `http://` or `https://`
///
/// The layered AND conditions keep this conservative — a regular error that
/// happens to contain a URL field WILL NOT trigger this path. If Arcade's
/// sentinel shape ever changes, update this function and its sibling callers
/// — nothing else needs to move.
///
/// Added 2026-04-08. See `.planning/handoffs/2026-04-08-mcp-gateway-arcade.md`
/// Phase B for the broader JIT-auth rationale.
fn detect_authorization_required(result: &McpToolResult) -> Option<String> {
    if !result.is_error {
        return None;
    }
    for block in &result.content {
        let Some(text) = block.text.as_deref() else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
            continue;
        };

        // Condition 3a: JSON-RPC error with the -32001 code
        let has_auth_code = value
            .get("error")
            .and_then(|e| e.get("code"))
            .and_then(|c| c.as_i64())
            == Some(JSONRPC_AUTHORIZATION_REQUIRED_CODE);

        // Condition 3b: top-level kind sentinel
        let has_auth_kind = value
            .get("kind")
            .and_then(|k| k.as_str())
            == Some("authorization_required");

        if !has_auth_code && !has_auth_kind {
            continue;
        }

        // Condition 4: extract authorize_url from either the top-level field
        // or the JSON-RPC error.data.authorize_url location.
        let url = value
            .get("authorize_url")
            .and_then(|u| u.as_str())
            .or_else(|| {
                value
                    .get("error")
                    .and_then(|e| e.get("data"))
                    .and_then(|d| d.get("authorize_url"))
                    .and_then(|u| u.as_str())
            });

        if let Some(url) = url {
            if url.starts_with("http://") || url.starts_with("https://") {
                return Some(url.to_string());
            }
        }
    }
    None
}

/// Separator used to prefix gateway member tool names. A tool named `search`
/// on a gateway member with display_name `arcade` is exposed to the persona as
/// `arcade::search`. The double-colon is chosen because MCP tool names are
/// typically snake_case and rarely contain `::`, keeping the parse unambiguous.
const GATEWAY_TOOL_SEPARATOR: &str = "::";

/// Split a possibly-prefixed gateway tool name into (member_display_name,
/// real_tool_name). Returns `(None, full_name)` if the name is not prefixed.
fn parse_gateway_tool_name(tool_name: &str) -> (Option<&str>, &str) {
    match tool_name.split_once(GATEWAY_TOOL_SEPARATOR) {
        Some((member, rest)) => (Some(member), rest),
        None => (None, tool_name),
    }
}

/// List available tools from an MCP server.
///
/// Results are cached per credential_id for 60s to avoid redundant round-trips.
///
/// If the credential is an MCP gateway (connector_name == `mcp_gateway`), this
/// fans out to each enabled member's tools/list, prefixes every tool name with
/// `<member_display_name>::`, and merges the results. Members that fail are
/// logged and skipped -- the gateway returns whatever succeeded.
pub async fn list_tools(
    pool: &DbPool,
    credential_id: &str,
) -> Result<Vec<McpTool>, AppError> {
    // Return cached result if fresh (cache is keyed by the incoming credential_id,
    // which is the gateway id for gateway credentials -- so gateway merges are
    // cached as a single entry, invalidated when members change).
    if let Some(cached) = get_cached_tools(credential_id) {
        return Ok(cached);
    }

    let credential = cred_repo::get_by_id(pool, credential_id)?;

    // Gateway path: fan out to members, prefix tool names, merge.
    if credential.service_type == MCP_GATEWAY_CONNECTOR {
        let members = crate::db::repos::resources::mcp_gateways::list_members(
            pool,
            credential_id,
        )?;
        let mut merged: Vec<McpTool> = Vec::new();
        for member in members.into_iter().filter(|m| m.enabled) {
            match Box::pin(list_tools(pool, &member.member_credential_id)).await {
                Ok(tools) => {
                    for mut tool in tools {
                        tool.name = format!(
                            "{prefix}{sep}{name}",
                            prefix = member.display_name,
                            sep = GATEWAY_TOOL_SEPARATOR,
                            name = tool.name
                        );
                        merged.push(tool);
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        gateway_id = %credential_id,
                        member_id = %member.member_credential_id,
                        member_label = %member.member_label,
                        error = %e,
                        "MCP gateway member failed tools/list -- skipping and continuing"
                    );
                }
            }
        }
        set_cached_tools(credential_id, merged.clone());
        return Ok(merged);
    }

    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;
    if let Err(e) = audit_log::log_decrypt(pool, credential_id, &credential.name, "mcp_tools:list_tools", None, None) {
        tracing::warn!(credential_id, error = %e, "Failed to write audit log for credential decrypt");
    }

    let connection_type = fields
        .get("connection_type")
        .map(|s| s.as_str())
        .unwrap_or("stdio");

    let tools = match connection_type {
        "stdio" => list_tools_stdio(&fields, Some(credential_id)).await,
        "sse" => list_tools_sse(&fields).await,
        other => Err(AppError::Validation(format!(
            "Unsupported MCP connection type: '{other}'"
        ))),
    }?;

    set_cached_tools(credential_id, tools.clone());
    Ok(tools)
}

/// Execute a tool on an MCP server.
///
/// Validates arguments against structural limits (depth, size) and the tool's
/// declared `input_schema` before forwarding to the MCP server.
/// Applies per-tool rate limiting and logs execution to the audit trail.
pub async fn execute_tool(
    pool: &DbPool,
    credential_id: &str,
    tool_name: &str,
    arguments: serde_json::Value,
    rate_limiter: Option<&RateLimiter>,
    persona_id: Option<&str>,
    persona_name: Option<&str>,
) -> Result<McpToolResult, AppError> {
    // Per-tool rate limiting
    if let Some(rl) = rate_limiter {
        let rate_key = format!("mcp_tool:{tool_name}");
        if let Err(retry_after) = rl.check(&rate_key, TOOL_EXECUTION_MAX_PER_MINUTE, TOOL_EXECUTION_WINDOW) {
            tracing::warn!(
                tool_name = %tool_name,
                retry_after_secs = retry_after,
                "MCP tool execution rate limited"
            );
            return Err(AppError::RateLimited(format!(
                "Tool '{tool_name}' rate limited. Retry after {retry_after}s."
            )));
        }
    }

    // Structural validation: reject oversized or deeply nested arguments early.
    validate_argument_structure(&arguments)?;

    let credential = cred_repo::get_by_id(pool, credential_id)?;

    // Gateway path: parse the `<member>::<real_tool>` prefix off the tool name,
    // resolve to the underlying member credential, and recurse with the real
    // credential + real tool name. The audit log records the gateway id via
    // the `via_gateway` hint embedded in the tracing span so operators can
    // trace back which bundle a call came through.
    if credential.service_type == MCP_GATEWAY_CONNECTOR {
        let (member_prefix, real_tool) = parse_gateway_tool_name(tool_name);
        let Some(member_prefix) = member_prefix else {
            return Err(AppError::Validation(format!(
                "Gateway credential called with unprefixed tool name '{tool_name}'. \
                 Expected '<member>{GATEWAY_TOOL_SEPARATOR}<tool>'."
            )));
        };
        let members = crate::db::repos::resources::mcp_gateways::list_members(
            pool,
            credential_id,
        )?;
        let member = members
            .into_iter()
            .find(|m| m.enabled && m.display_name == member_prefix)
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "Gateway member '{member_prefix}' not found or disabled on gateway {credential_id}"
                ))
            })?;
        tracing::debug!(
            via_gateway = %credential_id,
            member_id = %member.member_credential_id,
            member_label = %member.member_label,
            real_tool = %real_tool,
            "Routing tool call through MCP gateway to underlying member"
        );
        return Box::pin(execute_tool(
            pool,
            &member.member_credential_id,
            real_tool,
            arguments,
            rate_limiter,
            persona_id,
            persona_name,
        ))
        .await;
    }

    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;
    if let Err(e) = audit_log::log_decrypt(pool, credential_id, &credential.name, "mcp_tools:execute_tool", persona_id, persona_name) {
        tracing::warn!(credential_id, error = %e, "Failed to write audit log for credential decrypt");
    }

    let connection_type = fields
        .get("connection_type")
        .map(|s| s.as_str())
        .unwrap_or("stdio");

    // Try to resolve input_schema from cache to skip redundant tools/list call
    let cached_schema = get_cached_tools(credential_id).and_then(|tools| {
        tools.into_iter().find(|t| t.name == tool_name).map(|t| t.input_schema)
    });

    let start = Instant::now();

    let result = match connection_type {
        "stdio" => execute_tool_stdio(&fields, tool_name, &arguments, cached_schema.as_ref(), Some(credential_id)).await,
        "sse" => execute_tool_sse(&fields, tool_name, &arguments, cached_schema.as_ref()).await,
        other => Err(AppError::Validation(format!(
            "Unsupported MCP connection type: '{other}'"
        ))),
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    // Audit logging (best-effort, never fails the call)
    let (status, error_msg) = match &result {
        Ok(r) if r.is_error => ("tool_error", None),
        Ok(_) => ("success", None),
        Err(e) => ("error", Some(e.to_string())),
    };
    if let Err(log_err) = tool_audit_log::insert(
        pool,
        &format!("mcp:{credential_id}:{tool_name}"),
        tool_name,
        "mcp",
        persona_id,
        persona_name,
        Some(credential_id),
        status,
        Some(duration_ms),
        error_msg.as_deref(),
    ) {
        tracing::warn!("Failed to write tool audit log: {log_err}");
    }

    match result {
        Ok(mut r) => {
            r.duration_ms = duration_ms;
            // JIT OAuth detection: if this tool result matches the
            // authorization-required sentinel, convert it into a typed error
            // so the frontend can surface the consent URL via PendingAuthModal.
            // This happens AFTER audit logging so the tool_error status is
            // still recorded accurately — the detector only changes how the
            // result is delivered to the caller, not how it's logged.
            if let Some(authorize_url) = detect_authorization_required(&r) {
                tracing::info!(
                    credential_id = %credential_id,
                    tool_name = %tool_name,
                    "MCP tool returned authorization-required sentinel; surfacing as typed AppError::AuthorizationRequired"
                );
                return Err(AppError::AuthorizationRequired {
                    credential_id: credential_id.to_string(),
                    tool_name: tool_name.to_string(),
                    authorize_url,
                });
            }
            Ok(r)
        }
        Err(e) => Err(e),
    }
}

// ============================================================================
// stdio transport (session-pooled)
// ============================================================================

async fn list_tools_stdio(
    fields: &HashMap<String, String>,
    credential_id: Option<&str>,
) -> Result<Vec<McpTool>, AppError> {
    tokio::time::timeout(
        MCP_SESSION_TIMEOUT,
        list_tools_stdio_inner(fields, credential_id),
    )
    .await
    .map_err(|_| AppError::Internal(
        "MCP stdio session timed out during tools/list".into(),
    ))?
}

async fn list_tools_stdio_inner(
    fields: &HashMap<String, String>,
    credential_id: Option<&str>,
) -> Result<Vec<McpTool>, AppError> {
    // Try to acquire a pooled session
    let (mut session, from_pool) = match credential_id {
        Some(cid) => match take_pooled_session(cid).await {
            Some(s) => {
                tracing::debug!(credential_id = %cid, "Reusing pooled MCP stdio session for tools/list");
                (s, true)
            }
            None => {
                pool_metrics().pool_misses.fetch_add(1, Ordering::Relaxed);
                (spawn_stdio_session(fields).await?, false)
            }
        },
        None => {
            pool_metrics().pool_misses.fetch_add(1, Ordering::Relaxed);
            (spawn_stdio_session(fields).await?, false)
        }
    };

    let result = list_tools_on_session(&mut session).await;

    match (&result, from_pool) {
        (Err(e), true) if is_io_error(e) => {
            // Stale pooled session; retry with a fresh process
            tracing::debug!("Pooled MCP session failed for tools/list, spawning fresh process");
            let _ = session.child.start_kill();
            let mut fresh = spawn_stdio_session(fields).await?;
            let retry = list_tools_on_session(&mut fresh).await;
            finish_session(fresh, credential_id, retry.is_ok()).await;
            retry
        }
        (Ok(_), _) => {
            finish_session(session, credential_id, true).await;
            result
        }
        _ => {
            finish_session(session, credential_id, false).await;
            result
        }
    }
}

async fn execute_tool_stdio(
    fields: &HashMap<String, String>,
    tool_name: &str,
    arguments: &serde_json::Value,
    cached_schema: Option<&Option<serde_json::Value>>,
    credential_id: Option<&str>,
) -> Result<McpToolResult, AppError> {
    tokio::time::timeout(
        MCP_SESSION_TIMEOUT,
        execute_tool_stdio_inner(fields, tool_name, arguments, cached_schema, credential_id),
    )
    .await
    .map_err(|_| AppError::Internal(
        format!("MCP stdio session timed out executing tool '{tool_name}'"),
    ))?
}

async fn execute_tool_stdio_inner(
    fields: &HashMap<String, String>,
    tool_name: &str,
    arguments: &serde_json::Value,
    cached_schema: Option<&Option<serde_json::Value>>,
    credential_id: Option<&str>,
) -> Result<McpToolResult, AppError> {
    // Try to acquire a pooled session
    let (mut session, from_pool) = match credential_id {
        Some(cid) => match take_pooled_session(cid).await {
            Some(s) => {
                tracing::debug!(credential_id = %cid, tool = %tool_name, "Reusing pooled MCP stdio session");
                (s, true)
            }
            None => {
                pool_metrics().pool_misses.fetch_add(1, Ordering::Relaxed);
                (spawn_stdio_session(fields).await?, false)
            }
        },
        None => {
            pool_metrics().pool_misses.fetch_add(1, Ordering::Relaxed);
            (spawn_stdio_session(fields).await?, false)
        }
    };

    let result = execute_tool_on_session(&mut session, tool_name, arguments, cached_schema).await;

    match (&result, from_pool) {
        (Err(e), true) if is_io_error(e) => {
            // Stale pooled session; retry with a fresh process
            tracing::debug!(tool = %tool_name, "Pooled MCP session failed, spawning fresh process");
            let _ = session.child.start_kill();
            let mut fresh = spawn_stdio_session(fields).await?;
            let retry = execute_tool_on_session(&mut fresh, tool_name, arguments, cached_schema).await;
            finish_session(fresh, credential_id, retry.is_ok()).await;
            retry
        }
        (Ok(_), _) => {
            finish_session(session, credential_id, true).await;
            result
        }
        _ => {
            finish_session(session, credential_id, false).await;
            result
        }
    }
}

/// Execute `tools/list` on an already-initialized session.
async fn list_tools_on_session(
    session: &mut PooledStdioSession,
) -> Result<Vec<McpTool>, AppError> {
    let list_req = jsonrpc_request(session.next_id, "tools/list", serde_json::json!({}));
    session.next_id += 1;

    write_session_jsonrpc(&mut session.stdin, &list_req).await?;
    let list_resp = read_session_jsonrpc(&mut session.reader).await?;

    let tools_val = list_resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .ok_or_else(|| AppError::Internal("Invalid tools/list response".into()))?;

    let tools: Vec<McpTool> = tools_val
        .iter()
        .filter_map(|t| serde_json::from_value(t.clone()).ok())
        .collect();

    Ok(tools)
}

/// Execute `tools/call` on an already-initialized session, with schema validation.
async fn execute_tool_on_session(
    session: &mut PooledStdioSession,
    tool_name: &str,
    arguments: &serde_json::Value,
    cached_schema: Option<&Option<serde_json::Value>>,
) -> Result<McpToolResult, AppError> {
    // Validate arguments: use cached schema if available, otherwise fetch via tools/list
    if let Some(schema_opt) = cached_schema {
        validate_arguments_against_schema(arguments, schema_opt.as_ref())?;
    } else {
        let list_req = jsonrpc_request(session.next_id, "tools/list", serde_json::json!({}));
        session.next_id += 1;
        write_session_jsonrpc(&mut session.stdin, &list_req).await?;
        let list_resp = read_session_jsonrpc(&mut session.reader).await?;

        let schema = extract_tool_schema(&list_resp, tool_name)?;
        validate_arguments_against_schema(arguments, schema.as_ref())?;
    }

    // Call tool
    let call_req = jsonrpc_request(session.next_id, "tools/call", serde_json::json!({
        "name": tool_name,
        "arguments": arguments,
    }));
    session.next_id += 1;

    write_session_jsonrpc(&mut session.stdin, &call_req).await?;
    let call_resp = read_session_jsonrpc(&mut session.reader).await?;

    parse_tool_result(&call_resp)
}

/// Return a session to the pool on success, or kill it on failure.
async fn finish_session(session: PooledStdioSession, credential_id: Option<&str>, success: bool) {
    if success {
        if let Some(cid) = credential_id {
            return_pooled_session(cid, session).await;
        }
    }
    // Session dropped here — kill_on_drop(true) handles cleanup
}

/// Returns true for errors that indicate the session/process is broken (I/O failures).
/// Validation errors don't indicate a broken session but we still don't pool on error
/// paths to keep the logic simple.
fn is_io_error(e: &AppError) -> bool {
    matches!(e, AppError::Internal(_))
}

// ============================================================================
// SSE transport
// ============================================================================

async fn list_tools_sse(
    fields: &HashMap<String, String>,
) -> Result<Vec<McpTool>, AppError> {
    let url = fields
        .get("url")
        .ok_or_else(|| AppError::Validation("MCP server has no 'url' field".into()))?;

    // SSRF protection: reject private/internal/metadata URLs
    super::url_safety::validate_url_safety(url).map_err(|reason| {
        AppError::Validation(format!("MCP SSE URL blocked: {reason}"))
    })?;

    let auth_token = fields.get("auth_token");

    let client = crate::SHARED_HTTP.clone();

    // Initialize
    let init_payload = jsonrpc_request(1, "initialize", serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "personas-playground", "version": "1.0.0" }
    }));

    let _init_resp = send_sse_request(&client, url, auth_token, &init_payload).await?;

    // List tools
    let list_payload = jsonrpc_request(2, "tools/list", serde_json::json!({}));
    let list_resp = send_sse_request(&client, url, auth_token, &list_payload).await?;

    let tools_val = list_resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .ok_or_else(|| AppError::Internal("Invalid tools/list response from SSE server".into()))?;

    let tools: Vec<McpTool> = tools_val
        .iter()
        .filter_map(|t| serde_json::from_value(t.clone()).ok())
        .collect();

    Ok(tools)
}

async fn execute_tool_sse(
    fields: &HashMap<String, String>,
    tool_name: &str,
    arguments: &serde_json::Value,
    cached_schema: Option<&Option<serde_json::Value>>,
) -> Result<McpToolResult, AppError> {
    let url = fields
        .get("url")
        .ok_or_else(|| AppError::Validation("MCP server has no 'url' field".into()))?;

    // SSRF protection: reject private/internal/metadata URLs
    super::url_safety::validate_url_safety(url).map_err(|reason| {
        AppError::Validation(format!("MCP SSE URL blocked: {reason}"))
    })?;

    let auth_token = fields.get("auth_token");

    let client = crate::SHARED_HTTP.clone();

    // Initialize
    let init_payload = jsonrpc_request(1, "initialize", serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "personas-playground", "version": "1.0.0" }
    }));
    let _init_resp = send_sse_request(&client, url, auth_token, &init_payload).await?;

    // Validate arguments: use cached schema if available, otherwise fetch via tools/list
    if let Some(schema_opt) = cached_schema {
        validate_arguments_against_schema(arguments, schema_opt.as_ref())?;
    } else {
        let list_payload = jsonrpc_request(2, "tools/list", serde_json::json!({}));
        let list_resp = send_sse_request(&client, url, auth_token, &list_payload).await?;

        let schema = extract_tool_schema(&list_resp, tool_name)?;
        validate_arguments_against_schema(arguments, schema.as_ref())?;
    }

    // Call tool
    let call_payload = jsonrpc_request(3, "tools/call", serde_json::json!({
        "name": tool_name,
        "arguments": arguments,
    }));
    let call_resp = send_sse_request(&client, url, auth_token, &call_payload).await?;

    parse_tool_result(&call_resp)
}

async fn send_sse_request(
    client: &reqwest::Client,
    url: &str,
    auth_token: Option<&String>,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let mut req = client.post(url).json(payload);
    if let Some(token) = auth_token {
        req = req.bearer_auth(token);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("SSE request failed: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read SSE response: {e}")))?;

    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "SSE server returned {status}: {body}"
        )));
    }

    serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("Invalid JSON from SSE server: {e}")))
}

// ============================================================================
// Argument validation
// ============================================================================

/// Reject arguments that exceed structural limits (depth, serialized size).
fn validate_argument_structure(arguments: &serde_json::Value) -> Result<(), AppError> {
    let serialized_len = serde_json::to_string(arguments)
        .map_err(|e| AppError::Validation(format!("Cannot serialize arguments: {e}")))?
        .len();

    if serialized_len > MAX_ARGUMENT_BYTES {
        return Err(AppError::Validation(format!(
            "MCP tool arguments exceed maximum size ({serialized_len} bytes > {MAX_ARGUMENT_BYTES} byte limit)"
        )));
    }

    let depth = json_depth(arguments);
    if depth > MAX_ARGUMENT_DEPTH {
        return Err(AppError::Validation(format!(
            "MCP tool arguments exceed maximum nesting depth ({depth} > {MAX_ARGUMENT_DEPTH} limit)"
        )));
    }

    Ok(())
}

/// Compute the maximum nesting depth of a JSON value.
fn json_depth(value: &serde_json::Value) -> usize {
    match value {
        serde_json::Value::Array(arr) => {
            1 + arr.iter().map(json_depth).max().unwrap_or(0)
        }
        serde_json::Value::Object(obj) => {
            1 + obj.values().map(json_depth).max().unwrap_or(0)
        }
        _ => 0,
    }
}

/// Extract the `input_schema` for a specific tool from a `tools/list` response.
/// Returns `Ok(None)` if the tool exists but has no schema.
/// Returns `Err` if the tool is not found in the server's tool list.
fn extract_tool_schema(
    list_resp: &serde_json::Value,
    tool_name: &str,
) -> Result<Option<serde_json::Value>, AppError> {
    let tools_arr = list_resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array())
        .ok_or_else(|| AppError::Internal("Invalid tools/list response".into()))?;

    let tool = tools_arr
        .iter()
        .find(|t| t.get("name").and_then(|n| n.as_str()) == Some(tool_name))
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Tool '{tool_name}' not found on MCP server"
            ))
        })?;

    Ok(tool.get("inputSchema").or_else(|| tool.get("input_schema")).cloned())
}

/// Validate arguments against the tool's declared JSON Schema.
/// Skips validation if no schema is declared (permissive by default).
fn validate_arguments_against_schema(
    arguments: &serde_json::Value,
    schema: Option<&serde_json::Value>,
) -> Result<(), AppError> {
    let schema = match schema {
        Some(s) => s,
        None => return Ok(()), // No schema declared; allow any arguments
    };

    let validator = match jsonschema::validator_for(schema) {
        Ok(v) => v,
        Err(e) => {
            // If the schema itself is invalid, log and skip validation rather
            // than blocking all calls to a tool with a broken schema.
            tracing::warn!("MCP tool has invalid input_schema, skipping validation: {e}");
            return Ok(());
        }
    };

    let errors: Vec<String> = validator
        .iter_errors(arguments)
        .map(|err| {
            let path = err.instance_path.to_string();
            if path.is_empty() {
                err.to_string()
            } else {
                format!("{path}: {err}")
            }
        })
        .collect();

    if !errors.is_empty() {
        let summary = if errors.len() <= 3 {
            errors.join("; ")
        } else {
            format!(
                "{}; ... and {} more errors",
                errors[..3].join("; "),
                errors.len() - 3
            )
        };
        return Err(AppError::Validation(format!(
            "MCP tool arguments failed schema validation: {summary}"
        )));
    }

    Ok(())
}

// ============================================================================
// Helpers
// ============================================================================

fn jsonrpc_request(id: u64, method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    })
}

fn parse_env_vars(fields: &HashMap<String, String>) -> HashMap<String, String> {
    let raw: HashMap<String, String> = fields
        .get("env_vars")
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or_default();

    raw.into_iter()
        .filter_map(|(k, v)| {
            super::runner::sanitize_env_name(&k).map(|safe_key| (safe_key, v))
        })
        .collect()
}

/// Allowlisted MCP server binary basenames.
///
/// Only these executables may be spawned as MCP stdio servers. The check is
/// performed against the first whitespace-delimited token of the command
/// string (i.e. the program name, without arguments). Both bare names and
/// names with common extensions (.exe, .cmd, .bat) are accepted.
const MCP_ALLOWED_BINARIES: &[&str] = &[
    "npx", "node", "python", "python3", "uvx", "uv", "deno", "bun",
    "docker", "podman", "cargo",
];

/// Shell metacharacters that must never appear in an MCP command string.
/// Their presence suggests an injection attempt (pipes, redirects, subshells,
/// command chaining, variable expansion, etc.).
const SHELL_METACHARACTERS: &[char] = &[
    '|', ';', '&', '`', '$', '(', ')', '{', '}', '<', '>', '!', '\n', '\r',
];

/// Validate the MCP command against the binary allowlist and reject shell
/// metacharacters. Returns the sanitized parts (program + args) on success.
fn validate_mcp_command(command: &str) -> Result<Vec<String>, AppError> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("MCP command is empty".into()));
    }

    // Reject shell metacharacters anywhere in the command string.
    if let Some(bad) = trimmed.chars().find(|c| SHELL_METACHARACTERS.contains(c)) {
        return Err(AppError::Validation(format!(
            "MCP command contains forbidden shell metacharacter: '{bad}'"
        )));
    }

    let parts: Vec<String> = trimmed.split_whitespace().map(String::from).collect();
    let program = &parts[0];

    // Extract the basename (strip any directory prefix) and any extension.
    let basename = std::path::Path::new(program.as_str())
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(program.as_str());

    // Strip common extensions for matching (.exe, .cmd, .bat).
    let stem = std::path::Path::new(basename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(basename);

    if !MCP_ALLOWED_BINARIES.iter().any(|&allowed| allowed.eq_ignore_ascii_case(stem)) {
        return Err(AppError::Validation(format!(
            "MCP binary '{}' is not in the allowlist. Permitted: {}",
            basename,
            MCP_ALLOWED_BINARIES.join(", ")
        )));
    }

    Ok(parts)
}

fn spawn_mcp_process(
    command: &str,
    working_directory: Option<&String>,
    env_vars: &HashMap<String, String>,
) -> Result<tokio::process::Child, AppError> {
    let parts = validate_mcp_command(command)?;

    // On Windows, commands like `npx` are actually `.cmd` wrappers that
    // require shell dispatch. Use `cmd /C` with explicit arg list so
    // PATHEXT resolution works without exposing a raw shell string.
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        // Pass "/C" followed by each part as a separate argument.
        // This avoids passing the entire command as a single shell string,
        // preventing metacharacter interpretation by cmd.exe.
        c.arg("/C");
        for part in &parts {
            c.arg(part);
        }
        c
    };

    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = tokio::process::Command::new(&parts[0]);
        if parts.len() > 1 {
            c.args(&parts[1..]);
        }
        c
    };

    if let Some(wd) = working_directory {
        if !wd.trim().is_empty() {
            cmd.current_dir(wd);
        }
    }

    for (k, v) in env_vars {
        cmd.env(k, v);
    }

    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);

    // Prevent a visible console window flash on Windows.
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd.spawn()
        .map_err(|e| AppError::Internal(format!("Failed to spawn MCP process: {e}")))
}

/// Write a JSON-RPC message to a session's stdin with Content-Length framing.
async fn write_session_jsonrpc(
    stdin: &mut tokio::process::ChildStdin,
    payload: &serde_json::Value,
) -> Result<(), AppError> {
    use tokio::io::AsyncWriteExt;

    let json = serde_json::to_string(payload)
        .map_err(|e| AppError::Internal(format!("JSON serialize error: {e}")))?;

    // MCP uses Content-Length header framing
    let message = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);

    tokio::time::timeout(MCP_WRITE_TIMEOUT, async {
        stdin
            .write_all(message.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write to MCP stdin: {e}")))?;

        stdin
            .flush()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to flush MCP stdin: {e}")))?;

        Ok(())
    })
    .await
    .map_err(|_| AppError::Internal("Timeout writing to MCP process stdin".into()))?
}

/// Read a JSON-RPC response from a session's buffered stdout reader.
async fn read_session_jsonrpc(
    reader: &mut tokio::io::BufReader<tokio::process::ChildStdout>,
) -> Result<serde_json::Value, AppError> {
    use tokio::io::AsyncBufReadExt;

    // Read headers with a total timeout (prevents slowloris-style attacks
    // where the server sends headers one byte at a time).
    let content_length: usize = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        async {
            let mut cl: usize = 0;
            loop {
                let mut line = String::new();
                let bytes_read = reader
                    .read_line(&mut line)
                    .await
                    .map_err(|e| AppError::Internal(format!("Failed to read from MCP stdout: {e}")))?;

                if bytes_read == 0 {
                    return Err(AppError::Internal("MCP process closed stdout unexpectedly".into()));
                }

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    break; // End of headers
                }

                if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                    cl = len_str
                        .trim()
                        .parse()
                        .map_err(|_| AppError::Internal("Invalid Content-Length from MCP server".into()))?;
                }
            }
            Ok(cl)
        },
    )
    .await
    .map_err(|_| AppError::Internal("Timeout reading headers from MCP server".into()))??;

    if content_length == 0 {
        return Err(AppError::Internal("MCP server sent no Content-Length header".into()));
    }

    if content_length > MAX_MCP_PAYLOAD_BYTES {
        return Err(AppError::Internal(format!(
            "MCP response too large: Content-Length {} exceeds limit of {} bytes",
            content_length, MAX_MCP_PAYLOAD_BYTES,
        )));
    }

    // Read exact body
    let mut body = vec![0u8; content_length];
    use tokio::io::AsyncReadExt;
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
        reader.read_exact(&mut body),
    )
    .await
    .map_err(|_| AppError::Internal("Timeout reading MCP response body".into()))?
    .map_err(|e| AppError::Internal(format!("Failed to read MCP response body: {e}")))?;

    let json_str = String::from_utf8_lossy(&body);

    serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON from MCP server: {e}")))
}

fn parse_tool_result(resp: &serde_json::Value) -> Result<McpToolResult, AppError> {
    // Check for JSON-RPC error
    if let Some(err) = resp.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Ok(McpToolResult {
            content: vec![McpToolContent {
                content_type: "text".into(),
                text: Some(format!("Error: {msg}")),
            }],
            is_error: true,
            duration_ms: 0,
        });
    }

    let result = resp
        .get("result")
        .ok_or_else(|| AppError::Internal("No result in MCP tool response".into()))?;

    let is_error = result
        .get("isError")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let content: Vec<McpToolContent> = result
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(McpToolResult {
        content,
        is_error,
        duration_ms: 0,
    })
}
