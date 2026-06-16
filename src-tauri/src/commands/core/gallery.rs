//! Growth: the desktop client for the public persona gallery (personas-web /
//! Supabase). `gallery_publish_persona` turns a local persona into a shareable
//! link; `gallery_import_persona` (added with the deep-link arm) brings one back
//! by slug. This closes the "share your agent → a friend gets it in one click"
//! loop the gallery web pages host.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::repos::core::personas as persona_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Base URL of the personas-web gallery API. Overridable for staging/dev via
/// `PERSONAS_WEB_URL`; defaults to production.
fn gallery_base_url() -> String {
    std::env::var("PERSONAS_WEB_URL")
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://personas.ai".to_string())
}

fn gallery_http_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::Cloud(format!("http client: {e}")))
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GalleryPublishResult {
    /// The gallery slug (stable id within /api/personas).
    pub slug: String,
    /// Canonical share URL (https://…/p/<slug>) the user copies/sends.
    pub url: String,
}

/// Publish a persona to the public gallery; returns the share slug + URL.
///
/// `publisher` is an optional pseudonymous display name shown on the share page;
/// `install_id` is the caller's pseudonymous install id (abuse attribution only,
/// never surfaced). The full persona is sent as a versioned `.persona.json`
/// bundle so the share page can offer a lossless "Open in Personas" / download.
#[tauri::command]
pub async fn gallery_publish_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    publisher: Option<String>,
    install_id: Option<String>,
) -> Result<GalleryPublishResult, AppError> {
    require_auth_sync(&state)?;

    // Display metadata (denormalized on the gallery row) + the full bundle.
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let bundle = super::import_export::build_persona_bundle(&state.db, &persona_id)?;

    // Custom icons are local-only files — downgrade to a built-in so the gallery
    // row doesn't carry a dead reference (mirrors the bundle's own downgrade).
    let safe_icon = crate::engine::persona_icon::export_safe_icon(
        persona.icon.as_deref(),
        persona.template_category.as_deref(),
    );

    let body = serde_json::json!({
        "name": persona.name,
        "description": persona.description,
        "icon": safe_icon,
        "color": persona.color,
        "category": persona.template_category,
        "bundle": bundle,
        "publisher": publisher,
        "installId": install_id,
    });

    let client = gallery_http_client()?;
    let resp = client
        .post(format!("{}/api/personas/publish", gallery_base_url()))
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Cloud(format!("publish request failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let detail = resp.text().await.unwrap_or_default();
        return Err(AppError::Cloud(format!(
            "gallery rejected publish ({status}): {}",
            detail.chars().take(300).collect::<String>()
        )));
    }

    resp.json::<GalleryPublishResult>()
        .await
        .map_err(|e| AppError::Cloud(format!("invalid publish response: {e}")))
}
