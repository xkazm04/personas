import { useState, useCallback, useMemo, useRef } from 'react';
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
 * Mutation tags. Consecutive mutations with the same tag inside the coalesce
 * window merge into one history entry, so dragging a clip produces a single
 * undoable step instead of dozens.
 */
type MutationTag =
  | 'replace'
  | 'addItem'
  | 'removeItem'
  | 'duplicateItem'
  | 'splitItem'
  | 'updateComposition'
  | `updateItem:${string}`;

const COALESCE_WINDOW_MS = 400;
const MAX_HISTORY = 80;

interface HistoryState {
  past: Composition[];
  present: Composition;
  future: Composition[];
  lastTag: MutationTag | null;
  lastAt: number;
}

/**
 * Core composition state with undo/redo. The reducer-style history is kept
 * internal — consumers get the same shape as before plus `undo`, `redo`,
 * `canUndo`, `canRedo`.
 */
export function useMediaStudio() {
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [],
    present: createDefaultComposition(),
    future: [],
    lastTag: null,
    lastAt: 0,
  }));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedItemId);
  selectedIdRef.current = selectedItemId;

  const composition = history.present;

  // -- Core mutator with coalescing -----------------------------------------
  //
  // `tag` identifies the mutation class. Same tag within COALESCE_WINDOW_MS
  // overwrites the present state without pushing a new past frame — perfect
  // for drag gestures. Different tag or expired window pushes onto `past`.
  const commit = useCallback((tag: MutationTag, recipe: (prev: Composition) => Composition) => {
    setHistory((h) => {
      const next = recipe(h.present);
      if (next === h.present) return h;
      const now = Date.now();
      const shouldCoalesce =
        h.lastTag === tag && now - h.lastAt < COALESCE_WINDOW_MS && h.past.length > 0;

      if (shouldCoalesce) {
        return { ...h, present: next, lastAt: now, future: [] };
      }
      const past = [...h.past, h.present];
      if (past.length > MAX_HISTORY) past.shift();
      return {
        past,
        present: next,
        future: [],
        lastTag: tag,
        lastAt: now,
      };
    });
  }, []);

  // -- Mutators --------------------------------------------------------------

  const updateComposition = useCallback((patch: Partial<Composition>) => {
    commit('updateComposition', (prev) => ({ ...prev, ...patch }));
  }, [commit]);

  const addItem = useCallback((item: TimelineItem) => {
    commit('addItem', (prev) => ({ ...prev, items: [...prev.items, item] }));
    setSelectedItemId(item.id);
  }, [commit]);

  const updateItem = useCallback((id: string, patch: Partial<TimelineItem>) => {
    commit(`updateItem:${id}`, (prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id ? ({ ...it, ...patch } as TimelineItem) : it,
      ),
    }));
  }, [commit]);

  const removeItem = useCallback(
    (id: string) => {
      commit('removeItem', (prev) => ({
        ...prev,
        items: prev.items.filter((it) => it.id !== id),
      }));
      if (selectedIdRef.current === id) setSelectedItemId(null);
    },
    [commit],
  );

  const duplicateItem = useCallback(
    (id: string) => {
      commit('duplicateItem', (prev) => {
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
    [commit],
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
    commit('splitItem', (prev) => {
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
  }, [commit]);

  // -- History controls ------------------------------------------------------

  const undo = useCallback(() => {
    setHistory((h) => {
      const past = h.past.slice();
      const prev = past.pop();
      if (!prev) return h;
      return {
        past,
        present: prev,
        future: [h.present, ...h.future],
        lastTag: null,
        lastAt: 0,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      const next = h.future[0];
      if (!next) return h;
      return {
        past: [...h.past, h.present],
        present: next,
        future: h.future.slice(1),
        lastTag: null,
        lastAt: 0,
      };
    });
  }, []);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

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
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
