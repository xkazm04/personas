//! Unified Capability trait for credential-backed external resources.
//!
//! Every external resource interaction (DB query, API proxy, MCP tools) follows
//! the same shape: resolve credential → execute action → collect metrics → audit log.
//!
//! This module formalises that pattern into a single extension point.

use std::collections::HashMap;

use async_trait::async_trait;
use serde::Serialize;
use ts_rs::TS;

use crate::db::DbPool;
use crate::error::AppError;

// Re-export subsystem types so callers can reach them through capability::*.
pub use crate::db::models::QueryResult;
pub use crate::engine::api_proxy::{ApiProxyCredentialMetrics, ApiProxyResponse};
pub use crate::engine::mcp_tools::{McpTool, McpToolResult, StdioPoolMetrics};

// ============================================================================
// Core Trait
// ============================================================================

/// Health status returned by [`Capability::healthcheck`].
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CapabilityHealth {
    pub healthy: bool,
    pub latency_ms: u64,
    pub message: Option<String>,
}

/// Unified trait for credential-backed external resource capabilities.
///
/// Each subsystem (db_query, api_proxy, mcp_tools) implements this trait with
/// concrete associated types for its inputs, outputs, and metrics.
///
/// The trait intentionally does **not** own credential resolution or audit
/// logging — those are handled by the underlying engine functions. Its purpose
/// is to make the shared shape explicit so that contributors see the pattern,
/// new resource types have a template, and generic capability composition
/// becomes possible.
#[allow(dead_code)]
#[async_trait]
pub trait Capability: Send + Sync {
    /// Input payload for the primary action.
    type ExecuteInput: Send;
    /// Result of the primary action.
    type ExecuteOutput: Send;
    /// Result of introspection / discovery (tables, tools, endpoints).
    type IntrospectOutput: Send;
    /// Point-in-time metrics snapshot.
    type Metrics: Send + Serialize;

    /// Human-readable name for logging and UI.
    fn name(&self) -> &'static str;

    /// Execute the primary action against the external resource.
    async fn execute(
        &self,
        pool: &DbPool,
        credential_id: &str,
        input: Self::ExecuteInput,
    ) -> Result<Self::ExecuteOutput, AppError>;

    /// Discover available resources (tables, tools, endpoints).
    async fn introspect(
        &self,
        pool: &DbPool,
        credential_id: &str,
    ) -> Result<Self::IntrospectOutput, AppError>;

    /// Check connectivity and basic availability.
    async fn healthcheck(
        &self,
        pool: &DbPool,
        credential_id: &str,
    ) -> Result<CapabilityHealth, AppError>;

    /// Return a point-in-time metrics snapshot.
    async fn metrics(&self) -> Self::Metrics;
}

// ============================================================================
// Database Query Capability
// ============================================================================

/// Input for [`DbQueryCapability::execute`].
#[allow(dead_code)]
pub struct DbQueryInput {
    pub query_text: String,
    pub allow_mutation: bool,
}

/// Metrics snapshot for the database query subsystem.
#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub struct DbQueryMetrics {
    /// Database queries have per-call duration but no persistent metrics
    /// registry; this is a placeholder for future expansion.
    pub available: bool,
}

/// Capability adapter for `engine::db_query`.
///
/// Wraps the free-function API into the [`Capability`] trait without changing
/// existing callers.
#[allow(dead_code)]
pub struct DbQueryCapability {
    pub user_db: Option<crate::db::UserDbPool>,
}

#[async_trait]
impl Capability for DbQueryCapability {
    type ExecuteInput = DbQueryInput;
    type ExecuteOutput = QueryResult;
    type IntrospectOutput = QueryResult;
    type Metrics = DbQueryMetrics;

    fn name(&self) -> &'static str {
        "db_query"
    }

    async fn execute(
        &self,
        pool: &DbPool,
        credential_id: &str,
        input: Self::ExecuteInput,
    ) -> Result<QueryResult, AppError> {
        crate::engine::db_query::execute_query(
            pool,
            credential_id,
            &input.query_text,
            self.user_db.as_ref(),
            input.allow_mutation,
        )
        .await
    }

    async fn introspect(
        &self,
        pool: &DbPool,
        credential_id: &str,
    ) -> Result<QueryResult, AppError> {
        crate::engine::db_query::introspect_tables(pool, credential_id, self.user_db.as_ref())
            .await
    }

    async fn healthcheck(
        &self,
        pool: &DbPool,
        credential_id: &str,
    ) -> Result<CapabilityHealth, AppError> {
        let start = std::time::Instant::now();
        // Use introspect_tables as a lightweight connectivity probe.
        match crate::engine::db_query::introspect_tables(
            pool,
            credential_id,
            self.user_db.as_ref(),
        )
        .await
        {
            Ok(_) => Ok(CapabilityHealth {
                healthy: true,
                latency_ms: start.elapsed().as_millis() as u64,
                message: None,
            }),
            Err(e) => Ok(CapabilityHealth {
                healthy: false,
                latency_ms: start.elapsed().as_millis() as u64,
                message: Some(e.to_string()),
            }),
        }
    }

    async fn metrics(&self) -> DbQueryMetrics {
        DbQueryMetrics { available: true }
    }
}

