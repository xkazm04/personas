//! SSRF-safe DNS resolver for reqwest.
//!
//! Wraps the system DNS resolver and rejects resolved IP addresses that fall
//! into private, loopback, link-local, or cloud-metadata ranges.  This blocks
//! DNS rebinding attacks where a domain initially resolves to a public IP
//! (passing URL-level validation) then re-resolves to an internal IP at
//! connection time.

use std::net::SocketAddr;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

use super::healthcheck::is_private_ip;

/// A DNS resolver that filters out private/internal IP addresses after
/// resolution, preventing SSRF via DNS rebinding.
pub(crate) struct SsrfSafeDnsResolver;

impl Resolve for SsrfSafeDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();

            // Use tokio's built-in async DNS resolution.
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host(format!("{host}:0"))
                .await
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                    Box::new(e)
                })?
                .collect();

            // Filter out any addresses in private/internal ranges.
            let safe_addrs: Vec<SocketAddr> = addrs
                .into_iter()
                .filter(|sa| !is_private_ip(&sa.ip()))
                .collect();

            if safe_addrs.is_empty() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!(
                        "DNS resolution for '{host}' yielded only private/internal IP addresses. \
                         This may indicate a DNS rebinding attack."
                    ),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            }

            let addrs: Addrs = Box::new(safe_addrs.into_iter());
            Ok(addrs)
        })
    }
}

/// Build a reqwest client that uses the SSRF-safe DNS resolver.
///
/// This client should be used for any outbound request where the destination
/// URL is influenced by user-supplied data (e.g., credential `base_url`).
pub(crate) fn build_ssrf_safe_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .dns_resolver(std::sync::Arc::new(SsrfSafeDnsResolver))
        .build()
        .expect("Failed to build SSRF-safe HTTP client")
}
