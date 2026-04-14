import { useState, useCallback, useMemo } from 'react';
import type {
  Composition,
  TimelineItem,
  VideoClip,
  AudioClip,
  TextItem,
  ImageItem,
} from '../types';
import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_FPS,
  DEFAULT_BG_COLOR,
} from '../constants';

function createDefaultComposition(): Composition {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled',
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    fps: DEFAULT_FPS,
    backgroundColor: DEFAULT_BG_COLOR,
    items: [],
  };
}

/**
 * Core composition state — kept local to Media Studio for Phase 1.
 */
export function useMediaStudio() {
  const [composition, setComposition] = useState<Composition>(createDefaultComposition);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // -- Mutators ---------------------------------------------------------------

  const updateComposition = useCallback((patch: Partial<Composition>) => {
    setComposition((prev) => ({ ...prev, ...patch }));
  }, []);

  const addItem = useCallback((item: TimelineItem) => {
    setComposition((prev) => ({
      ...prev,
      items: [...prev.items, item],
    }));
    setSelectedItemId(item.id);
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<TimelineItem>) => {
    setComposition((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id ? ({ ...it, ...patch } as TimelineItem) : it,
      ),
    }));
  }, []);

  const removeItem = useCallback(
    (id: string) => {
      setComposition((prev) => ({
        ...prev,
        items: prev.items.filter((it) => it.id !== id),
      }));
      if (selectedItemId === id) setSelectedItemId(null);
    },
    [selectedItemId],
  );

  const duplicateItem = useCallback(
    (id: string) => {
      setComposition((prev) => {
        const source = prev.items.find((it) => it.id === id);
        if (!source) return prev;
        const clone: TimelineItem = {
          ...source,
          id: crypto.randomUUID(),
          startTime: source.startTime + source.duration + 0.25,
          label: `${source.label} (copy)`,
        } as TimelineItem;
        return { ...prev, items: [...prev.items, clone] };
      });
    },
    [],
  );

  /**
   * Split an item at `time` (timeline-seconds). Non-destructive:
   * - The left half keeps the original `startTime`, new `duration = time - startTime`.
   * - The right half is a new clip at `startTime = time`, new `duration = remaining`.
   * - For video/audio clips, trim values are adjusted so each half references
   *   the correct sub-range of the source media.
   * - For text/image clips, both halves reference the same content and the
   *   user can edit them independently.
   *
   * Returns the id of the newly-created right half, or null if the split was
   * a no-op (time outside the clip).
   */
  const splitItemAt = useCallback((id: string, time: number): string | null => {
    // Generate the new id *outside* the updater so React StrictMode's
    // double-invocation doesn't produce two different UUIDs.
    const newId = crypto.randomUUID();
    let applied = false;
    setComposition((prev) => {
      const source = prev.items.find((it) => it.id === id);
      if (!source) return prev;
      const local = time - source.startTime;
      if (local <= 0.05 || local >= source.duration - 0.05) {
        return prev;
      }
      applied = true;
      const leftDuration = local;
      const rightDuration = source.duration - local;

      let left: TimelineItem;
      let right: TimelineItem;

      switch (source.type) {
        case 'video': {
          const v = source;
          left = { ...v, duration: leftDuration, transition: 'cut', transitionDuration: 0 };
          right = {
            ...v,
            id: newId,
            startTime: time,
            duration: rightDuration,
            trimStart: v.trimStart + leftDuration,
          };
          break;
        }
        case 'audio': {
          const a = source;
          left = { ...a, duration: leftDuration };
          right = {
            ...a,
            id: newId,
            startTime: time,
            duration: rightDuration,
            trimStart: a.trimStart + leftDuration,
          };
          break;
        }
        default: {
          left = { ...source, duration: leftDuration };
          right = {
            ...source,
            id: newId,
            startTime: time,
            duration: rightDuration,
          };
        }
      }

      return {
        ...prev,
        items: prev.items.map((it) => (it.id === id ? left : it)).concat(right),
      };
    });
    return applied ? newId : null;
  }, []);

  // -- Derived ----------------------------------------------------------------

  const videoItems = useMemo(
    () => composition.items.filter((i): i is VideoClip => i.type === 'video'),
    [composition.items],
  );
  const audioItems = useMemo(
    () => composition.items.filter((i): i is AudioClip => i.type === 'audio'),
    [composition.items],
  );
  const textItems = useMemo(
    () => composition.items.filter((i): i is TextItem => i.type === 'text'),
    [composition.items],
  );
  const imageItems = useMemo(
    () => composition.items.filter((i): i is ImageItem => i.type === 'image'),
    [composition.items],
  );

  const selectedItem = useMemo(
    () => composition.items.find((i) => i.id === selectedItemId) ?? null,
    [composition.items, selectedItemId],
  );

  const totalDuration = useMemo(
    () =>
      composition.items.reduce(
        (max, it) => Math.max(max, it.startTime + it.duration),
        0,
      ),
    [composition.items],
  );

  return {
    composition,
    updateComposition,
    addItem,
    updateItem,
    removeItem,
    duplicateItem,
    splitItemAt,
    selectedItemId,
    setSelectedItemId,
    selectedItem,
    videoItems,
    audioItems,
    textItems,
    imageItems,
    totalDuration,
  };
}
