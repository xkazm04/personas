/**
 * Live Roadmap — thin frontend wrapper over the `fetch_roadmap` Tauri command.
 *
 * The Rust side owns transport (URL, timeouts, ETag), disk cache, and schema
 * validation. This wrapper only:
 * - Types the call
 * - Converts a Rust `Err(String)` rejection into a typed `LiveRoadmapOutcome`
 *   so call sites never have to try/catch. `ok: false` means "use bundled
 *   content" — the desktop app always has a shipped fallback — and carries the
 *   failure kind so a permanent break is distinguishable from a bad moment.
 *
 * See `docs/concepts/live-roadmap.md` for the full design and Variant B
 * migration path.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

// ---------------------------------------------------------------------------
// Wire types — match the `#[ts(export)]` types in
// `src-tauri/src/commands/live_roadmap.rs`. Inlined here (rather than
// imported from generated ts-rs bindings) so the surface is easy to
// re-target when Variant B swaps the transport.
// ---------------------------------------------------------------------------

export interface LiveRoadmapItem {
  id: string;
  itemType: string;
  status?: string | null;
  priority?: string | null;
  sortOrder?: number | null;
}

export interface LiveRoadmapRelease {
  version: string;
  status: string;
  items: LiveRoadmapItem[];
}

export interface LiveRoadmapLocaleItem {
  title: string;
  description?: string | null;
}

export interface LiveRoadmapLocale {
  label?: string | null;
  summary?: string | null;
  items: Record<string, LiveRoadmapLocaleItem>;
}

export interface LiveRoadmap {
  schemaVersion: number;
  generatedAt?: string | null;
  release: LiveRoadmapRelease;
  i18n: Record<string, LiveRoadmapLocale>;
}

/**
 * Where a `LiveRoadmapResult` came from on this call.
 *
 * - `network` — fresh GET (or 304 against an existing cache) just completed.
 * - `cache`   — disk cache was still fresh by TTL; network was deliberately
 *               skipped. Healthy "we're current" path.
 * - `stale`   — network was attempted but failed; we returned the cached
 *               payload as a rescue. Degraded: the live channel is silently
 *               broken and the user may be reading content the server has
 *               already updated. UI should surface this as a warning, not
 *               the same amber pill as a healthy cache hit.
 */
export type LiveRoadmapSource = 'network' | 'cache' | 'stale';

export interface LiveRoadmapResult {
  roadmap: LiveRoadmap;
  fetchedAt: string;
  source: LiveRoadmapSource;
}

// ---------------------------------------------------------------------------
// Command wrapper
// ---------------------------------------------------------------------------

/**
 * Why a fetch failed. The Rust side already distinguishes these — it returns a
 * different `Err(String)` for each — and this wrapper used to collapse all of
 * them into `null`, so the one authoritative statement of the cause died at the
 * boundary. The distinction that matters is the last axis, not the label:
 *
 * - `offline` / `timeout` / `http` — TRANSIENT. A tunnel, a flaky link, a
 *   server having a moment. Retrying later is the correct response and there is
 *   nothing to report.
 * - `schema` — STRUCTURAL. The server is publishing something this client
 *   cannot read (schema_version bump, malformed JSON, a validation rule broken
 *   upstream). It will not fix itself, every future fetch fails the same way,
 *   and to the user it looks exactly like the train tunnel above.
 */
export type LiveRoadmapFailureKind = 'offline' | 'timeout' | 'http' | 'schema' | 'unknown';

export interface LiveRoadmapFailure {
  kind: LiveRoadmapFailureKind;
  /** True for `schema` — a permanent break, not a bad moment on the network. */
  structural: boolean;
  /** The backend's own message, preserved for the report. */
  message: string;
}

export type LiveRoadmapOutcome =
  | { ok: true; result: LiveRoadmapResult }
  | { ok: false; failure: LiveRoadmapFailure };

/**
 * Map a rejection from `fetch_roadmap` onto a failure kind.
 *
 * The prefixes are the literal `Err(...)` strings in
 * `src-tauri/src/commands/live_roadmap.rs` — a string match, because that is
 * the only channel the command offers. It is deliberately biased toward
 * `unknown`: mislabelling a transient failure as structural would page someone
 * for a tunnel, so only the messages that provably come from the parse and
 * validate paths are called structural.
 */
function classify(err: unknown): LiveRoadmapFailure {
  const message = extractMessage(err);
  const m = message.toLowerCase();

  const kind: LiveRoadmapFailureKind =
    m.includes('timed out')                                    ? 'timeout'
    : m.includes('fetch failed') || m.includes('client build failed') ? 'offline'
    : m.includes('unexpected status')                          ? 'http'
    : m.includes('parse failed')
      || m.includes('unsupported schema_version')
      || m.includes('payload too large')
      || m.includes('release.version must be')
      || m.includes('release.items must contain')
      || m.includes('i18n.')                                   ? 'schema'
    : 'unknown';

  return { kind, structural: kind === 'schema', message };
}

/**
 * Fetch the published roadmap.
 *
 * Returns a discriminated outcome rather than `LiveRoadmapResult | null`: the
 * caller still treats any failure as "use bundled content", but it can now see
 * WHICH failure, which is the whole point — see {@link LiveRoadmapFailureKind}.
 * A structural failure is reported here, at the boundary that holds the
 * evidence, so it stops being indistinguishable from a bad network moment.
 *
 * `force: true` bypasses the 1-hour client cache — use for explicit refresh.
 */
export async function fetchLiveRoadmap(
  opts: { force?: boolean } = {},
): Promise<LiveRoadmapOutcome> {
  try {
    const result = await invoke<LiveRoadmapResult>('fetch_roadmap', {
      force: opts.force ?? false,
    });
    return { ok: true, result };
  } catch (err) {
    const failure = classify(err);
    if (failure.structural) {
      // A permanent break in the live channel: every future fetch fails the
      // same way and the UI can only ever say "stale". This is the one that
      // has to reach monitoring.
      silentCatch(`api/liveRoadmap:fetch_roadmap[${failure.kind}]`)(err);
    }
    return { ok: false, failure };
  }
}
