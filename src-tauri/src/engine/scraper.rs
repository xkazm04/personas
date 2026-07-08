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

/// Fetch a URL and return the raw HTML truncated to `max_chars` — used to
/// ground the LLM pipeline builder in the real page structure (Phase 1b-2).
pub async fn fetch_html_snippet(url: &str, max_chars: usize) -> Result<String, String> {
    let f = fetcher();
    let req = FetchRequest {
        strategy: FetchStrategy::Http,
        ..FetchRequest::new(url)
    };
    let outcome = f.fetch(req).await.map_err(|e| e.to_string())?;
    let html = outcome.html.unwrap_or_default();
    Ok(html.chars().take(max_chars).collect())
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

/// Per-dataset rollup for the UI: name, record count, last update.
pub fn dataset_summaries(pool: &DbPool) -> Result<Vec<Value>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT dataset, COUNT(*) AS n, MAX(updated_at) AS last
             FROM scraper_records GROUP BY dataset ORDER BY last DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "name": r.get::<_, String>(0)?,
                "count": r.get::<_, i64>(1)?,
                "lastUpdated": r.get::<_, Option<String>>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ---------------------------------------------------------------------------
// Saved scrape configs + scheduling (Phase 1b)
// ---------------------------------------------------------------------------

/// A persisted, optionally cron-scheduled declarative scrape.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScraperConfig {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub urls: Vec<String>,
    pub rules: Value,
    pub dataset: String,
    pub key_field: Option<String>,
    pub cron: Option<String>,
    pub enabled: bool,
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub last_status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_config(row: &rusqlite::Row) -> rusqlite::Result<ScraperConfig> {
    let urls_s: String = row.get("urls")?;
    let rules_s: String = row.get("rules")?;
    Ok(ScraperConfig {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        urls: serde_json::from_str(&urls_s).unwrap_or_default(),
        rules: serde_json::from_str(&rules_s).unwrap_or(Value::Null),
        dataset: row.get("dataset")?,
        key_field: row.get("key_field")?,
        cron: row.get("cron")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        next_run_at: row.get("next_run_at")?,
        last_run_at: row.get("last_run_at")?,
        last_status: row.get("last_status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Next fire time for a cron expression as an RFC3339 string (None if invalid /
/// no upcoming fire). Cron is evaluated in UTC by `engine::cron`.
fn compute_next_run(cron: &str) -> Option<String> {
    let sched = crate::engine::cron::parse_cron(cron).ok()?;
    crate::engine::cron::next_fire_time(&sched, chrono::Utc::now()).map(|t| t.to_rfc3339())
}

/// Create or update a saved scrape config (upsert by `id`; generates one if
/// absent). Validates the cron + rules before persisting.
pub fn config_save(pool: &DbPool, input: &Value) -> Result<ScraperConfig, String> {
    let name = input.get("name").and_then(Value::as_str).ok_or("missing 'name'")?.to_string();
    let description = input
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);
    let urls = input.get("urls").cloned().filter(Value::is_array).ok_or("missing 'urls' array")?;
    let rules = input.get("rules").cloned().filter(Value::is_object).ok_or("missing 'rules' object")?;
    let dataset = input.get("dataset").and_then(Value::as_str).ok_or("missing 'dataset'")?.to_string();
    let key_field = input.get("key_field").and_then(Value::as_str).map(String::from);
    let cron = input
        .get("cron")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(String::from);
    let enabled = input.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    if let Some(c) = &cron {
        crate::engine::cron::parse_cron(c).map_err(|e| format!("invalid cron: {e}"))?;
    }
    let _: RuleSet = serde_json::from_value(rules.clone()).map_err(|e| format!("invalid rules: {e}"))?;
    let next_run = if enabled { cron.as_deref().and_then(compute_next_run) } else { None };
    let now = chrono::Utc::now().to_rfc3339();
    let id = input
        .get("id")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO scraper_configs
         (id, name, description, urls, rules, dataset, key_field, cron, enabled, next_run_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
         ON CONFLICT(id) DO UPDATE SET name=?2, description=?3, urls=?4, rules=?5, dataset=?6,
             key_field=?7, cron=?8, enabled=?9, next_run_at=?10, updated_at=?11",
        rusqlite::params![
            id, name, description, urls.to_string(), rules.to_string(), dataset, key_field, cron,
            enabled as i64, next_run, now
        ],
    )
    .map_err(|e| e.to_string())?;
    config_get(pool, &id)?.ok_or_else(|| "config not found after save".to_string())
}

pub fn config_get(pool: &DbPool, id: &str) -> Result<Option<ScraperConfig>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT * FROM scraper_configs WHERE id = ?1",
        rusqlite::params![id],
        row_to_config,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn config_list(pool: &DbPool) -> Result<Vec<ScraperConfig>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM scraper_configs ORDER BY name ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_config)
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn config_delete(pool: &DbPool, id: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM scraper_configs WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn mark_run(pool: &DbPool, id: &str, status: &str, next_run: Option<&str>) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE scraper_configs SET last_run_at = ?2, last_status = ?3, next_run_at = ?4 WHERE id = ?1",
        rusqlite::params![id, now, status, next_run],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Run a saved config now: load → run_extract → stamp last_run/status and the
/// next scheduled fire.
pub async fn config_run(pool: &DbPool, id: &str) -> Result<ExtractSummary, String> {
    let cfg = config_get(pool, id)?.ok_or_else(|| format!("scrape config {id} not found"))?;
    let rules: RuleSet =
        serde_json::from_value(cfg.rules.clone()).map_err(|e| format!("bad rules: {e}"))?;
    let ecfg = ExtractConfig {
        urls: cfg.urls.clone(),
        rules,
        dataset: cfg.dataset.clone(),
        key_field: cfg.key_field.clone(),
    };
    let result = run_extract(pool, ecfg).await;
    let next = if cfg.enabled {
        cfg.cron.as_deref().and_then(compute_next_run)
    } else {
        None
    };
    let status = match &result {
        Ok(s) => format!(
            "ok — {} new, {} changed, {} unchanged, {} error(s)",
            s.new,
            s.changed,
            s.unchanged,
            s.errors.len()
        ),
        Err(e) => format!("error — {e}"),
    };
    let _ = mark_run(pool, id, &status, next.as_deref());
    result
}

/// Ids of enabled, cron-scheduled configs whose next fire is due (<= now).
fn list_due(pool: &DbPool) -> Result<Vec<String>, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id FROM scraper_configs
             WHERE enabled = 1 AND cron IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![now], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Scheduler tick: run every due config. Called by ScraperScheduleSubscription.
pub async fn scraper_schedule_tick(pool: &DbPool) {
    let due = match list_due(pool) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("scraper scheduler: list_due failed: {e}");
            return;
        }
    };
    for id in due {
        if let Err(e) = config_run(pool, &id).await {
            tracing::warn!(config_id = %id, "scraper scheduled run failed: {e}");
        }
    }
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

    /// Saved-config CRUD + cron-driven next-run computation + upsert-by-id.
    #[test]
    fn scrape_config_crud_and_schedule() {
        let pool = crate::db::init_test_db().unwrap();
        let saved = config_save(
            &pool,
            &serde_json::json!({
                "name": "t",
                "urls": ["https://example.com"],
                "rules": { "h": { "type": "css", "selector": "h1" } },
                "dataset": "d",
                "cron": "* * * * *"
            }),
        )
        .unwrap();
        assert!(!saved.id.is_empty());
        assert!(saved.enabled);
        assert!(saved.next_run_at.is_some(), "cron should compute a next run");
        assert_eq!(config_list(&pool).unwrap().len(), 1);

        // Upsert by id → disable clears the schedule.
        let updated = config_save(
            &pool,
            &serde_json::json!({
                "id": saved.id,
                "name": "t",
                "urls": ["https://example.com"],
                "rules": { "h": { "type": "css", "selector": "h1" } },
                "dataset": "d",
                "enabled": false
            }),
        )
        .unwrap();
        assert!(!updated.enabled);
        assert!(updated.next_run_at.is_none());
        assert_eq!(config_list(&pool).unwrap().len(), 1, "upsert, not insert");

        // Invalid cron / rules are rejected.
        assert!(config_save(
            &pool,
            &serde_json::json!({ "name":"x","urls":["u"],"rules":{"h":{"type":"css","selector":"h1"}},"dataset":"d","cron":"nope" })
        )
        .is_err());

        config_delete(&pool, &saved.id).unwrap();
        assert_eq!(config_list(&pool).unwrap().len(), 0);
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
