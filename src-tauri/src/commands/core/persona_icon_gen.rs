//! AI generation of custom persona icons.
//!
//! When the user's vault holds a credential for an image-generation connector
//! (Leonardo AI, Higgsfield), the icon picker can generate a bespoke icon from
//! a text prompt instead of requiring an upload.
//!
//! The generated image is downloaded and run through the exact same
//! decode→downscale→re-encode→store pipeline as a manual upload
//! (`persona_icons::store_icon_bytes`), so it lands as an ordinary
//! `custom-icon:` asset with no separate storage path.
//!
//! Both supported providers run an async job — POST to start, then poll a
//! status endpoint until an image URL appears. Response shapes are parsed
//! defensively (`find_string` / `find_image_url` walk the JSON) so a minor
//! API-shape change doesn't break generation outright.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::db::repos::resources::credentials as cred_repo;
use crate::error::AppError;
use crate::AppState;

use super::persona_icons::{store_icon_bytes, MAX_SOURCE_BYTES};

/// Vault connector `service_type`s that can generate images. The `ai`
/// connector category is too broad (it includes vision/analysis connectors),
/// so detection is an explicit allowlist. Each entry must have a matching arm
/// in `generate_persona_icon`'s dispatch.
const IMAGE_GEN_CONNECTORS: &[&str] = &["leonardo_ai", "higgsfield"];

/// Leonardo model used for generation — Leonardo Lightning XL, a fast,
/// inexpensive, broadly-available model. If Leonardo retires this model id,
/// update it here.
const LEONARDO_MODEL_ID: &str = "b24e16ff-06e3-43eb-8d33-4416c2d75876";

/// Higgsfield text-to-image model (see the connector's `llm_usage_hint`).
const HIGGSFIELD_MODEL: &str = "flux-pro/kontext/max";

/// Async-job polling budget. 40 × 3s = 2 minutes.
const POLL_ATTEMPTS: u32 = 40;
const POLL_INTERVAL: Duration = Duration::from_secs(3);

/// Per-request HTTP timeout.
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// A vault credential capable of generating images.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenCredential {
    /// Vault credential id — pass back to `generate_persona_icon`.
    pub id: String,
    /// Connector service type, e.g. `leonardo_ai`.
    pub connector: String,
    /// User-given credential name, shown in the picker.
    pub name: String,
}

/// List vault credentials that can generate icons. The picker shows its
/// "Generate with AI" section only when this returns a non-empty list.
#[tauri::command]
pub fn list_image_gen_credentials(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ImageGenCredential>, AppError> {
    let mut out = Vec::new();
    for connector in IMAGE_GEN_CONNECTORS {
        for cred in cred_repo::get_by_service_type(&state.db, connector)? {
            out.push(ImageGenCredential {
                id: cred.id,
                connector: cred.service_type,
                name: cred.name,
            });
        }
    }
    Ok(out)
}

/// Generate a persona icon from a text prompt using a vault image-gen
/// credential. Returns the stored asset ID (the caller wraps it as
/// `custom-icon:{id}`).
#[tauri::command]
pub async fn generate_persona_icon(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    prompt: String,
) -> Result<String, AppError> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::Validation("Prompt cannot be empty".into()));
    }
    if prompt.chars().count() > 1500 {
        return Err(AppError::Validation("Prompt is too long".into()));
    }

    let credential = cred_repo::get_by_id(&state.db, &credential_id)?;
    if !IMAGE_GEN_CONNECTORS.contains(&credential.service_type.as_str()) {
        return Err(AppError::Validation(format!(
            "Connector '{}' cannot generate images",
            credential.service_type
        )));
    }
    let fields = cred_repo::get_decrypted_fields(&state.db, &credential)?;

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client: {e}")))?;

    let image_bytes = match credential.service_type.as_str() {
        "leonardo_ai" => leonardo_generate(&client, &fields, prompt).await?,
        "higgsfield" => higgsfield_generate(&client, &fields, prompt).await?,
        other => {
            return Err(AppError::Validation(format!(
                "Unsupported image-gen connector '{other}'"
            )))
        }
    };

    store_icon_bytes(&app, image_bytes).await
}

// ── Providers ─────────────────────────────────────────────────────────────────

