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
use crate::db::repos::resources::teams as team_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

use super::import_export::ImportResult;

/// A gallery slug is `name-suffix` — restrict to URL-safe characters so a
/// deep-link-sourced value can't traverse paths or inject into the request URL.
fn validate_slug(slug: &str) -> Result<(), AppError> {
    if slug.is_empty()
        || slug.len() > 128
        || !slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation("invalid gallery slug".into()));
    }
    Ok(())
}

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

/// Import a persona from the gallery by share slug (the receiving end of the
/// loop, driven by the `personas://import/<slug>` deep link or a paste-a-link
/// UI). Fetches the shared bundle, imports it (migrate + validate + write via
/// the shared `import_persona_from_value`), and best-effort bumps the install
/// counter (social proof / K-factor).
#[tauri::command]
pub async fn gallery_import_persona(
    state: State<'_, Arc<AppState>>,
    slug: String,
) -> Result<ImportResult, AppError> {
    require_auth_sync(&state)?;
    validate_slug(&slug)?;

    let base = gallery_base_url();
    let client = gallery_http_client()?;

    let resp = client
        .get(format!("{base}/api/personas/{slug}"))
        .send()
        .await
        .map_err(|e| AppError::Cloud(format!("gallery fetch failed: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        return Err(AppError::Cloud(format!("gallery fetch failed ({status})")));
    }
    let detail: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Cloud(format!("invalid gallery response: {e}")))?;
    let bundle = detail
        .get("bundle")
        .cloned()
        .ok_or_else(|| AppError::Cloud("gallery response missing bundle".into()))?;

    let result = super::import_export::import_persona_from_value(&state.db, bundle)?;

    // Record the install — best-effort; a failed counter bump must never fail
    // the import the user actually got value from.
    let _ = client.post(format!("{base}/api/personas/{slug}")).send().await;

    Ok(result)
}

// ============================================================================
// F3 — publish a team as a community preset
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PresetPublishResult {
    /// The catalog slug the preset was published under.
    pub slug: String,
}

/// Serialize a live team into a self-contained, shareable blueprint: team meta +
/// each member's `.persona.json` bundle + the connection graph (referencing
/// stable member indices). No credentials are included — the persona bundles
/// already exclude them. This is the "community preset" the catalog stores.
fn build_team_blueprint(
    pool: &crate::db::DbPool,
    team_id: &str,
) -> Result<serde_json::Value, AppError> {
    let team = team_repo::get_by_id(pool, team_id)?;
    let members = team_repo::get_members(pool, team_id)?;
    let connections = team_repo::get_connections(pool, team_id)?;

    if members.is_empty() {
        return Err(AppError::Validation(
            "a team needs at least one member to publish as a preset".into(),
        ));
    }

    // member row id -> array index, so connections reference stable indices
    // rather than ephemeral row ids.
    let index_by_member_id: std::collections::HashMap<&str, usize> = members
        .iter()
        .enumerate()
        .map(|(i, m)| (m.id.as_str(), i))
        .collect();

    let mut member_bps = Vec::with_capacity(members.len());
    for m in &members {
        let bundle = super::import_export::build_persona_bundle(pool, &m.persona_id)?;
        member_bps.push(serde_json::json!({
            "role": m.role,
            "x": m.position_x,
            "y": m.position_y,
            "persona": bundle,
        }));
    }

    let conn_bps: Vec<serde_json::Value> = connections
        .iter()
        .filter_map(|c| {
            let from = index_by_member_id.get(c.source_member_id.as_str())?;
            let to = index_by_member_id.get(c.target_member_id.as_str())?;
            Some(serde_json::json!({
                "from": from,
                "to": to,
                "connectionType": c.connection_type,
                "condition": c.condition,
                "label": c.label,
            }))
        })
        .collect();

    Ok(serde_json::json!({
        "schemaVersion": 1,
        "team": {
            "name": team.name,
            "description": team.description,
            "color": team.color,
            "sharedInstructions": team.shared_instructions,
        },
        "members": member_bps,
        "connections": conn_bps,
    }))
}

/// Publish a team to the public community-preset catalog; returns the slug.
#[tauri::command]
pub async fn gallery_publish_preset(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    publisher: Option<String>,
    install_id: Option<String>,
) -> Result<PresetPublishResult, AppError> {
    require_auth_sync(&state)?;

    let team = team_repo::get_by_id(&state.db, &team_id)?;
    let member_count = team_repo::get_members(&state.db, &team_id)?.len();
    let blueprint = build_team_blueprint(&state.db, &team_id)?;

    let body = serde_json::json!({
        "name": team.name,
        "description": team.description,
        "icon": team.icon,
        "color": team.color,
        "memberCount": member_count,
        "blueprint": blueprint,
        "publisher": publisher,
        "installId": install_id,
    });

    let client = gallery_http_client()?;
    let resp = client
        .post(format!("{}/api/presets/publish", gallery_base_url()))
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Cloud(format!("preset publish request failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let detail = resp.text().await.unwrap_or_default();
        return Err(AppError::Cloud(format!(
            "catalog rejected preset publish ({status}): {}",
            detail.chars().take(300).collect::<String>()
        )));
    }

    resp.json::<PresetPublishResult>()
        .await
        .map_err(|e| AppError::Cloud(format!("invalid preset publish response: {e}")))
}

// ============================================================================
// F4 — referral attribution (the invite loop)
// ============================================================================

/// Referral codes are pseudonymous install ids — restrict to URL-safe chars so
/// a deep-link-sourced value can't break the request URL.
fn validate_referral_code(code: &str) -> Result<(), AppError> {
    if code.is_empty()
        || code.len() > 128
        || !code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(AppError::Validation("invalid referral code".into()));
    }
    Ok(())
}

/// Record that this install arrived via `referrer_code` (attribution). Called
/// once, after a referred install reaches a real activation milestone.
#[tauri::command]
pub async fn record_referral(
    state: State<'_, Arc<AppState>>,
    referrer_code: String,
    install_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    validate_referral_code(&referrer_code)?;
    validate_referral_code(&install_id)?;

    let client = gallery_http_client()?;
    let resp = client
        .post(format!("{}/api/referrals", gallery_base_url()))
        .json(&serde_json::json!({ "referrerCode": referrer_code, "installId": install_id }))
        .send()
        .await
        .map_err(|e| AppError::Cloud(format!("referral request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Cloud(format!(
            "referral rejected ({})",
            resp.status()
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReferralStats {
    /// How many installs this referrer has been credited with.
    pub count: u64,
}

/// How many installs `referrer_code` has been credited with (powers the
/// "you've invited N" line in the invite UI).
#[tauri::command]
pub async fn get_referral_count(
    state: State<'_, Arc<AppState>>,
    referrer_code: String,
) -> Result<ReferralStats, AppError> {
    require_auth_sync(&state)?;
    validate_referral_code(&referrer_code)?;

    let client = gallery_http_client()?;
    let resp = client
        .get(format!(
            "{}/api/referrals?referrer={}",
            gallery_base_url(),
            referrer_code
        ))
        .send()
        .await
        .map_err(|e| AppError::Cloud(format!("referral count request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Cloud(format!(
            "referral count failed ({})",
            resp.status()
        )));
    }
    resp.json::<ReferralStats>()
        .await
        .map_err(|e| AppError::Cloud(format!("invalid referral response: {e}")))
}
