/**
 * Phase 1 diagnostic runner for the `stream-test://` custom protocol.
 *
 * Invoke from the DevTools console after the app loads in `tauri:dev`:
 *
 *   await window.__streamHarness({ chunks: 200, delayMs: 50, bytes: 1024 })
 *
 * The Rust handler sleeps `delayMs` between writing each chunk to its in-memory
 * buffer before calling `responder.respond()` once with the full body. If the
 * WebView's URL loader streams that body to the JS reader, `getReader().read()`
 * will yield bytes during the sleep window. If the WebView buffers, every
 * `read()` will resolve after the handler completes.
 *
 * The verdict line decides which one happened on this platform — the answer
 * is the gate on whether phases 2–4 of `idea-7452b77e` are worth pursuing.
 *
 * Pairs with `src-tauri/src/stream_harness.rs` and the runbook at
 * `docs/architecture/stream-protocol-harness.md`.
 */

export interface StreamHarnessParams {
  chunks?: number;
  delayMs?: number;
  bytes?: number;
}

export interface StreamHarnessRead {
  byteOffset: number;
  arrivedAtMs: number;
}

export interface StreamHarnessResult {
  url: string;
  totalReads: number;
  totalBytes: number;
  firstReadMs: number;
  lastReadMs: number;
  rustHandlerElapsedMs: number;
  spreadMs: number;
  verdict: "streaming" | "buffered" | "ambiguous";
  reads: StreamHarnessRead[];
}

const DEFAULTS: Required<StreamHarnessParams> = {
  chunks: 200,
  delayMs: 50,
  bytes: 1024,
};

function pickBaseUrl(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows|Android/.test(ua)) return "http://stream-test.localhost/run";
  return "stream-test://localhost/run";
}

export async function runStreamHarness(
  params: StreamHarnessParams = {},
): Promise<StreamHarnessResult> {
  const cfg = { ...DEFAULTS, ...params };
  const url =
    `${pickBaseUrl()}?chunks=${cfg.chunks}` +
    `&delay_ms=${cfg.delayMs}&bytes=${cfg.bytes}`;

  const t0 = performance.now();
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `stream-test fetch failed: status=${response.status}, body=${!!response.body}`,
    );
  }

  const reader = response.body.getReader();
  const reads: StreamHarnessRead[] = [];
  let bytesSeen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      bytesSeen += value.byteLength;
      reads.push({ byteOffset: bytesSeen, arrivedAtMs: performance.now() - t0 });
    }
  }

  const rustHandlerElapsedUs = Number(
    response.headers.get("x-stream-test-elapsed-us") ?? "0",
  );
  const rustHandlerElapsedMs = rustHandlerElapsedUs / 1000;
  const firstReadMs = reads[0]?.arrivedAtMs ?? -1;
  const lastReadMs = reads[reads.length - 1]?.arrivedAtMs ?? -1;
  const spreadMs = reads.length > 0 ? lastReadMs - firstReadMs : 0;

  // Verdict heuristic:
  //  * streaming: first read lands at least 200ms before the handler finished
  //    (would-be impossible if the WebView buffered the whole body).
  //  * buffered:  first read lands within 100ms of handler end AND all reads
  //    are bunched within 100ms of each other.
  //  * ambiguous: anything else (worth a manual look at `reads`).
  const STREAM_LEAD_MS = 200;
  const BUNCH_MS = 100;
  let verdict: StreamHarnessResult["verdict"];
  if (firstReadMs >= 0 && firstReadMs < rustHandlerElapsedMs - STREAM_LEAD_MS) {
    verdict = "streaming";
  } else if (
    firstReadMs >= rustHandlerElapsedMs - BUNCH_MS &&
    spreadMs < BUNCH_MS
  ) {
    verdict = "buffered";
  } else {
    verdict = "ambiguous";
  }

  const result: StreamHarnessResult = {
    url,
    totalReads: reads.length,
    totalBytes: bytesSeen,
    firstReadMs,
    lastReadMs,
    rustHandlerElapsedMs,
    spreadMs,
    verdict,
    reads,
  };


  console.table({
    "expected handler duration (ms)": cfg.chunks * cfg.delayMs,
    "actual handler duration (ms)": rustHandlerElapsedMs.toFixed(1),
    "first reader yield (ms)": firstReadMs.toFixed(1),
    "last reader yield (ms)": lastReadMs.toFixed(1),
    "spread between reads (ms)": spreadMs.toFixed(1),
    "total reads": reads.length,
    "total bytes": bytesSeen,
    verdict,
  });
  return result;
}

type WindowWithHarness = Window & {
  __streamHarness?: typeof runStreamHarness;
};

if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as WindowWithHarness).__streamHarness = runStreamHarness;

  console.info(
    "[streamHarness] attached as window.__streamHarness — run e.g. " +
      "await window.__streamHarness({ chunks: 200, delayMs: 50 })",
  );
}
