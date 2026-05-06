//! `connector_use` job handler — invokes a registered connector
//! capability and returns a markdown summary the chat session can
//! ingest as a system episode.
//!
//! v1: capability *router* is in place but the actual API calls per
//! service-type are stubbed with a clearly-marked placeholder. The
//! conversation surface works end-to-end (no approval friction, no
//! silent dead-end) — real per-service wiring lands as additional
//! match arms in `dispatch_capability` below.

use serde_json::Value;

use crate::companion::connectors;
use crate::db::UserDbPool;
use crate::error::AppError;

pub async fn run(_pool: &UserDbPool, params: &Value) -> Result<String, AppError> {
    let connector_name = params
        .get("connector_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("connector_use: missing `connector_name`".into()))?;
    let capability = params
        .get("capability")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("connector_use: missing `capability`".into()))?;
    let args = params.get("args").cloned().unwrap_or(serde_json::json!({}));

    // Re-validate at job time — the registry could have changed since
    // dispatch (a connector was removed, capability slug renamed).
    let caps = connectors::capabilities_for(connector_name).ok_or_else(|| {
        AppError::Internal(format!(
            "connector_use: `{connector_name}` has no registered capabilities"
        ))
    })?;
    let cap = caps.iter().find(|c| c.slug == capability).ok_or_else(|| {
        AppError::Internal(format!(
            "connector_use: capability `{capability}` not in `{connector_name}` registry"
        ))
    })?;

    dispatch_capability(connector_name, cap.slug, &args).await
}

/// Per-(connector, capability) routing. Each known pair gets its own
/// match arm; the default returns a clearly-marked stub message so
/// Athena's next turn can speak to it honestly without claiming the
/// API call succeeded.
async fn dispatch_capability(
    connector_name: &str,
    capability: &str,
    args: &Value,
) -> Result<String, AppError> {
    match (connector_name, capability) {
        // Real per-service wiring lands here. Each implementation
        // reads the credential from the vault and makes the actual
        // HTTP call; v1 ships the architecture, the calls land in
        // a follow-up phase keyed off real user need.
        _ => Ok(format!(
            "## Connector call: `{connector_name}::{capability}`\n\n\
             _The capability surface validated end-to-end (connector pinned, \
             capability registered, args echoed below) but the per-service \
             API call is not yet wired._\n\n\
             **Args echoed:**\n\n```json\n{args_pretty}\n```\n\n\
             What this proves: when you ask Athena to use a connector, the \
             call leaves the chat without an approval card, runs in the \
             background-job worker, and lands here as a system episode you \
             can speak to on the next turn. Real API wiring is the next \
             phase — it slots in as a match arm here without changing the \
             surface above.\n",
            args_pretty = serde_json::to_string_pretty(args)
                .unwrap_or_else(|_| "{}".into()),
        )),
    }
}
