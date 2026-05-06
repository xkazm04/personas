/**
 * Live Roadmap — thin frontend wrapper over the `fetch_roadmap` Tauri command.
 *
 * The Rust side owns transport (URL, timeouts, ETag), disk cache, and schema
 * validation. This wrapper only:
 * - Types the call
 * - Converts a Rust `Err(String)` rejection into `null` so call sites never
 *   have to try/catch. "Null" here means "use bundled content" — the desktop
 *   app always has a shipped fallback.
 *
 * See `docs/concepts/live-roadmap.md` for the full design and Variant B
 * migration path.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

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
 * Fetch the published roadmap. Returns `null` on any failure (network,
 * schema mismatch, no cache). Callers treat `null` as "use bundled content".
 *
 * `force: true` bypasses the 1-hour client cache — use for explicit refresh.
 */
export async function fetchLiveRoadmap(
  opts: { force?: boolean } = {},
): Promise<LiveRoadmapResult | null> {
  try {
    return await invoke<LiveRoadmapResult>('fetch_roadmap', { force: opts.force ?? false });
  } catch {
    return null;
  }
}