// ============================================================================
// API Proxy Capability
// ============================================================================

/// Input for [`ApiProxyCapability::execute`].
#[allow(dead_code)]
pub struct ApiProxyInput {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

/// Capability adapter for `engine::api_proxy`.
#[allow(dead_code)]
pub struct ApiProxyCapability;

#[async_trait]
impl Capability for ApiProxyCapability {
    type ExecuteInput = ApiProxyInput;
    type ExecuteOutput = ApiProxyResponse;
    /// Introspection returns per-credential metrics (the closest analogue to
    /// "what endpoints are available" without a stored OpenAPI spec).
    type IntrospectOutput = Vec<ApiProxyCredentialMetrics>;
    type Metrics = Vec<ApiProxyCredentialMetrics>;

    fn name(&self) -> &'static str {
        "api_proxy"
    }

    async fn execute(
        &self,
        pool: &DbPool,
        credential_id: &str,
        input: Self::ExecuteInput,
    ) -> Result<ApiProxyResponse, AppError> {
        crate::engine::api_proxy::execute_api_request(
            pool,
            credential_id,
            &input.method,
            &input.path,
            input.headers,
            input.body,
        )
        .await
    }

    async fn introspect(
        &self,
        _pool: &DbPool,
        _credential_id: &str,
    ) -> Result<Vec<ApiProxyCredentialMetrics>, AppError> {
        Ok(crate::engine::api_proxy::get_all_proxy_metrics().await)
    }

    async fn healthcheck(
        &self,
        pool: &DbPool,
        credential_id: &str,
    ) -> Result<CapabilityHealth, AppError> {
        let start = std::time::Instant::now();
        // Issue a lightweight HEAD / GET to the base URL.
        match crate::engine::api_proxy::execute_api_request(
            pool,
            credential_id,
            "HEAD",
            "/",
            HashMap::new(),
            None,
        )
        .await
        {
            Ok(resp) => Ok(CapabilityHealth {
                healthy: resp.status < 500,
                latency_ms: start.elapsed().as_millis() as u64,
                message: if resp.status >= 400 {
                    Some(format!("HTTP {}", resp.status))
                } else {
                    None
                },
            }),
            Err(e) => Ok(CapabilityHealth {
                healthy: false,
                latency_ms: start.elapsed().as_millis() as u64,
                message: Some(e.to_string()),
            }),
        }
    }

    async fn metrics(&self) -> Vec<ApiProxyCredentialMetrics> {
        crate::engine::api_proxy::get_all_proxy_metrics().await
    }
}

// ============================================================================
// MCP Tools Capability
// ============================================================================

/// Input for [`McpToolsCapability::execute`].
#[allow(dead_code)]
pub struct McpToolsInput {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub persona_id: Option<String>,
    pub persona_name: Option<String>,
}

/// Capability adapter for `engine::mcp_tools`.
#[allow(dead_code)]
pub struct McpToolsCapability {
    pub rate_limiter: Option<std::sync::Arc<crate::engine::rate_limiter::RateLimiter>>,
}

#[async_trait]
impl Capability for McpToolsCapability {
    type ExecuteInput = McpToolsInput;
    type ExecuteOutput = McpToolResult;
    type IntrospectOutput = Vec<McpTool>;
    type Metrics = StdioPoolMetrics;

    fn name(&self) -> &'static str {
        "mcp_tools"
    }

    async fn execute(
        &self,
        pool: &DbPool,
        credential_id: &str,
        input: Self::ExecuteInput,
    ) -> Result<McpToolResult, AppError> {
        crate::engine::mcp_tools::execute_tool(
            pool,
            credential_id,
            &input.tool_name,
            input.arguments,
            self.rate_limiter.as_deref(),
            input.persona_id.as_deref(),
            input.persona_name.as_deref(),
        )
        .await
    }

    async fn introspect(
        &self,
        pool: &DbPool,
        credential_id: &str,
    ) -> Result<Vec<McpTool>, AppError> {
        crate::engine::mcp_tools::list_tools(pool, credential_id).await
    }

    async fn healthcheck(
        &self,
        pool: &DbPool,
        credential_id: &str,
    ) -> Result<CapabilityHealth, AppError> {
        use crate::db::repos::resources::credentials as cred_repo;

        let start = std::time::Instant::now();
        let credential = cred_repo::get_by_id(pool, credential_id)?;
        let fields = cred_repo::get_decrypted_fields(pool, &credential)?;

        match crate::engine::mcp_tools::ping(&fields).await {
            Ok(ping) => Ok(CapabilityHealth {
                healthy: ping.success,
                latency_ms: start.elapsed().as_millis() as u64,
                message: if ping.success {
                    None
                } else {
                    Some(ping.message)
                },
            }),
            Err(e) => Ok(CapabilityHealth {
                healthy: false,
                latency_ms: start.elapsed().as_millis() as u64,
                message: Some(e.to_string()),
            }),
        }
    }

    async fn metrics(&self) -> StdioPoolMetrics {
        crate::engine::mcp_tools::snapshot_pool_metrics().await
    }
}
