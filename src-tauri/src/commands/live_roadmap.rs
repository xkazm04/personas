//! Live Roadmap — runtime-fetched roadmap content.
//!
//! Replaces the bundled roadmap JSON with a version downloaded from a public
//! URL so the developer can update the in-app roadmap without cutting a new
//! desktop release. See `docs/concepts/live-roadmap.md` for the full design
//! including hosting, schema, and the migration path to Variant B (Supabase).
//!
//! - URL:        [`ROADMAP_URL`]
//! - Cache:      `<app_data_dir>/roadmap_cache.json`, 1 h TTL, ETag-revalidated
//! - Fallback:   if the network fails *and* no cache exists, returns Err.
//!               The frontend interprets Err as "use bundled content".

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Canonical URL for the published roadmap JSON. Served by `personas-web`
/// (`/public/roadmap/v1.json` in that repo → root-relative on the deployed
/// site). Path carries an explicit `v1` so the schema can evolve without
/// breaking older desktop builds still in the wild.
const ROADMAP_URL: &str = "https://personas.so/roadmap/v1.json";

/// Schema version this build understands. Payloads with a different version
/// are rejected; the frontend falls back to bundled content.
const SCHEMA_VERSION: u32 = 1;

/// How long a successful fetch stays fresh before we re-check on demand.
const CACHE_TTL: Duration = Duration::from_secs(60 * 60);

/// Per-request connect + read timeout. Kept short so a dead CDN never delays
/// first paint — the frontend fallback covers us well inside this budget.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Hard cap on payload size. A healthy roadmap is a few dozen KB; this guards
/// against a compromised origin serving a huge file.
const MAX_PAYLOAD_BYTES: usize = 512 * 1024;

/// Cache file name inside the platform app-data directory.
const CACHE_FILENAME: &str = "roadmap_cache.json";

