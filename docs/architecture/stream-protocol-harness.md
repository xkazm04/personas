# Custom Tauri protocol streaming — Phase 1 harness

**Status:** Phase 1 diagnostic only. Phases 2–4 of
`idea-7452b77e-custom-tauri-protocol-for-bina` were descoped on 2026-05-16
pending Phase 1 measurement.

This document records (a) the static API analysis that motivated bounding
Phase 1 to a small diagnostic, (b) the harness shipped behind
`#[cfg(debug_assertions)]`, and (c) the runbook for measuring on Windows
WebView2 and macOS WKWebView.

## Premise

`idea-7452b77e` proposes replacing the per-event `dual_emit` JSON pipeline
(`engine/build_session/events.rs:80`) with a registered `stream://` custom
protocol serving length-prefixed binary chunks. The perf claim depends on
the WebView's URL loader delivering bytes to JS `fetch().body.getReader()`
**as the Rust handler writes them**, so the frontend can parse chunk N
while Rust produces chunk N+1.

## Static API analysis (Tauri 2.10.3 / Wry 0.54.3)

```
tauri::Builder::register_asynchronous_uri_scheme_protocol(
    name,
    Fn(UriSchemeContext, http::Request<Vec<u8>>, UriSchemeResponder),
)

pub struct UriSchemeResponder(Box<dyn FnOnce(http::Response<Cow<'static, [u8]>>) + Send>);

impl UriSchemeResponder {
    pub fn respond<T: Into<Cow<'static, [u8]>>>(self, response: Response<T>);
}
```

Wry's underlying `RequestAsyncResponder` has the same shape (`FnOnce`,
single `Response<Cow<'static, [u8]>>`). **There is no incremental write
API at either layer.** The Rust handler must assemble the entire body
before calling `respond()`.

This already eliminates the "produce-while-consume" perf model that
motivated the idea. The remaining open question Phase 1 must answer
empirically is whether the WebView's URL loader delivers a large
**already-assembled** body to JS in chunks (so the frontend still gets to
process chunk N while bytes N+1…N+M are in flight) or buffers it.

Even in the "delivers in chunks" case, the upper bound on overlap is the
network/IPC transfer time between Rust handing the body to Wry and JS
finishing the last `read()` — measured in single-digit milliseconds for a
hundreds-of-KB body, not the full Rust emit duration. So the perf
ceiling for any version of this refactor is bounded by transfer time, not
emit time.

## Harness

Two files, both behind dev/debug gates so nothing ships to production:

- `src-tauri/src/stream_harness.rs` (`#[cfg(debug_assertions)]`) registers
  the `stream-test://` scheme. Handler reads `chunks`, `delay_ms`,
  and `bytes` from the query string, sleeps `delay_ms` between writing
  each chunk to its in-memory buffer, then calls `responder.respond()` once
  with the full body. Each chunk carries:

  ```
  [4 bytes BE]  body length of this chunk = 12 + payload
  [8 bytes BE]  micros since handler start at write time
  [4 bytes BE]  chunk index
  [N bytes]     payload (filled with 0x58 'X')
  ```

  Total handler wall-clock is returned in the
  `x-stream-test-elapsed-us` response header.