/// Leonardo AI: POST a generation job, poll `/generations/{id}` for the result.
async fn leonardo_generate(
    client: &reqwest::Client,
    fields: &HashMap<String, String>,
    prompt: &str,
) -> Result<Vec<u8>, AppError> {
    let api_key = require_field(fields, "api_key")?;
    let auth = format!("Bearer {api_key}");

    let body = serde_json::json!({
        "prompt": prompt,
        "modelId": LEONARDO_MODEL_ID,
        "width": 512,
        "height": 512,
        "num_images": 1,
    });
    let resp = client
        .post("https://cloud.leonardo.ai/api/rest/v1/generations")
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Leonardo request failed: {e}")))?;
    let json = ok_json(resp, "Leonardo").await?;

    let generation_id = find_string(&json, &["generationId", "id"]).ok_or_else(|| {
        AppError::Internal("Leonardo did not return a generation id".into())
    })?;
    let status_url =
        format!("https://cloud.leonardo.ai/api/rest/v1/generations/{generation_id}");
    let image_url = poll_for_image(client, &status_url, &auth, "Leonardo").await?;
    download_image(client, &image_url).await
}

/// Higgsfield: POST a generation job, poll `/requests/{id}/status` for the
/// result. API shape per the connector's catalog `llm_usage_hint`.
async fn higgsfield_generate(
    client: &reqwest::Client,
    fields: &HashMap<String, String>,
    prompt: &str,
) -> Result<Vec<u8>, AppError> {
    let key_id = require_field(fields, "key_id")?;
    let key_secret = require_field(fields, "key_secret")?;
    let auth = format!("Key {key_id}:{key_secret}");

    let body = serde_json::json!({
        "task": "text-to-image",
        "model": HIGGSFIELD_MODEL,
        "prompt": prompt,
        "aspect_ratio": "1:1",
    });
    let resp = client
        .post("https://platform.higgsfield.ai/v1/generations")
        .header("Authorization", &auth)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Higgsfield request failed: {e}")))?;
    let json = ok_json(resp, "Higgsfield").await?;

    let request_id =
        find_string(&json, &["request_id", "requestId", "id"]).ok_or_else(|| {
            AppError::Internal("Higgsfield did not return a request id".into())
        })?;
    let status_url =
        format!("https://platform.higgsfield.ai/requests/{request_id}/status");
    let image_url = poll_for_image(client, &status_url, &auth, "Higgsfield").await?;
    download_image(client, &image_url).await
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/// Read a required (non-empty) credential field.
fn require_field<'a>(
    fields: &'a HashMap<String, String>,
    key: &str,
) -> Result<&'a str, AppError> {
    fields
        .get(key)
        .map(String::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Validation(format!("Credential is missing the '{key}' field"))
        })
}

/// Treat a non-2xx response as an error, surfacing a snippet of the body so
/// the user sees the provider's actual complaint (bad key, quota, etc.).
async fn ok_json(resp: reqwest::Response, provider: &str) -> Result<Value, AppError> {
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        return Err(AppError::Internal(format!(
            "{provider} API error ({status}): {snippet}"
        )));
    }
    resp.json()
        .await
        .map_err(|e| AppError::Internal(format!("{provider} response parse failed: {e}")))
}

/// Poll a status endpoint until an image URL appears, the job fails, or the
/// polling budget is exhausted.
async fn poll_for_image(
    client: &reqwest::Client,
    status_url: &str,
    auth: &str,
    provider: &str,
) -> Result<String, AppError> {
    for _ in 0..POLL_ATTEMPTS {
        tokio::time::sleep(POLL_INTERVAL).await;

        let resp = client
            .get(status_url)
            .header("Authorization", auth)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("{provider} status poll failed: {e}")))?;

        // A transient non-2xx on a poll shouldn't abort the whole job.
        if !resp.status().is_success() {
            continue;
        }
        let Ok(json) = resp.json::<Value>().await else {
            continue;
        };

        let status = find_string(&json, &["status"])
            .unwrap_or_default()
            .to_lowercase();
        if status.contains("fail") || status.contains("error") || status == "nsfw" {
            return Err(AppError::Internal(format!(
                "{provider} generation failed (status: {status})"
            )));
        }
        if let Some(url) = find_image_url(&json) {
            return Ok(url);
        }
    }
    Err(AppError::Internal(format!(
        "{provider} generation timed out after {}s",
        POLL_ATTEMPTS as u64 * POLL_INTERVAL.as_secs()
    )))
}

/// Download an image URL into bytes, enforcing `MAX_SOURCE_BYTES` *during* the
/// read.
///
/// The URL comes from `find_image_url` walking an external provider's JSON, so a
/// buggy or compromised provider, a CDN redirect, or an oversized original could
/// otherwise stream unbounded bytes into RAM and OOM the desktop app — the
/// post-download cap in `store_icon_bytes` only fires *after* the whole body is
/// already buffered. We reject early on an oversized `Content-Length`, then
/// guard the streamed body chunk-by-chunk because the header may be absent or
/// untruthful.
async fn download_image(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, AppError> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Image download failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Internal(format!(
            "Image download failed (HTTP {})",
            resp.status()
        )));
    }

    // Refuse before reading a single byte when the provider advertises an
    // oversized body.
    if let Some(len) = resp.content_length() {
        if len > MAX_SOURCE_BYTES {
            return Err(image_too_large());
        }
    }

    // Stream the body, capping as bytes arrive — this is the real guard, since
    // the Content-Length header can lie or be omitted entirely.
    let mut buf: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|e| AppError::Internal(format!("Image download read failed: {e}")))?;
        push_capped(&mut buf, &chunk)?;
    }
    Ok(buf)
}

