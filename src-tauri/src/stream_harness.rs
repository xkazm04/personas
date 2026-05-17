//! Phase 1 diagnostic: `stream-test://` URI scheme handler.
//!
//! Validates whether Tauri's custom-protocol path delivers a large response
//! body incrementally (streaming) or all-at-once (buffered) — the question
//! that gates `idea-7452b77e-custom-tauri-protocol-for-bina` phases 2–4.
//!
//! Static analysis of Tauri 2.10.3 + Wry 0.54.3 shows
//! `UriSchemeResponder::respond` accepts a single `http::Response<Cow<'static,
//! [u8]>>` via `FnOnce` — i.e. the public API has no incremental write
//! surface. This harness confirms end-to-end whether the WebView's URL loader
//! still hands chunked reads to a JS `getReader()`, which would partially
//! preserve the perf model, or buffers the whole body until the handler
//! completes.
//!
//! Wire format (per chunk in the response body):
//!   [4 bytes big-endian]  length of remainder of this chunk
//!   [8 bytes big-endian]  micros since handler start at write time
//!   [4 bytes big-endian]  chunk index
//!   [N bytes]             payload (filled with `b'X'`)
//!
//! Query params on `?...`:
//!   chunks=N         (default 200)  number of chunks emitted
//!   delay_ms=N       (default 50)   sleep between chunks
//!   bytes=N          (default 1024) payload size per chunk
//!
//! Response headers:
//!   x-stream-test-elapsed-us: total handler wall-clock at respond() time
//!
//! Gated behind `#[cfg(debug_assertions)]`; never compiled into release.

#![cfg(debug_assertions)]

use std::thread;
use std::time::{Duration, Instant};

use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

const DEFAULT_CHUNK_COUNT: u64 = 200;
const DEFAULT_PAYLOAD_BYTES: u64 = 1024;
const DEFAULT_DELAY_MS: u64 = 50;
const MAX_CHUNK_COUNT: u64 = 5_000;
const MAX_PAYLOAD_BYTES: u64 = 64 * 1024;
const MAX_DELAY_MS: u64 = 500;

fn write_chunk(buf: &mut Vec<u8>, start: Instant, index: u32, payload_bytes: usize) {
    let elapsed_us = (start.elapsed().as_micros() as u64).to_be_bytes();
    let body_len = (8 + 4 + payload_bytes) as u32;
    buf.extend_from_slice(&body_len.to_be_bytes());
    buf.extend_from_slice(&elapsed_us);
    buf.extend_from_slice(&index.to_be_bytes());
    let payload_start = buf.len();
    buf.resize(payload_start + payload_bytes, b'X');
}

fn parse_query_u64(query: &str, key: &str) -> Option<u64> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (it.next(), it.next()) {
            if k == key {
                return v.parse().ok();
            }
        }
    }
    None
}

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let query = request.uri().query().unwrap_or("").to_string();

    thread::spawn(move || {
        let chunks = parse_query_u64(&query, "chunks")
            .unwrap_or(DEFAULT_CHUNK_COUNT)
            .min(MAX_CHUNK_COUNT) as usize;
        let payload_bytes = parse_query_u64(&query, "bytes")
            .unwrap_or(DEFAULT_PAYLOAD_BYTES)
            .min(MAX_PAYLOAD_BYTES) as usize;
        let delay_ms = parse_query_u64(&query, "delay_ms")
            .unwrap_or(DEFAULT_DELAY_MS)
            .min(MAX_DELAY_MS);

        let start = Instant::now();
        tracing::info!(
            chunks,
            payload_bytes,
            delay_ms,
            "stream-test: handler start"
        );

        // 4 (length) + 8 (timestamp) + 4 (index) + payload
        let chunk_total = 4 + 8 + 4 + payload_bytes;
        let mut body: Vec<u8> = Vec::with_capacity(chunks * chunk_total);

        for i in 0..chunks {
            write_chunk(&mut body, start, i as u32, payload_bytes);
            if delay_ms > 0 && i + 1 < chunks {
                thread::sleep(Duration::from_millis(delay_ms));
            }
        }

        let elapsed_us = start.elapsed().as_micros() as u64;
        tracing::info!(
            elapsed_us,
            body_len = body.len(),
            "stream-test: handler responding"
        );

        let response = tauri::http::Response::builder()
            .status(200)
            .header("content-type", "application/octet-stream")
            .header("cache-control", "no-store")
            .header("x-stream-test-elapsed-us", elapsed_us.to_string())
            .header("access-control-allow-origin", "*")
            .body(body)
            .expect("response builder cannot fail");
        responder.respond(response);
    });
}