- `src/lib/devTools/streamHarness.ts` is imported from `main.tsx` only when
  `import.meta.env.DEV` is true. It attaches `window.__streamHarness` to
  the global window object and exposes `runStreamHarness({chunks, delayMs,
  bytes})`. It fetches via the platform-appropriate scheme origin (Wry's
  rules — see [Origin rules](#origin-rules) below), records the
  `performance.now()` timestamp at each `getReader().read()` resolution,
  and classifies the result:

  | Verdict | Condition |
  |---|---|
  | `streaming` | First reader yield arrives ≥ 200ms *before* the Rust handler finished |
  | `buffered`  | First reader yield arrives ≤ 100ms before handler end **and** all reads span < 100ms |
  | `ambiguous` | Anything else — inspect `result.reads` manually |

  Defaults of `chunks=200`, `delayMs=50`, `bytes=1024` make the handler
  take ~10 seconds wall-clock, which gives the reader plenty of time to
  observe any streaming behavior. Tune up or down on flaky measurements.

## Origin rules

Tauri's custom protocols use platform-specific origins:

| Platform           | URL used by `fetch()`                |
|--------------------|---------------------------------------|
| Windows / Android  | `http://stream-test.localhost/run?…`  |
| macOS / iOS / Linux| `stream-test://localhost/run?…`       |

The harness picks the right one by sniffing `navigator.userAgent`. CSP
`connect-src` in `devCsp` includes both forms so a single binary can be
tested on either OS.

## Runbook

### Windows (WebView2)

```powershell
npm run tauri:dev:lite          # full app start, ~30s
# wait for window to appear and the app to load past initial spinner
# open the WebView2 devtools (Ctrl+Shift+I) -> Console tab
await window.__streamHarness({ chunks: 200, delayMs: 50, bytes: 1024 })
```

The `console.table` output captures the seven headline numbers. The full
`reads[]` array is also returned for offline analysis.

### macOS (WKWebView)

```bash
npm run tauri:dev:lite          # same script
# open WKWebView devtools (Cmd+Option+I) -> Console
await window.__streamHarness({ chunks: 200, delayMs: 50, bytes: 1024 })
```

WKWebView is the historical risk surface — the idea explicitly calls it
out. If `verdict === "buffered"` on macOS the rest of the refactor is
unsalvageable on that platform; if `verdict === "streaming"` then the
delivery overlap window can still be measured.

### Variants worth trying

- **Tiny body, fast handler:** `{chunks: 10, delayMs: 0, bytes: 64}` —
  baseline to confirm the harness wiring works.
- **Large body, no delay:** `{chunks: 5000, delayMs: 0, bytes: 16384}` —
  ~80 MB body, useful for seeing if pure transfer time alone produces
  multiple reader yields.
- **Production-shape payload:** `{chunks: 200, delayMs: 50, bytes: 4096}`
  — roughly mirrors a build_session's event stream size.

## Decision gate

After Windows + macOS measurements are recorded here:

- **Both platforms `streaming`:** the perf ceiling is still bounded by
  transfer time (likely single-digit ms for build_session payloads).
  Compare against the cheap-fix candidate (`Arc<BuildEvent>` clone
  removal in `events.rs`). Only proceed to Phase 2 if the gap remains > 5%
  of frame budget at peak.
- **Either platform `buffered`:** the refactor cannot deliver its perf
  claim on that platform. Descope phases 2–4.
- **`ambiguous` anywhere:** rerun with adjusted parameters before drawing
  conclusions. The thresholds in the verdict heuristic are deliberately
  generous; record raw `reads[]` and adjust here if the noise floor
  warrants.

## Measurements

> Fill in as you run them.

### Windows / WebView2

Run on: _yyyy-mm-dd, build XXXX_

Params: `{chunks: 200, delayMs: 50, bytes: 1024}`

| Field | Value |
|---|---|
| expected handler duration (ms) | 10000 |
| actual handler duration (ms) | _todo_ |
| first reader yield (ms) | _todo_ |
| last reader yield (ms) | _todo_ |
| spread between reads (ms) | _todo_ |
| total reads | _todo_ |
| total bytes | _todo_ |
| verdict | _todo_ |

### macOS / WKWebView

Run on: _yyyy-mm-dd, build XXXX_

Params: `{chunks: 200, delayMs: 50, bytes: 1024}`

| Field | Value |
|---|---|
| expected handler duration (ms) | 10000 |
| actual handler duration (ms) | _todo_ |
| first reader yield (ms) | _todo_ |
| last reader yield (ms) | _todo_ |
| spread between reads (ms) | _todo_ |
| total reads | _todo_ |
| total bytes | _todo_ |
| verdict | _todo_ |

## Cleanup

If Phase 1 confirms the refactor isn't worth it, remove:

1. `src-tauri/src/stream_harness.rs`
2. The `mod stream_harness;` line and `register_asynchronous_uri_scheme_protocol("stream-test", …)` block in `src-tauri/src/lib.rs`
3. `http://stream-test.localhost stream-test:` from `devCsp` in `src-tauri/tauri.conf.json`
4. `src/lib/devTools/streamHarness.ts`
5. The `import('./lib/devTools/streamHarness')` line in `src/main.tsx`
6. This document

Five files, ~250 lines total. Self-contained.
