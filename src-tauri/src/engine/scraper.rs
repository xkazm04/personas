//! Embedded local scraper (Phase 0) — proves the Pumper-in-Personas embedding.
//!
//! Uses `pumper-core` (git dependency, `default-features = false` → no sqlx, no
//! Chrome, no wasmtime/tantivy) purely for its engine traits + tiered `Fetcher`
//! + HTML→Markdown. The HTTP tier is backed by **Personas' own SSRF-safe reqwest
//! client** (rejects private IPs at connect time), NOT Pumper's default engine —
//! so a user-facing "fetch a URL" capability can't be turned into an SSRF probe.
//!
//! Phase 0 ships the **http tier only**: the browser tier (Chrome) and the claude
//! research tier are stubbed out with disabled implementations and enabled in
//! later phases (see docs/plans/pumper-inbuilt-feasibility.md). The stubs exist
//! only because `Fetcher::new` requires all three engines.
#![cfg(feature = "scraper")]

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use pumper_core::engine::{
    Browser, HttpClient, HttpMethod, HttpRequest, HttpResponse, RenderRequest, RenderedPage,
    ResearchOutput, ResearchRequest, Researcher,
};
use pumper_core::error::{Error as PumperError, Result as PumperResult};
use pumper_core::extract::{extract_one, RuleSet};
use pumper_core::fetcher::{FetchRequest, FetchStrategy, Fetcher};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::db::DbPool;

/// `pumper_core::HttpClient` backed by Personas' SSRF-safe reqwest client.
struct SsrfSafeHttpClient {
    client: reqwest::Client,
}

#[async_trait]
impl HttpClient for SsrfSafeHttpClient {
    async fn fetch(&self, req: HttpRequest) -> PumperResult<HttpResponse> {
        let method = match req.method {
            HttpMethod::Post => reqwest::Method::POST,
            HttpMethod::Get => reqwest::Method::GET,
        };
        let mut rb = self.client.request(method, &req.url);
        for (k, v) in &req.headers {
            rb = rb.header(k, v);
        }
        if let Some(body) = req.body {
            rb = rb.body(body);
        }
        let resp = rb
            .send()
            .await
            .map_err(|e| PumperError::Http(e.to_string()))?;
        let status = resp.status().as_u16();
        let final_url = resp.url().to_string();
        let headers = resp
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body = resp
            .text()
            .await
            .map_err(|e| PumperError::Http(e.to_string()))?;
        Ok(HttpResponse {
            status,
            headers,
            body,
            final_url,
        })
    }
}

/// Browser tier not compiled in the base scraper build (no Chrome dependency).
struct DisabledBrowser;

#[async_trait]
impl Browser for DisabledBrowser {
    async fn render(&self, _req: RenderRequest) -> PumperResult<RenderedPage> {
        Err(PumperError::Browser(
            "browser tier not enabled in this build (Phase 2)".into(),
        ))
    }
}

/// Claude research tier deferred to a later phase.
struct DisabledResearcher;

#[async_trait]
impl Researcher for DisabledResearcher {
    async fn research(&self, _req: ResearchRequest) -> PumperResult<ResearchOutput> {
        Err(PumperError::Claude(
            "claude scrape tier not enabled in this build (Phase 1)".into(),
        ))
    }
}

fn fetcher() -> Fetcher {
    let http = Arc::new(SsrfSafeHttpClient {
        client: crate::engine::url_safety::build_ssrf_safe_client(Duration::from_secs(30)),
    });
    Fetcher::new(http, Arc::new(DisabledBrowser), Arc::new(DisabledResearcher))
}

/// Fetch a URL and return its main content as clean Markdown.
///
/// Phase 0: HTTP tier only (never escalates to browser/claude), SSRF-safe. This
/// is the primitive the `fetch_readable` MCP tool + `scraper_fetch_readable`
/// Tauri command call.
pub async fn fetch_readable(url: &str) -> Result<String, String> {
    let req = FetchRequest {
        strategy: FetchStrategy::Http,
        to_markdown: true,
        ..FetchRequest::new(url)
    };
    let outcome = fetcher().fetch(req).await.map_err(|e| e.to_string())?;
    outcome
        .markdown
        .filter(|m| !m.trim().is_empty())
        .ok_or_else(|| "no readable content extracted".to_string())
}

