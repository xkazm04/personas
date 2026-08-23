//! Mobile-companion device pairing — the trust anchor for Fleet Command
//! Anywhere (moonshot batch 1, item 5).
//!
//! Replaces the `genToken` UI theatre in `FleetPairDevice.tsx` with a real
//! backend handshake:
//!
//! - [`fleet_pair_device`] mints a 32-byte random device token, stores ONLY
//!   its SHA-256 fingerprint (the plaintext token is returned exactly once,
//!   rendered as a QR + copyable link, and never persisted anywhere on the
//!   desktop), and starts the LAN companion server if it isn't running.
//! - [`fleet_companion_devices`] lists paired devices + server status for the
//!   settings panel.
//! - [`fleet_companion_revoke`] kills a device's access immediately (the
//!   companion API re-reads the store on every request).
//!
//! Security posture (v1, deliberate):
//! - Tokens are device-scoped: each pairing is its own credential with its own
//!   fingerprint, revocable independently.
//! - Verification is constant-time over SHA-256 digests ([`ct_eq`]) — no
//!   early-exit byte compare on a secret.
//! - The store lives in the app settings table (`fleet_companion_devices`
//!   key) as JSON; it contains hashes and metadata only, never a secret.
//! - The QR encodes `http://<lan-ip>:<port>/m/#t=<token>` — LAN reachable
//!   only; nothing ever leaves the machine outbound (see `companion_api`).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use ts_rs::TS;

use std::sync::Arc;

use crate::error::AppError;
use crate::AppState;

/// Settings-table key holding the JSON array of paired devices.
/// Registered in `db::settings_keys::FLEET_COMPANION_DEVICES`.
pub const DEVICES_KEY: &str = "fleet_companion_devices";

/// Hard cap on simultaneously-paired devices — pairing #9 is refused until one
/// is revoked. Keeps the credential surface enumerable by a human.
const MAX_DEVICES: usize = 8;

// ── store ───────────────────────────────────────────────────────────────

/// One paired device as persisted. Contains NO secret — `token_sha256` is a
/// one-way fingerprint of the token the phone holds.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub id: String,
    pub name: String,
    /// Hex SHA-256 of the device token. Never the token itself.
    pub token_sha256: String,
    pub created_at_ms: i64,
    /// 0 = never connected.
    #[serde(default)]
    pub last_seen_ms: i64,
    #[serde(default)]
    pub revoked: bool,
}

/// Load the device store (missing/corrupt → empty; corrupt is logged, never
/// trusted).
pub fn load_devices(pool: &crate::db::DbPool) -> Vec<PairedDevice> {
    match crate::db::repos::core::settings::get(pool, DEVICES_KEY) {
        Ok(Some(json)) => match serde_json::from_str::<Vec<PairedDevice>>(&json) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e, "fleet pairing: device store unparseable — treating as empty");
                Vec::new()
            }
        },
        Ok(None) => Vec::new(),
        Err(e) => {
            tracing::warn!(error = %e, "fleet pairing: device store read failed");
            Vec::new()
        }
    }
}

fn save_devices(pool: &crate::db::DbPool, devices: &[PairedDevice]) -> Result<(), AppError> {
    let json = serde_json::to_string(devices)
        .map_err(|e| AppError::Internal(format!("device store serialize: {e}")))?;
    crate::db::repos::core::settings::set(pool, DEVICES_KEY, &json)
}

/// True when at least one non-revoked device exists — gates whether the LAN
/// companion server has any reason to run.
pub fn any_active_device(pool: &crate::db::DbPool) -> bool {
    load_devices(pool).iter().any(|d| !d.revoked)
}

// ── token verification ──────────────────────────────────────────────────

