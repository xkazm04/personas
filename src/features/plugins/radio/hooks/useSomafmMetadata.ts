import { useEffect, useState } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import type { StreamMetadata } from '@/lib/bindings/StreamMetadata';
import { radioFetchSomafmMetadata } from '../api/radioApi';

/** Poll cadence for SomaFM metadata. SomaFM updates their JSON every
 *  ~30s so anything faster wastes IPC + network without finer track
 *  resolution. Reset on slug change. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Resolve the SomaFM slug for a station, or null if the station isn't
 * a SomaFM stream. The radio_stations.json seed sets `slug` to the
 * SomaFM channel id ("groovesalad", "dronezone", ...) so we can reuse
 * it directly — no extra mapping table.
 */
export function somafmSlugForStation(
  sourceKind: string | null,
  sourceLabel: string | null,
  slug: string | null,
): string | null {
  if (sourceKind !== 'stream') return null;
  if (sourceLabel !== 'SomaFM') return null;
  return slug;
}

/**
 * Polls the Rust-side SomaFM metadata fetcher every 30s while a
 * SomaFM stream station is active. Returns the latest current-track
 * artist/title, or null if there's no metadata yet (initial load,
 * non-SomaFM stream, fetch error). Errors are swallowed silently;
 * showing the station name is the perfectly fine fallback.
 */
export function useSomafmMetadata(slug: string | null): StreamMetadata | null {
  const [meta, setMeta] = useState<StreamMetadata | null>(null);

  useEffect(() => {
    if (!slug) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    const fetchOnce = () => {
      radioFetchSomafmMetadata(slug)
        .then((m) => {
          if (!cancelled) setMeta(m);
        })
        .catch(silentCatch('radio:somafm-metadata'));
    };
    fetchOnce();
    const id = window.setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [slug]);

  return meta;
}