// ---------------------------------------------------------------------------
// Declarative extract + change-detected datasets (Phase 1)
// ---------------------------------------------------------------------------

/// New / Changed / Unchanged — mirrors pumper-core's `ChangeKind` (which lives
/// behind the storage feature we don't compile). Drives "act only on diffs".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    New,
    Changed,
    Unchanged,
}

impl ChangeKind {
    fn label(self) -> &'static str {
        match self {
            ChangeKind::New => "new",
            ChangeKind::Changed => "changed",
            ChangeKind::Unchanged => "unchanged",
        }
    }
}

/// A declarative scrape: fetch each URL, apply `rules` (CSS / regex / JSON-pointer
/// per pumper-core's extract engine), and upsert the extracted record into a
/// change-detected dataset keyed by `key_field` (falls back to the URL).
#[derive(Debug, Deserialize)]
pub struct ExtractConfig {
    pub urls: Vec<String>,
    pub rules: RuleSet,
    pub dataset: String,
    #[serde(default)]
    pub key_field: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractSummary {
    pub dataset: String,
    pub scanned: usize,
    pub new: usize,
    pub changed: usize,
    pub unchanged: usize,
    pub errors: Vec<String>,
    /// The extracted records (each annotated with `_key` + `_change`).
    pub records: Vec<Value>,
}

fn content_hash(v: &Value) -> String {
    let mut h = Sha256::new();
    h.update(v.to_string().as_bytes());
    hex::encode(h.finalize())
}

/// Upsert one record into a scraper dataset, reporting new/changed/unchanged by
/// content hash. Rusqlite mirror of pumper-core's `Datasets::upsert` (no sqlx).
pub fn upsert_record(
    pool: &DbPool,
    dataset: &str,
    key: &str,
    data: &Value,
) -> Result<ChangeKind, String> {
    let hash = content_hash(data);
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get().map_err(|e| e.to_string())?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT content_hash FROM scraper_records WHERE dataset = ?1 AND key = ?2",
            rusqlite::params![dataset, key],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match existing {
        Some(prev) if prev == hash => {
            conn.execute(
                "UPDATE scraper_records SET last_seen = ?3 WHERE dataset = ?1 AND key = ?2",
                rusqlite::params![dataset, key, now],
            )
            .map_err(|e| e.to_string())?;
            Ok(ChangeKind::Unchanged)
        }
        Some(_) => {
            conn.execute(
                "UPDATE scraper_records SET data = ?3, content_hash = ?4, last_seen = ?5, \
                 updated_at = ?5 WHERE dataset = ?1 AND key = ?2",
                rusqlite::params![dataset, key, data.to_string(), hash, now],
            )
            .map_err(|e| e.to_string())?;
            Ok(ChangeKind::Changed)
        }
        None => {
            conn.execute(
                "INSERT INTO scraper_records
                 (dataset, key, data, content_hash, first_seen, last_seen, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)",
                rusqlite::params![dataset, key, data.to_string(), hash, now],
            )
            .map_err(|e| e.to_string())?;
            Ok(ChangeKind::New)
        }
    }
}

/// Run a declarative extract over the config's URLs, upserting change-detected
/// records into its dataset. HTTP tier only (SSRF-safe), Phase 1.
pub async fn run_extract(pool: &DbPool, cfg: ExtractConfig) -> Result<ExtractSummary, String> {
    let compiled = cfg.rules.compile().map_err(|e| e.to_string())?;
    let f = fetcher();
    let mut sum = ExtractSummary {
        dataset: cfg.dataset.clone(),
        ..Default::default()
    };
    for url in &cfg.urls {
        sum.scanned += 1;
        let req = FetchRequest {
            strategy: FetchStrategy::Http,
            ..FetchRequest::new(url)
        };
        let outcome = match f.fetch(req).await {
            Ok(o) => o,
            Err(e) => {
                sum.errors.push(format!("{url}: {e}"));
                continue;
            }
        };
        let doc = outcome.html.unwrap_or_default();
        let record = extract_one(&compiled, &doc);
        let key = cfg
            .key_field
            .as_ref()
            .and_then(|kf| record.get(kf).and_then(Value::as_str).map(String::from))
            .unwrap_or_else(|| url.clone());
        match upsert_record(pool, &cfg.dataset, &key, &record) {
            Ok(kind) => {
                match kind {
                    ChangeKind::New => sum.new += 1,
                    ChangeKind::Changed => sum.changed += 1,
                    ChangeKind::Unchanged => sum.unchanged += 1,
                }
                let mut r = record;
                if let Some(obj) = r.as_object_mut() {
                    obj.insert("_key".into(), Value::String(key));
                    obj.insert("_change".into(), Value::String(kind.label().into()));
                }
                sum.records.push(r);
            }
            Err(e) => sum.errors.push(format!("{key}: {e}")),
        }
    }
    Ok(sum)
}

/// Read records back from a dataset, newest first. `changed_only` returns only
/// records whose content has ever changed since first seen.
pub fn query_dataset(
    pool: &DbPool,
    dataset: &str,
    limit: i64,
    changed_only: bool,
) -> Result<Vec<Value>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let sql = if changed_only {
        "SELECT key, data, first_seen, last_seen, updated_at FROM scraper_records
         WHERE dataset = ?1 AND updated_at != first_seen ORDER BY updated_at DESC LIMIT ?2"
    } else {
        "SELECT key, data, first_seen, last_seen, updated_at FROM scraper_records
         WHERE dataset = ?1 ORDER BY updated_at DESC LIMIT ?2"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![dataset, limit], |r| {
            let key: String = r.get(0)?;
            let data: String = r.get(1)?;
            Ok(serde_json::json!({
                "key": key,
                "data": serde_json::from_str::<Value>(&data).unwrap_or(Value::String(data)),
                "firstSeen": r.get::<_, String>(2)?,
                "lastSeen": r.get::<_, String>(3)?,
                "updatedAt": r.get::<_, String>(4)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|x| x.ok()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end proof of the embedding: pumper-core Fetcher + Personas'
    /// SSRF-safe client + HTML→Markdown against a live URL. Network-gated —
    /// run explicitly: `cargo test --features scraper --ignored fetch_readable_live`.
    /// Change-detection core (no network): New → Unchanged → Changed, and the
    /// dataset query + changed_only filter.
    #[test]
    fn dataset_change_detection() {
        let pool = crate::db::init_test_db().unwrap();
        let d = "products";
        assert_eq!(
            upsert_record(&pool, d, "a", &serde_json::json!({ "price": 10 })).unwrap(),
            ChangeKind::New
        );
        assert_eq!(
            upsert_record(&pool, d, "a", &serde_json::json!({ "price": 10 })).unwrap(),
            ChangeKind::Unchanged
        );
        assert_eq!(
            upsert_record(&pool, d, "a", &serde_json::json!({ "price": 12 })).unwrap(),
            ChangeKind::Changed
        );
        // A distinct key is New and stays out of the changed_only view.
        assert_eq!(
            upsert_record(&pool, d, "b", &serde_json::json!({ "price": 5 })).unwrap(),
            ChangeKind::New
        );

        let all = query_dataset(&pool, d, 100, false).unwrap();
        assert_eq!(all.len(), 2);
        let a = all.iter().find(|r| r["key"] == "a").unwrap();
        assert_eq!(a["data"]["price"], 12);

        let changed = query_dataset(&pool, d, 100, true).unwrap();
        assert_eq!(changed.len(), 1, "only 'a' changed since first seen");
        assert_eq!(changed[0]["key"], "a");
    }

    #[tokio::test]
    #[ignore = "network"]
    async fn fetch_readable_live() {
        let md = fetch_readable("https://example.com")
            .await
            .expect("fetch_readable should return markdown");
        assert!(
            md.to_lowercase().contains("example"),
            "expected 'example' in extracted markdown, got: {md:.200}"
        );
    }
}
