//! Pure policy for the inbound webhook paths: the local `/webhook/{id}`
//! server, the smee.io SSE relay and the cloud firing relay.
//!
//! The I/O for all three lives in the app crate (`src/engine/webhook.rs`,
//! `smee_relay.rs`, `cloud_webhook_relay.rs`), which cannot run its unit
//! tests on Windows. The decisions they make about bytes, headers and
//! de-duplication do not need an `AppHandle`, so they live here, where a
//! regression is a red `cargo test -p personas-engine webhook_ingest`.

// ---------------------------------------------------------------------------
// Request-log header redaction
// ---------------------------------------------------------------------------

/// Value written to the request log in place of a credential-bearing header.
pub const REDACTED_HEADER_VALUE: &str = "[redacted]";

/// Substrings that mark a header as credential-bearing. `x-gitlab-token`
/// carries GitLab's webhook secret in plaintext, `authorization` /
/// `cookie` / `x-api-key` carry bearer credentials, and a signature header
/// paired with the stored payload is enough to replay a delivery.
const SENSITIVE_HEADER_MARKERS: &[&str] = &[
    "authorization",
    "cookie",
    "token",
    "secret",
    "signature",
    "password",
    "api-key",
    "apikey",
    "auth",
];

/// True when a header's value must never reach the plaintext request log.
pub fn is_sensitive_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    SENSITIVE_HEADER_MARKERS.iter().any(|m| lower.contains(m))
}

/// Serialize request headers for the request log, keeping every header NAME
/// (so the inspector still shows which signature scheme a sender used) and
/// replacing credential-bearing VALUES with [`REDACTED_HEADER_VALUE`]. A value
/// that is not visible ASCII is logged as `<binary>`.
pub fn headers_for_log<'a, I>(headers: I) -> String
where
    I: IntoIterator<Item = (&'a str, Option<&'a str>)>,
{
    let map: serde_json::Map<String, serde_json::Value> = headers
        .into_iter()
        .map(|(name, value)| {
            let logged = if is_sensitive_header(name) {
                REDACTED_HEADER_VALUE
            } else {
                value.unwrap_or("<binary>")
            };
            (
                name.to_string(),
                serde_json::Value::String(logged.to_string()),
            )
        })
        .collect();
    serde_json::Value::Object(map).to_string()
}

// ---------------------------------------------------------------------------
// SSE decoding (smee.io relay)
// ---------------------------------------------------------------------------

/// One dispatched SSE message: the joined `data:` lines and the `id:` field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseMessage {
    pub id: Option<String>,
    /// `None` when the message carried no `data:` line at all.
    pub data: Option<String>,
}

/// Incremental SSE decoder over raw network chunks.
///
/// Buffers BYTES, not text: a network chunk can end inside a multi-byte
/// UTF-8 character or between the `\r` and `\n` of one line terminator, and
/// decoding or normalising per chunk turns the first into U+FFFD (which also
/// breaks any HMAC over the body) and the second into a spurious blank line
/// that dispatches half a message. Lines are decoded only once complete;
/// `\r`, `\n` and `\r\n` all terminate a line (SSE spec).
#[derive(Debug, Default)]
pub struct SseDecoder {
    buf: Vec<u8>,
    data_lines: Vec<String>,
    id: Option<String>,
    saw_field: bool,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bytes held that do not yet form a complete message: the partial line
    /// plus the `data:` lines collected since the last dispatch. A stream
    /// that never sends the blank line grows this, so it is what a caller
    /// caps.
    pub fn pending_bytes(&self) -> usize {
        self.buf.len() + self.data_lines.iter().map(String::len).sum::<usize>()
    }

    /// Feed one network chunk; returns every message it completed.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseMessage> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        let mut start = 0usize;
        let mut i = 0usize;
        while i < self.buf.len() {
            let b = self.buf[i];
            if b == b'\n' || b == b'\r' {
                // A `\r` that ends the buffer may be the first half of `\r\n`:
                // wait for the next chunk before deciding.
                if b == b'\r' && i + 1 == self.buf.len() {
                    break;
                }
                let line = String::from_utf8_lossy(&self.buf[start..i]).into_owned();
                let term_len = if b == b'\r' && self.buf[i + 1] == b'\n' {
                    2
                } else {
                    1
                };
                i += term_len;
                start = i;
                if let Some(msg) = self.take_line(&line) {
                    out.push(msg);
                }
                continue;
            }
            i += 1;
        }
        self.buf.drain(..start);
        out
    }

    fn take_line(&mut self, line: &str) -> Option<SseMessage> {
        if line.is_empty() {
            if !self.saw_field {
                return None;
            }
            self.saw_field = false;
            let data = if self.data_lines.is_empty() {
                None
            } else {
                Some(std::mem::take(&mut self.data_lines).join("\n"))
            };
            return Some(SseMessage {
                id: self.id.take(),
                data,
            });
        }
        if line.starts_with(':') {
            return None; // comment / keep-alive
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "data" => {
                self.saw_field = true;
                self.data_lines.push(value.to_string());
            }
            "id" => {
                self.saw_field = true;
                let trimmed = value.trim();
                if !trimmed.is_empty() && !trimmed.contains('\0') {
                    self.id = Some(trimmed.to_string());
                }
            }
            _ => {
                self.saw_field = true;
            }
        }
        None
    }
}

