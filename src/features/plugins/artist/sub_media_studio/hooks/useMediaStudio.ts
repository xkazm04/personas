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
