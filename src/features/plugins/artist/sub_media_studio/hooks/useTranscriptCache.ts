import { useEffect, useMemo, useState } from 'react';
import { artistLoadTranscript } from '@/api/artist';
import type { BeatAnchor, Composition, VideoClip, WordTimeline } from '../types';

/**
 * Loads every VideoClip's transcript sidecar from disk and keeps a cache
 * keyed by `transcriptPath`. Re-runs when the set of transcript paths
 * changes; does NOT re-run when the composition mutates in unrelated ways.
 *
 * Resolves anchor-word beats: given a `BeatAnchor`, returns the absolute
 * composition time (seconds) of the anchored word, accounting for clip
 * `trimStart` and `startTime` on the timeline. Returns `null` when the
 * transcript isn't loaded yet or the word/occurrence isn't found.
 */
export function useTranscriptCache(composition: Composition) {
  const paths = useMemo(() => {
    const set = new Set<string>();
    for (const item of composition.items) {
      if (item.type === 'video' && item.transcriptPath) {
        set.add(item.transcriptPath);
      }
    }
    return Array.from(set).sort();
  }, [composition.items]);

  const [cache, setCache] = useState<Record<string, WordTimeline>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, WordTimeline> = { ...cache };
      let mutated = false;
      for (const p of paths) {
        if (next[p]) continue;
        try {
          const raw = await artistLoadTranscript(p);
          const parsed = JSON.parse(raw) as WordTimeline;
          if (cancelled) return;
          next[p] = parsed;
          mutated = true;
        } catch {
          // Silently skip — UI will just fall back to manual startTime.
        }
      }
      // Drop cached entries whose path is no longer referenced.
      for (const p of Object.keys(next)) {
        if (!paths.includes(p)) {
          delete next[p];
          mutated = true;
        }
      }
      if (mutated && !cancelled) setCache(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cache is a
    // value-cache; re-entering the effect on its identity would re-fetch.
  }, [paths.join('|')]);

  const resolve = useMemo(
    () => (anchor: BeatAnchor, items: Composition['items']): number | null => {
      const clip = items.find(
        (it) => it.id === anchor.videoClipId && it.type === 'video',
      ) as VideoClip | undefined;
      if (!clip || !clip.transcriptPath) return null;
      const transcript = cache[clip.transcriptPath];
      if (!transcript) return null;
      const target = anchor.word.trim().toLowerCase();
      if (!target) return null;
      let hits = 0;
      for (const w of transcript.words) {
        if (w.text.trim().toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '') !== target) continue;
        hits += 1;
        if (hits === Math.max(1, anchor.occurrence)) {
          // word.start is seconds from the start of the source media.
          // Timeline time = clip.startTime + (word.start - clip.trimStart).
          const local = w.start - clip.trimStart;
          if (local < 0) return null;
          return clip.startTime + local;
        }
      }
      return null;
    },
    [cache],
  );

  return { cache, resolve };
}
