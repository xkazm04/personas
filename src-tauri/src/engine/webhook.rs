use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State as AxumState},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use tokio::sync::watch;

use rusqlite::params;

use crate::db::models::CreatePersonaEventInput;
use crate::db::models::webhook_log::CreateWebhookRequestLogInput;
use crate::db::models::PersonaEvent;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::repos::resources::webhook_log as webhook_log_repo;
use crate::db::DbPool;
use crate::engine::crypto;
use crate::engine::rate_limiter::{RateLimiter, WEBHOOK_TRIGGER_WINDOW};
use crate::engine::tier::TierConfig;
use crate::error::AppError;

type HmacSha256 = Hmac<Sha256>;

/// Shared state for the webhook HTTP server.
#[derive(Clone)]
pub struct WebhookState {
    pub pool: DbPool,
    pub rate_limiter: Arc<RateLimiter>,
    pub tier_config: Arc<std::sync::Mutex<TierConfig>>,
}

/// Start the webhook HTTP server on port 9420.
///
/// Returns a shutdown sender -- drop it (or send) to stop the server.
pub async fn start_webhook_server(
    pool: DbPool,
    rate_limiter: Arc<RateLimiter>,
    tier_config: Arc<std::sync::Mutex<TierConfig>>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = WebhookState { pool, rate_limiter, tier_config };

    // 1 MB body limit to prevent OOM DoS via oversized payloads
    const MAX_BODY_BYTES: usize = 1024 * 1024;

    let app = Router::new()
        .route("/webhook/{trigger_id}", post(handle_webhook))
        .route("/webhook/{trigger_id}", get(webhook_info))
        .route("/health", get(health))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(Arc::new(state))
        .merge(super::share_link::share_link_router());

    let addr = SocketAddr::from(([127, 0, 0, 1], 9420));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("Webhook server listening on http://{}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.changed().await;
            tracing::info!("Webhook server shutting down");
        })
        .await?;

    Ok(())
}

/// Start the webhook HTTP server with management API routes on port 9420.
///
/// The management API adds /api/* routes for persona execution, lab operations,
/// and version management — used by the Personas MCP server for Claude Desktop.
pub async fn start_webhook_server_with_management(
    pool: DbPool,
    rate_limiter: Arc<RateLimiter>,
    tier_config: Arc<std::sync::Mutex<TierConfig>>,
    app_handle: tauri::AppHandle,
    process_registry: Arc<crate::ActiveProcessRegistry>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let webhook_state = WebhookState {
        pool: pool.clone(),
        rate_limiter,
        tier_config,
    };

    let mgmt_state = super::management_api::ManagementState {
        pool,
        app: app_handle,
        process_registry,
    };

    const MAX_BODY_BYTES: usize = 1024 * 1024;

    let app = Router::new()
        .route("/webhook/{trigger_id}", post(handle_webhook))
        .route("/webhook/{trigger_id}", get(webhook_info))
        .route("/health", get(health))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(Arc::new(webhook_state))
        .merge(super::management_api::management_router(mgmt_state))
        .merge(super::share_link::share_link_router());

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

/// GET /webhook/{trigger_id} -- confirms the webhook endpoint exists and
/// documents active window behavior without leaking internal metadata.
async fn webhook_info(
    AxumState(state): AxumState<Arc<WebhookState>>,
    Path(trigger_id): Path<String>,
) -> impl IntoResponse {
    match trigger_repo::get_by_id(&state.pool, &trigger_id) {
        Ok(trigger) => {
            if trigger.trigger_type != "webhook" {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "Not found" })),
                );
            }

            // Build active window info for callers
            let active_window_info = match trigger.parse_active_window() {
                Some(aw) if aw.enabled && !aw.days.is_empty() => {
                    let utc_now = chrono::Utc::now();
                    let is_active = aw.is_active_at(utc_now);
                    let retry_after = if is_active {
                        None
                    } else {
                        aw.seconds_until_next_open(utc_now)
                    };
                    serde_json::json!({
                        "has_active_window": true,
                        "currently_active": is_active,
                        "retry_after_seconds": retry_after,
                        "note": "Webhooks received outside the active window are rejected with HTTP 422 and a Retry-After header."
                    })
                }
                _ => serde_json::json!({
                    "has_active_window": false,
                    "currently_active": true,
                }),
            };

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "trigger_id": trigger.id,
                    "trigger_type": "webhook",
                    "accepts": "POST",
                    "active_window": active_window_info,
                })),
            )
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Not found" })),
        ),
    }
}