/// Hex SHA-256 of a token string.
pub fn token_fingerprint(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Constant-time byte equality. Never early-exits on a mismatch, so timing
/// does not leak how many leading bytes of a presented credential matched.
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Resolve a presented plaintext token to the id of a live (non-revoked)
/// device, comparing SHA-256 digests in constant time. Every stored device is
/// checked (no early return on match would change timing only marginally, but
/// the per-device compare itself is the secret-bearing step and is constant
/// time).
pub fn verify_token(devices: &[PairedDevice], presented: &str) -> Option<String> {
    let presented_fp = token_fingerprint(presented);
    let mut matched: Option<String> = None;
    for d in devices {
        let ok = ct_eq(presented_fp.as_bytes(), d.token_sha256.as_bytes()) && !d.revoked;
        if ok && matched.is_none() {
            matched = Some(d.id.clone());
        }
    }
    matched
}

/// Stamp `last_seen_ms` for a device, throttled to once a minute so a 5-second
/// phone poll doesn't turn into a settings write per request. Best-effort.
pub fn touch_device(pool: &crate::db::DbPool, device_id: &str) {
    let now = super::registry::now_ms();
    let mut devices = load_devices(pool);
    let Some(d) = devices.iter_mut().find(|d| d.id == device_id) else {
        return;
    };
    if now - d.last_seen_ms < 60_000 {
        return;
    }
    d.last_seen_ms = now;
    if let Err(e) = save_devices(pool, &devices) {
        tracing::debug!(error = %e, "fleet pairing: last_seen stamp failed (non-fatal)");
    }
}

// ── QR rendering ────────────────────────────────────────────────────────

/// Render `text` as a QR code SVG (dark-theme friendly: transparent background,
/// light modules). Returns a full `<svg>` document string the frontend embeds
/// via a `data:` URI — no innerHTML, no external fetch.
pub fn qr_svg(text: &str) -> Result<String, String> {
    let qr = qrcodegen::QrCode::encode_text(text, qrcodegen::QrCodeEcc::Medium)
        .map_err(|e| format!("QR encode failed: {e}"))?;
    let size = qr.size();
    let border = 2i32;
    let dim = size + border * 2;
    let mut path = String::new();
    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x, y) {
                path.push_str(&format!("M{},{}h1v1h-1z", x + border, y + border));
            }
        }
    }
    Ok(format!(
        concat!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {dim} {dim}\" ",
            "shape-rendering=\"crispEdges\"><rect width=\"{dim}\" height=\"{dim}\" ",
            "fill=\"#0a0e14\"/><path d=\"{path}\" fill=\"#e2e8f0\"/></svg>"
        ),
        dim = dim,
        path = path,
    ))
}

// ── LAN endpoint ────────────────────────────────────────────────────────

/// Best-effort LAN IPv4 of this machine: the local address of a UDP socket
/// "connected" to a public IP (no packet is actually sent). Falls back to
/// loopback when there is no route (offline machine) — the QR then only works
/// on-device, which is honest.
pub fn lan_ip() -> String {
    let probe = || -> Option<String> {
        let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        sock.connect("192.0.2.1:9").ok()?; // TEST-NET-1: never routed, never sent
        Some(sock.local_addr().ok()?.ip().to_string())
    };
    match probe() {
        Some(ip) if ip != "0.0.0.0" => ip,
        _ => "127.0.0.1".to_string(),
    }
}

// ── DTOs ────────────────────────────────────────────────────────────────

/// Result of a pairing — carries the plaintext token exactly once.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetPairResult {
    pub device_id: String,
    pub device_name: String,
    /// The device token. Shown once; the desktop stores only its SHA-256.
    pub token: String,
    /// Full companion URL the QR encodes (token in the fragment, which never
    /// appears in HTTP request lines or server logs).
    pub url: String,
    /// SVG document for the QR of `url`.
    pub qr_svg: String,
    /// Port the LAN companion server is bound to.
    pub port: u16,
}

/// One paired device as surfaced to the settings UI (no fingerprint).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetCompanionDevice {
    pub id: String,
    pub name: String,
    pub created_at_ms: i64,
    pub last_seen_ms: i64,
    pub revoked: bool,
}

/// Devices + server status for the settings panel.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetCompanionStatus {
    pub devices: Vec<FleetCompanionDevice>,
    pub server_running: bool,
    /// Bound port when running.
    pub port: Option<u16>,
    /// LAN base URL when running (no token).
    pub url: Option<String>,
}

// ── commands ────────────────────────────────────────────────────────────

/// Pair a new device: mint a token, persist its fingerprint, ensure the LAN
/// companion server is up, and return QR + link. The returned token is the
/// only copy that will ever exist on this desktop.
#[tauri::command]
pub async fn fleet_pair_device(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    name: Option<String>,
) -> Result<FleetPairResult, AppError> {
    let mut devices = load_devices(&state.db);
    if devices.iter().filter(|d| !d.revoked).count() >= MAX_DEVICES {
        return Err(AppError::Validation(format!(
            "Device limit reached ({MAX_DEVICES}). Revoke a device before pairing another."
        )));
    }

    // 32 bytes of OS randomness, hex-encoded (64 chars).
    let mut bytes = [0u8; 32];
    {
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut bytes);
    }
    let token = hex::encode(bytes);

    let device_id = uuid::Uuid::new_v4().to_string();
    let device_name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| format!("Phone {}", devices.len() + 1));

    devices.push(PairedDevice {
        id: device_id.clone(),
        name: device_name.clone(),
        token_sha256: token_fingerprint(&token),
        created_at_ms: super::registry::now_ms(),
        last_seen_ms: 0,
        revoked: false,
    });
    save_devices(&state.db, &devices)?;

    // Start (or reuse) the LAN server — it only ever runs once a device has
    // explicitly been paired.
    let port = super::companion_api::ensure_started(&app).map_err(AppError::Internal)?;

    let url = format!("http://{}:{}/m/#t={}", lan_ip(), port, token);
    let qr = qr_svg(&url).map_err(AppError::Internal)?;

    super::debug_log::lifecycle(&device_id, "companion_paired", &device_name);
    Ok(FleetPairResult {
        device_id,
        device_name,
        token,
        url,
        qr_svg: qr,
        port,
    })
}

