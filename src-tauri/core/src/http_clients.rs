//! Process-wide shared `reqwest` clients.
//!
//! Moved out of `lib.rs` in crate-split step 5. `reqwest::Client` is `Arc`-backed,
//! so cloning is cheap and every clone shares one connection pool, TLS session
//! cache and DNS cache — which is the whole point of having exactly one of each.
//! Eleven call sites across the engine used them, and a `LazyLock` at the crate
//! root is reachable from nowhere below it.
//!
//! They sit beside [`crate::url_safety`], which builds the SSRF-safe variant.

use std::sync::LazyLock;
use std::time::Duration;

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// Shared HTTP client for all general-purpose HTTP callsites.
pub static SHARED_HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .expect("Failed to build shared HTTP client")
});

/// HTTP client with an SSRF-safe DNS resolver that rejects private/internal IPs
/// at connection time. Used by the API proxy and any other path where the target
/// URL is influenced by user-supplied credential data.
pub static SSRF_SAFE_HTTP: LazyLock<reqwest::Client> =
    LazyLock::new(|| crate::url_safety::build_ssrf_safe_client(HTTP_TIMEOUT));

/// HTTP client WITHOUT the SSRF-safe DNS resolver — it can reach private/loopback
/// targets by design. Used ONLY for connector requests whose connector metadata
/// declares `allow_private_network: true` (inherently self-hosted tools such as a
/// local LightTrack or a self-hosted Langfuse/LangSmith). The API proxy gates this
/// strictly behind that flag; every other path keeps using [`SSRF_SAFE_HTTP`].
///
/// SECURITY: routing an untrusted / non-allow-private request through this client
/// re-opens the SSRF hole [`SSRF_SAFE_HTTP`] closes. Only the flag-gated branch in
/// `engine::api_proxy::execute_api_request` may use it.
pub static HTTP_ALLOW_PRIVATE: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .expect("Failed to build allow-private HTTP client")
});
