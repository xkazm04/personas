//! URL safety checks to prevent SSRF (Server-Side Request Forgery).
//!
//! Validates that outbound HTTP requests target external hosts only,
//! blocking loopback, private RFC 1918, link-local, and metadata endpoints.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};

/// Check whether an IP address is in a private, loopback, or link-local range
/// that should not be reachable from outbound HTTP requests.
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()              // 127.0.0.0/8
            || v4.is_private()            // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
            || v4.is_link_local()         // 169.254.0.0/16
            || v4.is_unspecified()        // 0.0.0.0
            || v4.is_broadcast()          // 255.255.255.255
            || is_v4_shared(v4)           // 100.64.0.0/10 (CGN / shared)
            || is_v4_documentation(v4)    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
            || is_cloud_metadata(v4)      // 169.254.169.254 specifically
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()              // ::1
            || v6.is_unspecified()        // ::
            || is_v6_link_local(v6)       // fe80::/10
            || is_v6_unique_local(v6)     // fc00::/7
            // Check if it's a v4-mapped v6 address with a private v4
            || v6.to_ipv4_mapped().map(|v4| is_private_ip(IpAddr::V4(v4))).unwrap_or(false)
        }
    }
}

fn is_v4_shared(ip: Ipv4Addr) -> bool {
    // 100.64.0.0/10 — Carrier-grade NAT (RFC 6598)
    let octets = ip.octets();
    octets[0] == 100 && (octets[1] & 0xC0) == 64
}

