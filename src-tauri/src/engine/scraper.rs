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
use pumper_core::fetcher::{FetchRequest, FetchStrategy, Fetcher};

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

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end proof of the embedding: pumper-core Fetcher + Personas'
    /// SSRF-safe client + HTML→Markdown against a live URL. Network-gated —
    /// run explicitly: `cargo test --features scraper --ignored fetch_readable_live`.
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