// ---------------------------------------------------------------------------
// Cloud firing relay watermarks
// ---------------------------------------------------------------------------

/// Whether a relay tick may prune watermarks of triggers it did not see.
///
/// A trigger is "not seen" both when it was deleted and when its
/// deployment's trigger listing failed (a 10 s per-call timeout is enough).
/// Pruning on the second loses the watermark, and the next tick republishes
/// every firing on the page (up to the fetch limit) as new events. Only a
/// tick whose listing was complete can tell the two apart.
pub fn watermark_prune_allowed(listing_failures: usize) -> bool {
    listing_failures == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_headers_are_redacted_and_routing_headers_kept() {
        let logged = headers_for_log([
            ("x-gitlab-token", Some("glsecret-123")),
            ("authorization", Some("Bearer abc")),
            ("Cookie", Some("sid=1")),
            ("x-api-key", Some("k-1")),
            ("x-hub-signature-256", Some("sha256=00ff")),
            ("x-webhook-signature", Some("00ff")),
            ("proxy-authorization", Some("Basic x")),
            ("content-type", Some("application/json")),
            ("user-agent", Some("GitHub-Hookshot/1")),
            ("x-github-event", Some("push")),
            ("x-github-delivery", Some("d-1")),
            ("x-odd", None),
        ]);
        let v: serde_json::Value = serde_json::from_str(&logged).unwrap();
        for leaked in [
            "glsecret-123",
            "Bearer abc",
            "sid=1",
            "k-1",
            "sha256=00ff",
            "Basic x",
        ] {
            assert!(
                !logged.contains(leaked),
                "{leaked} reached the log: {logged}"
            );
        }
        assert_eq!(v["x-gitlab-token"], REDACTED_HEADER_VALUE);
        assert_eq!(v["x-webhook-signature"], REDACTED_HEADER_VALUE);
        assert_eq!(v["content-type"], "application/json");
        assert_eq!(v["x-github-event"], "push");
        assert_eq!(v["x-github-delivery"], "d-1");
        assert_eq!(v["x-odd"], "<binary>");
    }

    fn feed(chunks: &[&[u8]]) -> Vec<SseMessage> {
        let mut d = SseDecoder::new();
        chunks.iter().flat_map(|c| d.push(c)).collect()
    }

    #[test]
    fn multibyte_char_split_across_chunks_survives() {
        let wire = "id: 7\ndata: {\"msg\":\"oprava čárky 🚀\"}\n\n".as_bytes();
        // Split inside the 4-byte emoji and inside the 2-byte č.
        let emoji_at = wire.windows(4).position(|w| w == "🚀".as_bytes()).unwrap();
        let c_at = wire.windows(2).position(|w| w == "č".as_bytes()).unwrap();
        let msgs = feed(&[
            &wire[..c_at + 1],
            &wire[c_at + 1..emoji_at + 2],
            &wire[emoji_at + 2..],
        ]);
        assert_eq!(
            msgs,
            vec![SseMessage {
                id: Some("7".into()),
                data: Some("{\"msg\":\"oprava čárky 🚀\"}".into()),
            }]
        );
    }

    #[test]
    fn crlf_split_across_chunks_is_one_terminator() {
        // `\r` ends chunk one and `\n` starts chunk two: one line end, not two.
        let msgs = feed(&[b"data: a\r", b"\ndata: b\r\n\r\n"]);
        assert_eq!(msgs.len(), 1, "{msgs:?}");
        assert_eq!(msgs[0].data.as_deref(), Some("a\nb"));
    }

    #[test]
    fn cr_lf_and_crlf_all_terminate_and_comments_are_skipped() {
        let msgs = feed(&[b": ping\n\ndata:x\r\rid:9\ndata: y\r\n\r\n"]);
        assert_eq!(
            msgs,
            vec![
                SseMessage {
                    id: None,
                    data: Some("x".into())
                },
                SseMessage {
                    id: Some("9".into()),
                    data: Some("y".into())
                },
            ]
        );
    }

    #[test]
    fn incomplete_tail_stays_pending() {
        let mut d = SseDecoder::new();
        assert!(d.push(b"data: {\"a\":").is_empty());
        assert_eq!(d.pending_bytes(), 11);
        let msgs = d.push(b"1}\n\n");
        assert_eq!(msgs[0].data.as_deref(), Some("{\"a\":1}"));
        assert_eq!(d.pending_bytes(), 0);
        // Complete lines without the dispatching blank line still count.
        assert!(d.push(b"data: abc\ndata: de\n").is_empty());
        assert_eq!(d.pending_bytes(), 5);
    }

    #[test]
    fn a_failed_listing_blocks_the_watermark_prune() {
        assert!(watermark_prune_allowed(0));
        assert!(!watermark_prune_allowed(1));
        assert!(!watermark_prune_allowed(7));
    }
}
