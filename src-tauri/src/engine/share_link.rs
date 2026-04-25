//! Share-link server for one-click bundle sharing.
//!
//! Generates short-lived, token-authenticated URLs that serve bundle bytes
//! on-demand. Links auto-expire after 24 hours or first successful download.

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::Path,
    http::{header, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::DbPool;
use crate::engine::bundle;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Share links expire after 24 hours.
const SHARE_LINK_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Maximum number of active share links to prevent memory exhaustion.
const MAX_ACTIVE_LINKS: usize = 64;

/// Port the webhook/management server runs on.
const SERVER_PORT: u16 = 9420;

// ---------------------------------------------------------------------------
// In-memory token store
// ---------------------------------------------------------------------------

#[allow(dead_code)]
struct SharedBundle {
    bytes: Vec<u8>,
    created_at: Instant,
    resource_count: u32,
    bundle_hash: String,
    /// If true, the link has already been consumed.
    consumed: bool,
}

static SHARE_STORE: LazyLock<Mutex<HashMap<String, SharedBundle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Evict expired or consumed entries, keeping the store bounded.
fn evict_expired(store: &mut HashMap<String, SharedBundle>) {
    store.retain(|_, v| !v.consumed && v.created_at.elapsed() < SHARE_LINK_TTL);
}

// ---------------------------------------------------------------------------
// Public API (called from Tauri commands)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ShareLinkResult {
    /// The full URL to share (e.g. http://localhost:9420/share/<token>).
    pub url: String,
    /// A `personas://share` deep link for one-click sharing.
    pub deep_link: String,
    /// The token portion for display purposes.
    pub token: String,
    /// Number of resources in the bundle.
    pub resource_count: u32,
    /// Bundle size in bytes.
    pub byte_size: u64,
    /// When the link expires (ISO 8601).
    pub expires_at: String,
}

/// Parsed fields from a `personas://share` deep link.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResolvedShareLink {
    /// HTTP URL to fetch the bundle from.
    pub http_url: String,
    /// The share token.
    pub token: String,
    /// Peer ID of the bundle creator.
    pub peer_id: String,
    /// Expected bundle hash for verification.
    pub bundle_hash: String,
    /// Number of resources in the bundle.
    pub resource_count: u32,
    /// The host address from the deep link.
    pub host: String,
}

/// Create a share link for the given exposed resources.
///
/// Exports the bundle into memory and returns a URL that serves it once.
/// Also generates a `personas://share` deep link for one-click sharing.
pub fn create_share_link(
    pool: &DbPool,
    resource_ids: &[String],
) -> Result<ShareLinkResult, AppError> {
    let (bytes, export_result) = bundle::export_bundle(pool, resource_ids)?;

    // Get local identity for peer_id in the deep link
    let identity = crate::engine::identity::get_or_create_identity(pool)?;

    let token = uuid::Uuid::new_v4().to_string();
    let now = Instant::now();
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(24);

    let bundle_hash = export_result.bundle_hash.clone();

    let mut store = SHARE_STORE.lock().unwrap();
    evict_expired(&mut store);

    if store.len() >= MAX_ACTIVE_LINKS {
        return Err(AppError::Validation(format!(
            "Too many active share links (max {}). Wait for existing links to expire or be consumed.",
            MAX_ACTIVE_LINKS
        )));
    }

    store.insert(
        token.clone(),
        SharedBundle {
            bytes,
            created_at: now,
            resource_count: export_result.resource_count,
            bundle_hash: bundle_hash.clone(),
            consumed: false,
        },
    );

    let host = get_lan_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let url = format!("http://{}:{}/share/{}", host, SERVER_PORT, token);
    let deep_link = format!(
        "personas://share?token={}&peer={}&hash={}&host={}&port={}&n={}",
        token, identity.peer_id, bundle_hash, host, SERVER_PORT, export_result.resource_count,
    );

    Ok(ShareLinkResult {
        url,
        deep_link,
        token,
        resource_count: export_result.resource_count,
        byte_size: export_result.byte_size,
        expires_at: expires_at.to_rfc3339(),
    })
}

/// Best-effort detection of the machine's LAN IP address.
fn get_lan_ip() -> Option<String> {
    // Connect to an external address (doesn't actually send data) to discover
    // which local interface would be used for LAN traffic.
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("10.255.255.255:1").ok()?;
    let addr = socket.local_addr().ok()?;
    let ip = addr.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        return None;
    }
    Some(ip.to_string())
}