/// Append `chunk` to `buf`, erroring out the moment the running total would
/// exceed `MAX_SOURCE_BYTES`. Pulled out of the stream loop so the cap logic is
/// unit-testable without a live HTTP server.
fn push_capped(buf: &mut Vec<u8>, chunk: &[u8]) -> Result<(), AppError> {
    if buf.len() as u64 + chunk.len() as u64 > MAX_SOURCE_BYTES {
        return Err(image_too_large());
    }
    buf.extend_from_slice(chunk);
    Ok(())
}

/// The "image exceeds the cap" error, phrased the same way for both the
/// early `Content-Length` rejection and the mid-stream abort.
fn image_too_large() -> AppError {
    AppError::Validation(format!(
        "Generated image exceeds the {} MB limit.",
        MAX_SOURCE_BYTES / (1024 * 1024),
    ))
}

/// Recursively search a JSON value for the first non-empty string stored under
/// any of `keys`. Tolerates the result being nested at varying depths.
fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for k in keys {
                if let Some(Value::String(s)) = map.get(*k) {
                    if !s.is_empty() {
                        return Some(s.clone());
                    }
                }
            }
            map.values().find_map(|child| find_string(child, keys))
        }
        Value::Array(arr) => arr.iter().find_map(|child| find_string(child, keys)),
        _ => None,
    }
}

/// Recursively search a JSON value for the first plausible HTTPS image URL.
/// Prefers values under common image-URL keys; otherwise accepts any HTTPS
/// string with an image extension.
fn find_image_url(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => {
            let lower = s.to_lowercase();
            let is_image = lower.contains(".png")
                || lower.contains(".jpg")
                || lower.contains(".jpeg")
                || lower.contains(".webp");
            if s.starts_with("https://") && is_image {
                Some(s.clone())
            } else {
                None
            }
        }
        Value::Object(map) => {
            for k in ["url", "image_url", "imageUrl", "uri", "image"] {
                if let Some(Value::String(s)) = map.get(k) {
                    if s.starts_with("https://") {
                        return Some(s.clone());
                    }
                }
            }
            map.values().find_map(find_image_url)
        }
        Value::Array(arr) => arr.iter().find_map(find_image_url),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_string_walks_nested_objects() {
        let v = serde_json::json!({ "sdGenerationJob": { "generationId": "gen-123" } });
        assert_eq!(find_string(&v, &["generationId"]).as_deref(), Some("gen-123"));
    }

    #[test]
    fn find_image_url_picks_nested_array_url() {
        let v = serde_json::json!({
            "generations_by_pk": {
                "status": "COMPLETE",
                "generated_images": [{ "url": "https://cdn.leonardo.ai/x/image_0.png" }]
            }
        });
        assert_eq!(
            find_image_url(&v).as_deref(),
            Some("https://cdn.leonardo.ai/x/image_0.png"),
        );
    }

    #[test]
    fn find_image_url_none_while_pending() {
        let v = serde_json::json!({
            "generations_by_pk": { "status": "PENDING", "generated_images": [] }
        });
        assert_eq!(find_image_url(&v), None);
    }

    #[test]
    fn push_capped_accumulates_under_the_limit() {
        let mut buf = Vec::new();
        let chunk = vec![0u8; 1024 * 1024]; // 1 MB
        for _ in 0..9 {
            push_capped(&mut buf, &chunk).expect("under cap");
        }
        assert_eq!(buf.len(), 9 * 1024 * 1024);
    }

    #[test]
    fn push_capped_rejects_when_crossing_the_limit() {
        let mut buf = Vec::new();
        let chunk = vec![0u8; 1024 * 1024]; // 1 MB
        for _ in 0..10 {
            push_capped(&mut buf, &chunk).expect("first 10 MB allowed");
        }
        // The 11th chunk pushes past MAX_SOURCE_BYTES (10 MB) and must error
        // without growing the buffer further.
        let err = push_capped(&mut buf, &chunk).expect_err("should exceed cap");
        assert!(matches!(err, AppError::Validation(_)));
        assert_eq!(buf.len(), 10 * 1024 * 1024);
    }
}