// ---------------------------------------------------------------------------
// Wire types — shape of the published JSON.
//
// Fields typed as `String` rather than enums are deliberately forward-
// compatible: a new `status` or `priority` value added remotely doesn't break
// parsing. The frontend merges and drops unknown enum values with a warning.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoadmap {
    pub schema_version: u32,
    pub generated_at: Option<String>,
    pub release: LiveRoadmapRelease,
    pub i18n: HashMap<String, LiveRoadmapLocale>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoadmapRelease {
    pub version: String,
    pub status: String,
    pub items: Vec<LiveRoadmapItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoadmapItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub sort_order: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoadmapLocale {
    pub label: Option<String>,
    pub summary: Option<String>,
    pub items: HashMap<String, LiveRoadmapLocaleItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoadmapLocaleItem {
    pub title: String,
    pub description: Option<String>,
}

// ---------------------------------------------------------------------------
// Frontend-facing result — wraps the payload with fetch metadata so the UI
// can show "Updated Xm ago" / "Offline — cached" pills without guessing.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoadmapResult {
    pub roadmap: LiveRoadmap,
    /// RFC-3339 timestamp of the most recent successful fetch.
    pub fetched_at: String,
    /// Where this payload came from on *this* call. "network" = fresh GET
    /// just completed; "cache" = served from disk (either fresh-enough or
    /// returned because the network path failed).
    pub source: LiveRoadmapSource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum LiveRoadmapSource {
    Network,
    Cache,
}

// ---------------------------------------------------------------------------
// On-disk cache — internal, not exposed to TS.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedRoadmap {
    roadmap: LiveRoadmap,
    etag: Option<String>,
    cached_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn fetch_roadmap(
    app: AppHandle,
    force: bool,
) -> Result<LiveRoadmapResult, String> {
    let cache_path = cache_path(&app).map_err(|e| e.to_string())?;
    let cached = read_cache(&cache_path);

    // Fresh-enough cache? Skip the network entirely.
    if !force {
        if let Some(c) = &cached {
            let age = (Utc::now() - c.cached_at)
                .to_std()
                .unwrap_or(Duration::ZERO);
            if age < CACHE_TTL {
                return Ok(LiveRoadmapResult {
                    roadmap: c.roadmap.clone(),
                    fetched_at: c.cached_at.to_rfc3339(),
                    source: LiveRoadmapSource::Cache,
                });
            }
        }
    }

    // Try the network. On any failure we fall back to the cache if we have
    // one — the command only surfaces an error when both paths are unusable.
    match fetch_from_network(cached.as_ref()).await {
        Ok(FetchOutcome::Fresh { roadmap, etag }) => {
            let now = Utc::now();
            let new_cache = CachedRoadmap {
                roadmap: roadmap.clone(),
                etag,
                cached_at: now,
            };
            let _ = write_cache(&cache_path, &new_cache);
            Ok(LiveRoadmapResult {
                roadmap,
                fetched_at: now.to_rfc3339(),
                source: LiveRoadmapSource::Network,
            })
        }
        Ok(FetchOutcome::NotModified) => {
            // 304 → bump freshness on the existing cache and return it.
            let mut c = cached
                .ok_or_else(|| "304 Not Modified but no cache available".to_string())?;
            let now = Utc::now();
            c.cached_at = now;
            let _ = write_cache(&cache_path, &c);
            Ok(LiveRoadmapResult {
                roadmap: c.roadmap,
                fetched_at: now.to_rfc3339(),
                source: LiveRoadmapSource::Network,
            })
        }
        Err(err) => {
            if let Some(c) = cached {
                return Ok(LiveRoadmapResult {
                    roadmap: c.roadmap,
                    fetched_at: c.cached_at.to_rfc3339(),
                    source: LiveRoadmapSource::Cache,
                });
            }
            Err(err)
        }
    }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

enum FetchOutcome {
    Fresh {
        roadmap: LiveRoadmap,
        etag: Option<String>,
    },
    NotModified,
}

async fn fetch_from_network(
    cached: Option<&CachedRoadmap>,
) -> Result<FetchOutcome, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(REQUEST_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!("PersonasDesktop/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("client build failed: {e}"))?;

    let mut req = client.get(ROADMAP_URL);
    if let Some(etag) = cached.and_then(|c| c.etag.as_deref()) {
        req = req.header("If-None-Match", etag);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;

    if resp.status().as_u16() == 304 {
        return Ok(FetchOutcome::NotModified);
    }
    if !resp.status().is_success() {
        return Err(format!("unexpected status {}", resp.status()));
    }

    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read body failed: {e}"))?;

    if bytes.len() > MAX_PAYLOAD_BYTES {
        return Err(format!(
            "payload too large: {} bytes (max {})",
            bytes.len(),
            MAX_PAYLOAD_BYTES
        ));
    }

    let roadmap: LiveRoadmap = serde_json::from_slice(&bytes)
        .map_err(|e| format!("parse failed: {e}"))?;
    validate(&roadmap)?;

    Ok(FetchOutcome::Fresh { roadmap, etag })
}

fn validate(r: &LiveRoadmap) -> Result<(), String> {
    if r.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported schema_version {}, expected {}",
            r.schema_version, SCHEMA_VERSION
        ));
    }
    if r.release.version != "roadmap" {
        return Err(format!(
            "release.version must be \"roadmap\", got {:?}",
            r.release.version
        ));
    }
    if !r.i18n.contains_key("en") {
        return Err("i18n.en block is required".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Disk cache
// ---------------------------------------------------------------------------

fn cache_path(app: &AppHandle) -> std::io::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(CACHE_FILENAME))
}

fn read_cache(path: &PathBuf) -> Option<CachedRoadmap> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_cache(path: &PathBuf, cache: &CachedRoadmap) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(cache)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)
}

// ---------------------------------------------------------------------------
// Tests — schema validation only. Network + disk paths exercised manually in
// dev via the Tauri inspector.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid() -> LiveRoadmap {
        let mut i18n = HashMap::new();
        i18n.insert(
            "en".to_string(),
            LiveRoadmapLocale {
                label: Some("Roadmap".into()),
                summary: None,
                items: HashMap::new(),
            },
        );
        LiveRoadmap {
            schema_version: SCHEMA_VERSION,
            generated_at: None,
            release: LiveRoadmapRelease {
                version: "roadmap".into(),
                status: "roadmap".into(),
                items: vec![],
            },
            i18n,
        }
    }

    #[test]
    fn validates_a_well_formed_payload() {
        assert!(validate(&make_valid()).is_ok());
    }

    #[test]
    fn rejects_wrong_schema_version() {
        let mut r = make_valid();
        r.schema_version = 99;
        assert!(validate(&r).is_err());
    }

    #[test]
    fn rejects_non_roadmap_release_version() {
        let mut r = make_valid();
        r.release.version = "0.0.1".into();
        assert!(validate(&r).is_err());
    }

    #[test]
    fn rejects_missing_en_locale() {
        let mut r = make_valid();
        r.i18n.clear();
        assert!(validate(&r).is_err());
    }

    #[test]
    fn parses_canonical_payload() {
        let payload = r#"{
            "schemaVersion": 1,
            "release": {
                "version": "roadmap",
                "status": "roadmap",
                "items": [
                    {"id": "2", "type": "feature", "status": "in_progress",
                     "priority": "now", "sortOrder": 1}
                ]
            },
            "i18n": {
                "en": {
                    "label": "Roadmap",
                    "items": {"2": {"title": "Live updates"}}
                }
            }
        }"#;
        let parsed: LiveRoadmap = serde_json::from_str(payload).expect("parses");
        assert!(validate(&parsed).is_ok());
        assert_eq!(parsed.release.items.len(), 1);
        let item = &parsed.release.items[0];
        assert_eq!(item.id, "2");
        assert_eq!(item.item_type, "feature");
        assert_eq!(item.sort_order, Some(1));
    }

    #[test]
    fn ignores_unknown_status_values_without_failing_parse() {
        // Forward-compat: a new status sent by a newer personas-web should
        // not fail deserialization — the frontend merges and drops unknowns.
        let payload = r#"{
            "schemaVersion": 1,
            "release": {
                "version": "roadmap", "status": "roadmap",
                "items": [
                    {"id": "1", "type": "feature", "status": "future_unknown_state"}
                ]
            },
            "i18n": {"en": {"items": {}}}
        }"#;
        let parsed: LiveRoadmap = serde_json::from_str(payload).expect("parses");
        assert_eq!(parsed.release.items[0].status.as_deref(), Some("future_unknown_state"));
    }
}