/// Parse a `personas://share` deep link into its components and resolve
/// the HTTP URL for fetching the bundle.
pub fn resolve_deep_link(url: &str) -> Result<ResolvedShareLink, AppError> {
    let parsed = url::Url::parse(url)
        .map_err(|e| AppError::Validation(format!("Invalid deep link URL: {e}")))?;

    if parsed.scheme() != "personas" || parsed.host_str() != Some("share") {
        return Err(AppError::Validation(
            "Not a valid personas://share deep link".into(),
        ));
    }

    let params: HashMap<String, String> = parsed.query_pairs()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    let token = params
        .get("token")
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::Validation("Deep link missing 'token' parameter".into()))?
        .clone();

    let peer_id = params.get("peer").cloned().unwrap_or_default();
    let bundle_hash = params.get("hash").cloned().unwrap_or_default();
    let host = params
        .get("host")
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let port: u16 = params
        .get("port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(SERVER_PORT);
    let resource_count: u32 = params
        .get("n")
        .and_then(|n| n.parse().ok())
        .unwrap_or(0);

    let http_url = format!("http://{}:{}/share/{}", host, port, token);

    Ok(ResolvedShareLink {
        http_url,
        token,
        peer_id,
        bundle_hash,
        resource_count,
        host,
    })
}

/// Revoke an active share link by token.
#[allow(dead_code)]
pub fn revoke_share_link(token: &str) -> bool {
    let mut store = SHARE_STORE.lock().unwrap();
    store.remove(token).is_some()
}

/// Import a bundle from a share link URL by fetching it over HTTP.
///
/// Accepts both localhost URLs and LAN IP addresses for P2P share links.
/// Deep link URLs (`personas://share?...`) should be resolved via
/// [`resolve_deep_link`] first to obtain the HTTP URL.
pub async fn fetch_share_link(url: &str) -> Result<Vec<u8>, AppError> {
    let parsed = url::Url::parse(url)
        .map_err(|e| AppError::Validation(format!("Invalid share link URL: {e}")))?;

    // Only allow http scheme to prevent SSRF via file://, ftp://, etc.
    if parsed.scheme() != "http" {
        return Err(AppError::Validation(
            "Share links must use the http:// scheme".into(),
        ));
    }

    // Allow localhost and private/link-local IPs only (LAN P2P sharing)
    let host = parsed.host_str().unwrap_or("");
    if !is_safe_share_host(host) {
        return Err(AppError::Validation(
            "Share links must point to a local or LAN Personas instance".into(),
        ));
    }

    let resp = reqwest::get(url)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to fetch share link: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::Validation(
            "Share link not found -- it may have expired or already been used".into(),
        ));
    }

    if resp.status() == reqwest::StatusCode::GONE {
        return Err(AppError::Validation(
            "Share link has expired or was already downloaded".into(),
        ));
    }

    if !resp.status().is_success() {
        return Err(AppError::Internal(format!(
            "Share link server returned status {}",
            resp.status()
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read share link response: {e}")))?;

    Ok(bytes.to_vec())
}

/// Check that a host is safe for share link fetching (localhost or LAN).
fn is_safe_share_host(host: &str) -> bool {
    if host == "localhost" || host == "127.0.0.1" || host == "::1" {
        return true;
    }
    // Allow private network ranges (RFC 1918) and link-local
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_private() || v4.is_link_local() || v4.is_loopback()
            }
            std::net::IpAddr::V6(v6) => v6.is_loopback(),
        };
    }
    false
}

// ---------------------------------------------------------------------------
// Axum route handler (served by the webhook/management HTTP server)
// ---------------------------------------------------------------------------

/// GET /share/{token} -- serve bundle bytes and mark as consumed.
async fn handle_share_download(Path(token): Path<String>) -> impl IntoResponse {
    let mut store = match SHARE_STORE.lock() {
        Ok(s) => s,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal error".to_string(),
            )
                .into_response();
        }
    };

    evict_expired(&mut store);

    let entry = match store.get_mut(&token) {
        Some(e) => e,
        None => {
            return (StatusCode::NOT_FOUND, "Share link not found").into_response();
        }
    };

    if entry.consumed {
        return (StatusCode::GONE, "Share link has already been used").into_response();
    }

    if entry.created_at.elapsed() >= SHARE_LINK_TTL {
        entry.consumed = true;
        return (StatusCode::GONE, "Share link has expired").into_response();
    }

    // Mark as consumed and clone bytes before releasing lock
    entry.consumed = true;
    let bytes = entry.bytes.clone();

    drop(store);

    let token_prefix: String = token.chars().take(8).collect();
    tracing::info!(token_prefix = %token_prefix, bytes = bytes.len(), action = "share_link_downloaded", "Share link downloaded");

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"shared-bundle.persona\"",
            ),
        ],
        bytes,
    )
        .into_response()
}

/// Build an axum Router with the share-link download route.
/// This router is stateless (uses the global SHARE_STORE).
pub fn share_link_router() -> Router {
    Router::new().route("/share/{token}", get(handle_share_download))
}