#[derive(Serialize)]
struct WebhookResponse {
    accepted: bool,
    event_id: Option<String>,
    error: Option<String>,
}

/// Serialize request headers to a JSON string for logging.
fn serialize_headers(headers: &HeaderMap) -> String {
    let map: serde_json::Map<String, serde_json::Value> = headers
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_string(),
                serde_json::Value::String(value.to_str().unwrap_or("<binary>").to_string()),
            )
        })
        .collect();
    serde_json::Value::Object(map).to_string()
}

/// POST /webhook/{trigger_id} -- receive webhook payload, validate HMAC, publish event.
async fn handle_webhook(
    AxumState(state): AxumState<Arc<WebhookState>>,
    Path(trigger_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let headers_json = serialize_headers(&headers);
    let body_str = String::from_utf8_lossy(&body).to_string();
    let body_for_log = if body_str.is_empty() { None } else { Some(body_str.clone()) };

    let (status, extra_headers, response) = process_webhook(&state, &trigger_id, &headers, &body).await;

    // Log the request regardless of outcome
    let log_input = CreateWebhookRequestLogInput {
        trigger_id: trigger_id.clone(),
        method: "POST".into(),
        headers: Some(headers_json),
        body: body_for_log,
        status_code: status.as_u16() as i32,
        response_body: serde_json::to_string(&response).ok(),
        event_id: response.event_id.clone(),
        error_message: response.error.clone(),
    };
    if let Err(e) = webhook_log_repo::create(&state.pool, log_input) {
        tracing::warn!("Failed to log webhook request: {}", e);
    }

    (status, extra_headers, Json(response))
}

/// No extra response headers.
fn no_headers() -> HeaderMap {
    HeaderMap::new()
}

/// Core webhook processing logic, separated for clean logging.
async fn process_webhook(
    state: &WebhookState,
    trigger_id: &str,
    headers: &HeaderMap,
    body: &Bytes,
) -> (StatusCode, HeaderMap, WebhookResponse) {
    // 1. Look up the trigger
    let trigger = match trigger_repo::get_by_id(&state.pool, trigger_id) {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                no_headers(),
                WebhookResponse {
                    accepted: false,
                    event_id: None,
                    error: Some("Trigger not found".into()),
                },
            );
        }
    };

    // 2. Verify it's a webhook trigger and enabled
    if trigger.trigger_type != "webhook" {
        return (
            StatusCode::BAD_REQUEST,
            no_headers(),
            WebhookResponse {
                accepted: false,
                event_id: None,
                error: Some("Not a webhook trigger".into()),
            },
        );
    }

    if !trigger.enabled {
        return (
            StatusCode::FORBIDDEN,
            no_headers(),
            WebhookResponse {
                accepted: false,
                event_id: None,
                error: Some("Trigger is disabled".into()),
            },
        );
    }

    // 2b. Rate limit: max webhook calls per trigger per minute (tier-aware)
    let webhook_trigger_max = state.tier_config.lock().unwrap_or_else(|e| e.into_inner()).webhook_trigger_max;
    let rate_key = format!("webhook:{}", trigger_id);
    if let Err(retry_after) = state.rate_limiter.check(&rate_key, webhook_trigger_max, WEBHOOK_TRIGGER_WINDOW) {
        tracing::warn!(
            trigger_id = %trigger_id,
            retry_after = retry_after,
            "Webhook rate limited",
        );
        return (
            StatusCode::TOO_MANY_REQUESTS,
            no_headers(),
            WebhookResponse {
                accepted: false,
                event_id: None,
                error: Some(format!(
                    "Rate limited: max {} webhook calls/minute per trigger. Retry after {}s",
                    webhook_trigger_max, retry_after
                )),
            },
        );
    }

    // 3. Parse config once -- typed access replaces manual JSON extraction
    let cfg = trigger.parse_config();
    let (webhook_secret, cfg_event_type) = match &cfg {
        crate::db::models::TriggerConfig::Webhook {
            webhook_secret, event_type, ..
        } => (webhook_secret.clone(), event_type.clone()),
        _ => (None, None),
    };

    // HMAC validation is mandatory. Webhook triggers must have a non-empty
    // secret (enforced at creation time). Reject unsigned or secretless requests.
    match webhook_secret {
        Some(ref secret) if !secret.is_empty() => {
            let signature = headers
                .get("x-hub-signature-256") // GitHub
                .or_else(|| headers.get("x-signature-256")) // Generic
                .or_else(|| headers.get("x-webhook-signature")) // Custom
                .and_then(|v| v.to_str().ok());

            match signature {
                Some(sig) => {
                    if !verify_hmac_sha256(secret, body, sig) {
                        return (
                            StatusCode::UNAUTHORIZED,
                            no_headers(),
                            WebhookResponse {
                                accepted: false,
                                event_id: None,
                                error: Some("Invalid HMAC signature".into()),
                            },
                        );
                    }
                }
                None => {
                    return (
                        StatusCode::UNAUTHORIZED,
                        no_headers(),
                        WebhookResponse {
                            accepted: false,
                            event_id: None,
                            error: Some(
                                "Missing signature header (x-hub-signature-256, x-signature-256, or x-webhook-signature)".into(),
                            ),
                        },
                    );
                }
            }
        }
        _ => {
            // No secret configured or empty -- reject as misconfigured.
            tracing::warn!(
                trigger_id = %trigger_id,
                "Webhook trigger has no HMAC secret configured -- rejecting request",
            );
            return (
                StatusCode::FORBIDDEN,
                no_headers(),
                WebhookResponse {
                    accepted: false,
                    event_id: None,
                    error: Some("Webhook trigger has no HMAC secret configured".into()),
                },
            );
        }
    }

    // 3b. Active window gate — return 422 so webhook senders know to retry
    let utc_now = chrono::Utc::now();
    if !trigger.is_within_active_window(utc_now) {
        let retry_after_secs = trigger
            .parse_active_window()
            .and_then(|aw| aw.seconds_until_next_open(utc_now));

        let mut resp_headers = HeaderMap::new();
        if let Some(secs) = retry_after_secs {
            if let Ok(val) = HeaderValue::from_str(&secs.to_string()) {
                resp_headers.insert("retry-after", val);
            }
        }

        let msg = match retry_after_secs {
            Some(secs) => format!(
                "Trigger is outside its active hours window. Retry after {}s",
                secs
            ),
            None => "Trigger is outside its active hours window".into(),
        };

        tracing::debug!(
            trigger_id = %trigger_id,
            retry_after = ?retry_after_secs,
            "Webhook received outside active window, rejecting with 422",
        );
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            resp_headers,
            WebhookResponse {
                accepted: false,
                event_id: None,
                error: Some(msg),
            },
        );
    }

    // 4. Parse body as JSON payload (or use raw string)
    let payload = match serde_json::from_slice::<serde_json::Value>(body) {
        Ok(v) => Some(serde_json::to_string(&v).unwrap_or_default()),
        Err(_) => {
            // Not JSON -- wrap as raw text
            let text = String::from_utf8_lossy(body);
            if text.is_empty() {
                None
            } else {
                Some(serde_json::json!({ "raw": text.to_string() }).to_string())
            }
        }
    };

    // 5. Extract event_type from typed config or default
    let event_type = cfg_event_type.unwrap_or_else(|| "webhook_received".to_string());

    // 6+7. Atomically mark trigger as fired AND publish the event in a
    //       single SQLite transaction to prevent orphan trigger advancements.
    let input = CreatePersonaEventInput {
        event_type,
        source_type: "webhook".into(),
        source_id: Some(trigger_id.to_string()),
        target_persona_id: Some(trigger.persona_id.clone()),
        project_id: None,
        payload,
        use_case_id: trigger.use_case_id.clone(),
    };
    match mark_triggered_and_publish(&state.pool, trigger_id, trigger.trigger_version, input) {
        Ok(event) => {
            tracing::info!(
                trigger_id = %trigger_id,
                persona_id = %trigger.persona_id,
                event_id = %event.id,
                "Webhook received and event published",
            );

            (
                StatusCode::OK,
                no_headers(),
                WebhookResponse {
                    accepted: true,
                    event_id: Some(event.id),
                    error: None,
                },
            )
        }
        Err(e) => {
            tracing::error!(trigger_id = %trigger_id, "Failed to process webhook: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                no_headers(),
                WebhookResponse {
                    accepted: false,
                    event_id: None,
                    error: Some("Failed to process webhook".into()),
                },
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

    // Use a dummy 32-byte value when hex decode fails so that both valid-hex
    // and invalid-hex signatures follow the same constant-time comparison path,
    // preventing timing side-channels that leak whether the hex was valid.
    let dummy = [0u8; 32];
    let (expected_bytes, hex_valid) = match hex::decode(hex_sig) {
        Ok(b) => (b, true),
        Err(_) => (dummy.to_vec(), false),
    };

    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };

    mac.update(body);
    // Always run the constant-time comparison, then AND with hex_valid
    // so invalid hex is still rejected without leaking timing information.
    mac.verify_slice(&expected_bytes).is_ok() && hex_valid
}

/// Atomically mark a trigger as fired and publish the corresponding event
/// in a single SQLite transaction. Prevents orphan trigger advancements
/// when the event publish would fail (or vice versa).
fn mark_triggered_and_publish(
    pool: &DbPool,
    trigger_id: &str,
    expected_version: i32,
    input: CreatePersonaEventInput,
) -> Result<PersonaEvent, AppError> {
    let event_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let project_id = input.project_id.unwrap_or_else(|| "default".into());

    let (stored_payload, payload_iv) = match &input.payload {
        Some(plaintext) if !plaintext.is_empty() => {
            match crypto::encrypt_for_db(plaintext) {
                Ok((ct, iv)) => (Some(ct), Some(iv)),
                Err(e) => {
                    tracing::warn!("Failed to encrypt event payload, storing plaintext: {}", e);
                    (Some(plaintext.clone()), None)
                }
            }
        }
        other => (other.clone(), None),
    };

    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    let trigger_rows = tx.execute(
        "UPDATE persona_triggers
         SET last_triggered_at = ?1, next_trigger_at = NULL, updated_at = ?1,
             trigger_version = trigger_version + 1
         WHERE id = ?2 AND trigger_version = ?3",
        params![now, trigger_id, expected_version],
    ).map_err(AppError::Database)?;

    if trigger_rows == 0 {
        return Err(AppError::Validation(
            "Trigger version conflict — concurrent update detected".into(),
        ));
    }

    tx.execute(
        "INSERT INTO persona_events
         (id, project_id, event_type, source_type, source_id, target_persona_id,
          payload, payload_iv, use_case_id, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10)",
        params![
            event_id,
            project_id,
            input.event_type,
            input.source_type,
            input.source_id,
            input.target_persona_id,
            stored_payload,
            payload_iv,
            input.use_case_id,
            now,
        ],
    ).map_err(AppError::Database)?;

    tx.commit().map_err(AppError::Database)?;

    event_repo::get_by_id(pool, &event_id)
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
            &format!("sha256={hex_sig}")
        ));
    }

    #[test]
    fn test_hmac_verification_invalid() {
        assert!(!verify_hmac_sha256("secret", b"body", "deadbeef"));
        assert!(!verify_hmac_sha256("secret", b"body", "sha256=deadbeef"));
        assert!(!verify_hmac_sha256("secret", b"body", "not-hex"));
    }
}