fn is_v4_documentation(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    // 192.0.2.0/24 (TEST-NET-1)
    (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
    // 198.51.100.0/24 (TEST-NET-2)
    || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
    // 203.0.113.0/24 (TEST-NET-3)
    || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
}

fn is_cloud_metadata(ip: Ipv4Addr) -> bool {
    ip == Ipv4Addr::new(169, 254, 169, 254)
}

fn is_v6_link_local(ip: Ipv6Addr) -> bool {
    // fe80::/10
    let segments = ip.segments();
    (segments[0] & 0xFFC0) == 0xFE80
}

fn is_v6_unique_local(ip: Ipv6Addr) -> bool {
    // fc00::/7
    let segments = ip.segments();
    (segments[0] & 0xFE00) == 0xFC00
}

/// Well-known cloud metadata and internal hostnames that must be blocked
/// regardless of DNS resolution outcome.
const BLOCKED_HOSTNAMES: &[&str] = &[
    "metadata.google.internal",
    "metadata.goog",
    "169.254.169.254",
    "metadata",
];

/// Hostname suffixes that indicate internal/cloud infrastructure.
const BLOCKED_HOSTNAME_SUFFIXES: &[&str] = &[
    ".internal",
    ".local",
    ".localhost",
];

/// Returns true if the hostname matches a known cloud metadata or internal service pattern.
fn is_blocked_hostname(host: &str) -> bool {
    if BLOCKED_HOSTNAMES.contains(&host) {
        return true;
    }
    for suffix in BLOCKED_HOSTNAME_SUFFIXES {
        if host.ends_with(suffix) {
            return true;
        }
    }
    false
}

/// Validate that a URL is safe for outbound HTTP requests.
///
/// Returns `Ok(())` if the URL targets an external host, or `Err(reason)` if
/// the URL points to a private/internal address that could enable SSRF.
///
/// Performs DNS resolution to catch hostnames that resolve to private IPs
/// (e.g., `http://metadata.internal/` → 169.254.169.254).
pub fn validate_url_safety(url_str: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url_str)
        .map_err(|e| format!("Invalid URL: {e}"))?;

    // Only allow http and https schemes
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Blocked scheme '{scheme}': only http/https allowed")),
    }

    let host = parsed.host_str()
        .ok_or_else(|| "URL has no host".to_string())?;

    // Block well-known cloud metadata hostnames before DNS resolution.
    // These resolve to private IPs inside cloud environments but may fail
    // locally, which is exactly the SSRF bypass vector we need to prevent.
    let host_lower = host.to_ascii_lowercase();
    if is_blocked_hostname(&host_lower) {
        return Err(format!("Blocked cloud metadata hostname: {}", host));
    }

    // Quick check: if host is an IP literal, validate directly
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Err(format!("Blocked private/internal address: {ip}"));
        }
        return Ok(());
    }

    // Resolve hostname and check all resolved IPs
    let port = parsed.port_or_known_default().unwrap_or(80);
    let addr = format!("{host}:{port}");
    match addr.to_socket_addrs() {
        Ok(addrs) => {
            let resolved: Vec<_> = addrs.collect();
            if resolved.is_empty() {
                return Err(format!("DNS resolution failed: no addresses for {host}"));
            }
            for socket_addr in &resolved {
                if is_private_ip(socket_addr.ip()) {
                    return Err(format!(
                        "Blocked: '{}' resolves to private address {}",
                        host,
                        socket_addr.ip()
                    ));
                }
            }
            Ok(())
        }
        Err(e) => {
            // Fail-closed: if DNS resolution fails, block the request.
            // An attacker could craft hostnames (e.g. metadata.google.internal)
            // that fail local DNS but resolve within the target network.
            Err(format!("DNS resolution failed for '{}': {}", host, e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blocks_loopback() {
        assert!(validate_url_safety("http://127.0.0.1/test").is_err());
        assert!(validate_url_safety("http://127.0.0.1:9420/webhook").is_err());
    }

    #[test]
    fn test_blocks_private_rfc1918() {
        assert!(validate_url_safety("http://10.0.0.1/api").is_err());
        assert!(validate_url_safety("http://172.16.0.1/api").is_err());
        assert!(validate_url_safety("http://192.168.1.1/api").is_err());
    }

    #[test]
    fn test_blocks_link_local() {
        assert!(validate_url_safety("http://169.254.1.1/test").is_err());
    }

    #[test]
    fn test_blocks_cloud_metadata() {
        assert!(validate_url_safety("http://169.254.169.254/latest/meta-data/").is_err());
    }

    #[test]
    fn test_blocks_unspecified() {
        assert!(validate_url_safety("http://0.0.0.0/test").is_err());
    }

    #[test]
    fn test_blocks_ipv6_loopback() {
        assert!(validate_url_safety("http://[::1]/test").is_err());
    }

    #[test]
    fn test_blocks_non_http_scheme() {
        assert!(validate_url_safety("file:///etc/passwd").is_err());
        assert!(validate_url_safety("ftp://internal/data").is_err());
        assert!(validate_url_safety("gopher://evil.com/test").is_err());
    }

    #[test]
    fn test_allows_public_ip() {
        assert!(validate_url_safety("https://8.8.8.8/dns").is_ok());
        assert!(validate_url_safety("https://1.1.1.1/test").is_ok());
    }

    #[test]
    fn test_blocks_v4_mapped_v6() {
        // ::ffff:127.0.0.1
        assert!(validate_url_safety("http://[::ffff:127.0.0.1]/test").is_err());
        // ::ffff:10.0.0.1
        assert!(validate_url_safety("http://[::ffff:10.0.0.1]/test").is_err());
    }

    #[test]
    fn test_blocks_shared_cgn() {
        assert!(validate_url_safety("http://100.64.0.1/test").is_err());
        assert!(validate_url_safety("http://100.127.255.254/test").is_err());
    }

    #[test]
    fn test_allows_public_after_shared_range() {
        // 100.128.0.0 is outside the 100.64.0.0/10 range
        assert!(validate_url_safety("http://100.128.0.1/test").is_ok());
    }

    #[test]
    fn test_rejects_no_url() {
        assert!(validate_url_safety("not-a-url").is_err());
        assert!(validate_url_safety("").is_err());
    }

    #[test]
    fn test_is_private_covers_broadcast() {
        assert!(is_private_ip(IpAddr::V4(Ipv4Addr::BROADCAST)));
    }

    #[test]
    fn test_blocks_cloud_metadata_hostnames() {
        assert!(validate_url_safety("http://metadata.google.internal/computeMetadata/v1/").is_err());
        assert!(validate_url_safety("http://metadata.goog/computeMetadata/v1/").is_err());
    }

    #[test]
    fn test_blocks_internal_suffix() {
        assert!(validate_url_safety("http://anything.internal/secret").is_err());
        assert!(validate_url_safety("http://service.local/api").is_err());
        assert!(validate_url_safety("http://evil.localhost/test").is_err());
    }

    #[test]
    fn test_dns_failure_is_blocked() {
        // A hostname that won't resolve should be rejected (fail-closed)
        assert!(validate_url_safety("http://this-domain-will-never-resolve-3829482.example.test/secret").is_err());
    }
}
