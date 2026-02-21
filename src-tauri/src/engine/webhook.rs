use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Path, State as AxumState},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use tokio::sync::watch;

use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;

type HmacSha256 = Hmac<Sha256>;

/// Shared state for the webhook HTTP server.
#[derive(Clone)]
pub struct WebhookState {
    pub pool: DbPool,
}

/// Start the webhook HTTP server on port 9420.
///
/// Returns a shutdown sender — drop it (or send) to stop the server.
pub async fn start_webhook_server(
    pool: DbPool,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = WebhookState { pool };

    let app = Router::new()
        .route("/webhook/{trigger_id}", post(handle_webhook))
        .route("/webhook/{trigger_id}", get(webhook_info))
        .route("/health", get(health))
        .with_state(Arc::new(state));

    let addr = SocketAddr::from(([127, 0, 0, 1], 9420));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("Webhook server listening on http://{}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            // Wait until the shutdown signal is sent
            let _ = shutdown_rx.changed().await;
            tracing::info!("Webhook server shutting down");
        })
        .await?;

    Ok(())
}

/// Health check endpoint.
async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok", "service": "personas-webhook" }))
}

/// GET /webhook/{trigger_id} — returns info about the trigger (for debugging).
async fn webhook_info(
    AxumState(state): AxumState<Arc<WebhookState>>,
    Path(trigger_id): Path<String>,
) -> impl IntoResponse {
    match trigger_repo::get_by_id(&state.pool, &trigger_id) {
        Ok(trigger) => {
            if trigger.trigger_type != "webhook" {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "error": "Trigger is not a webhook trigger",
                        "trigger_type": trigger.trigger_type,
                    })),
                );
            }
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "trigger_id": trigger.id,
                    "persona_id": trigger.persona_id,
                    "enabled": trigger.enabled,
                    "trigger_type": "webhook",
                    "last_triggered_at": trigger.last_triggered_at,
                })),
            )
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Trigger not found" })),
        ),
    }
}

#[derive(Serialize)]
struct WebhookResponse {
    accepted: bool,
    event_id: Option<String>,
    error: Option<String>,
}

/// POST /webhook/{trigger_id} — receive webhook payload, validate HMAC, publish event.
async fn handle_webhook(
    AxumState(state): AxumState<Arc<WebhookState>>,
    Path(trigger_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    // 1. Look up the trigger
    let trigger = match trigger_repo::get_by_id(&state.pool, &trigger_id) {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(WebhookResponse {
                    accepted: false,
                    event_id: None,
                    error: Some("Trigger not found".into()),
                }),
            );
        }
    };

    // 2. Verify it's a webhook trigger and enabled
    if trigger.trigger_type != "webhook" {
        return (
            StatusCode::BAD_REQUEST,
            Json(WebhookResponse {
                accepted: false,
                event_id: None,
                error: Some("Not a webhook trigger".into()),
            }),
        );
    }

    if !trigger.enabled {
        return (
            StatusCode::FORBIDDEN,
            Json(WebhookResponse {
                accepted: false,
                event_id: None,
                error: Some("Trigger is disabled".into()),
            }),
        );
    }

    // 3. Extract webhook secret from config and validate HMAC if configured
    let config: serde_json::Value = trigger
        .config
        .as_deref()
        .and_then(|c| serde_json::from_str(c).ok())
        .unwrap_or(serde_json::Value::Null);

    if let Some(secret) = config.get("webhook_secret").and_then(|s| s.as_str()) {
        if !secret.is_empty() {
            // Look for signature in common headers
            let signature = headers
                .get("x-hub-signature-256") // GitHub
                .or_else(|| headers.get("x-signature-256")) // Generic
                .or_else(|| headers.get("x-webhook-signature")) // Custom
                .and_then(|v| v.to_str().ok());

            match signature {
                Some(sig) => {
                    if !verify_hmac_sha256(secret, &body, sig) {
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(WebhookResponse {
                                accepted: false,
                                event_id: None,
                                error: Some("Invalid HMAC signature".into()),
                            }),
                        );
                    }
                }
                None => {
                    return (
                        StatusCode::UNAUTHORIZED,
                        Json(WebhookResponse {
                            accepted: false,
                            event_id: None,
                            error: Some(
                                "Missing signature header (x-hub-signature-256, x-signature-256, or x-webhook-signature)".into(),
                            ),
                        }),
                    );
                }
            }
        }
    }

    // 4. Parse body as JSON payload (or use raw string)
    let payload = match serde_json::from_slice::<serde_json::Value>(&body) {
        Ok(v) => Some(serde_json::to_string(&v).unwrap_or_default()),
        Err(_) => {
            // Not JSON — wrap as raw text
            let text = String::from_utf8_lossy(&body);
            if text.is_empty() {
                None
            } else {
                Some(serde_json::json!({ "raw": text.to_string() }).to_string())
            }
        }
    };

    // 5. Extract event_type from config or default
    let event_type = config
        .get("event_type")
        .and_then(|e| e.as_str())
        .unwrap_or("webhook_received")
        .to_string();

    // 6. Publish event to the event bus
    match event_repo::publish(
        &state.pool,
        CreatePersonaEventInput {
            event_type,
            source_type: "webhook".into(),
            source_id: Some(trigger_id.clone()),
            target_persona_id: Some(trigger.persona_id.clone()),
            project_id: None,
            payload,
        },
    ) {
        Ok(event) => {
            // 7. Mark trigger as fired
            let _ = trigger_repo::mark_triggered(&state.pool, &trigger_id, None);

            tracing::info!(
                trigger_id = %trigger_id,
                persona_id = %trigger.persona_id,
                event_id = %event.id,
                "Webhook received and event published",
            );

            (
                StatusCode::OK,
                Json(WebhookResponse {
                    accepted: true,
                    event_id: Some(event.id),
                    error: None,
                }),
            )
        }
        Err(e) => {
            tracing::error!(trigger_id = %trigger_id, "Failed to publish webhook event: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(WebhookResponse {
                    accepted: false,
                    event_id: None,
                    error: Some("Failed to process webhook".into()),
                }),
            )
        }
    }
}

/// Verify HMAC-SHA256 signature.
///
/// Supports both `sha256=<hex>` format (GitHub-style) and plain hex.
fn verify_hmac_sha256(secret: &str, body: &[u8], signature: &str) -> bool {
    // Strip "sha256=" prefix if present
    let hex_sig = signature
        .strip_prefix("sha256=")
        .unwrap_or(signature);

    let expected_bytes = match hex::decode(hex_sig) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };

    mac.update(body);
    mac.verify_slice(&expected_bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hmac_verification_valid() {
        let secret = "test-secret";
        let body = b"hello world";

        // Compute expected HMAC
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let result = mac.finalize();
        let hex_sig = hex::encode(result.into_bytes());

        assert!(verify_hmac_sha256(secret, body, &hex_sig));
        assert!(verify_hmac_sha256(
            secret,
            body,
            &format!("sha256={}", hex_sig)
        ));
    }

    #[test]
    fn test_hmac_verification_invalid() {
        assert!(!verify_hmac_sha256("secret", b"body", "deadbeef"));
        assert!(!verify_hmac_sha256("secret", b"body", "sha256=deadbeef"));
        assert!(!verify_hmac_sha256("secret", b"body", "not-hex"));
    }
}