/// List paired devices + server status. Never returns fingerprints.
#[tauri::command]
pub async fn fleet_companion_devices(
    state: State<'_, Arc<AppState>>,
) -> Result<FleetCompanionStatus, AppError> {
    let devices = load_devices(&state.db)
        .into_iter()
        .map(|d| FleetCompanionDevice {
            id: d.id,
            name: d.name,
            created_at_ms: d.created_at_ms,
            last_seen_ms: d.last_seen_ms,
            revoked: d.revoked,
        })
        .collect();
    let port = super::companion_api::port();
    Ok(FleetCompanionStatus {
        devices,
        server_running: port.is_some(),
        port,
        url: port.map(|p| format!("http://{}:{}/m/", lan_ip(), p)),
    })
}

/// Revoke a device. Effective on the device's next request (the API re-reads
/// the store per request). Returns `true` if a live device was revoked.
#[tauri::command]
pub async fn fleet_companion_revoke(
    state: State<'_, Arc<AppState>>,
    device_id: String,
) -> Result<bool, AppError> {
    let mut devices = load_devices(&state.db);
    let Some(d) = devices.iter_mut().find(|d| d.id == device_id && !d.revoked) else {
        return Ok(false);
    };
    d.revoked = true;
    let name = d.name.clone();
    save_devices(&state.db, &devices)?;
    super::debug_log::lifecycle(&device_id, "companion_revoked", &name);
    Ok(true)
}

// Compile-time surface check, mirroring the pattern in `commands.rs`.
#[allow(dead_code)]
fn _assert_commands_exist(app: AppHandle, state: State<'_, Arc<AppState>>) {
    // Type-checked only, never polled — binding it (rather than `let _ =`)
    // says so, and keeps `let_underscore_future` from reading it as a
    // dropped future somebody meant to await.
    let _unpolled = fleet_pair_device(app, state, None);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_eq_matches_and_rejects() {
        assert!(ct_eq(b"abcd", b"abcd"));
        assert!(!ct_eq(b"abcd", b"abce"));
        assert!(!ct_eq(b"abcd", b"abc"));
        assert!(ct_eq(b"", b""));
    }

    #[test]
    fn fingerprint_is_hex_sha256_and_stable() {
        let fp = token_fingerprint("secret");
        assert_eq!(fp.len(), 64);
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(fp, token_fingerprint("secret"));
        assert_ne!(fp, token_fingerprint("secret2"));
    }

    fn device(id: &str, token: &str, revoked: bool) -> PairedDevice {
        PairedDevice {
            id: id.into(),
            name: id.into(),
            token_sha256: token_fingerprint(token),
            created_at_ms: 0,
            last_seen_ms: 0,
            revoked,
        }
    }

    #[test]
    fn verify_token_resolves_live_device_only() {
        let devices = vec![device("a", "tok-a", false), device("b", "tok-b", true)];
        assert_eq!(verify_token(&devices, "tok-a").as_deref(), Some("a"));
        // Revoked device's token no longer authenticates.
        assert_eq!(verify_token(&devices, "tok-b"), None);
        assert_eq!(verify_token(&devices, "wrong"), None);
        assert_eq!(verify_token(&[], "tok-a"), None);
    }

    #[test]
    fn device_store_roundtrips_json() {
        let devices = vec![device("a", "tok-a", false)];
        let json = serde_json::to_string(&devices).unwrap();
        let back: Vec<PairedDevice> = serde_json::from_str(&json).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].id, "a");
        // The persisted form must never contain the token itself.
        assert!(!json.contains("tok-a"));
        assert!(json.contains(&token_fingerprint("tok-a")));
    }

    #[test]
    fn qr_svg_renders_document() {
        let svg = qr_svg("http://192.168.1.10:17500/m/#t=deadbeef").unwrap();
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("path"));
        // The QR encodes the URL as modules — the raw token must not appear
        // as text inside the SVG markup.
        assert!(!svg.contains("deadbeef"));
    }
}
