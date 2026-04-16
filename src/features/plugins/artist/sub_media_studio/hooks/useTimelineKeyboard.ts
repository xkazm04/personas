import { useEffect, useCallback } from 'react';
import type { PlaybackEngine } from './useTimelinePlayback';

/**
 * Keyboard shortcuts for the Media Studio timeline.
 *
 * - Space: play/pause
 * - Delete/Backspace: remove selected item
 * - Left/Right arrows: seek ±1s
 * - Ctrl+Left/Right: seek ±5s
 * - Home: seek to 0
 * - End: seek to total duration
 * - Escape: deselect
 * - Ctrl+D: duplicate selected
 *
 * Uses the imperative `engine` to read the current time so this hook never
 * needs to re-subscribe on every rAF tick.
 */
export function useTimelineKeyboard({
  engine,
  play,
  pause,
  seek,
  totalDuration,
  selectedItemId,
  removeItem,
  duplicateItem,
  deselectItem,
  undo,
  redo,
}: {
  engine: PlaybackEngine;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  totalDuration: number;
  selectedItemId: string | null;
  removeItem: (id: string) => void;
  duplicateItem?: (id: string) => void;
  deselectItem: () => void;
  undo?: () => void;
  redo?: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (engine.getPlaying()) pause();
          else play();
          break;

        case 'Delete':
        case 'Backspace':
          if (selectedItemId) {
            e.preventDefault();
            removeItem(selectedItemId);
          }
          break;

        case 'ArrowLeft': {
          e.preventDefault();
          const step = e.ctrlKey || e.metaKey ? 5 : 1;
          seek(Math.max(0, engine.getTime() - step));
          break;
        }

        case 'ArrowRight': {
          e.preventDefault();
          const step = e.ctrlKey || e.metaKey ? 5 : 1;
          seek(Math.min(totalDuration, engine.getTime() + step));
          break;
        }

        case 'Home':
          e.preventDefault();
          seek(0);
          break;

        case 'End':
          e.preventDefault();
          seek(totalDuration);
          break;

        case 'Escape':
          deselectItem();
          break;

        case 'KeyD':
          if ((e.ctrlKey || e.metaKey) && selectedItemId && duplicateItem) {
            e.preventDefault();
            duplicateItem(selectedItemId);
          }
          break;

        case 'KeyZ':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              redo?.();
            } else {
              undo?.();
            }
          }
          break;

        case 'KeyY':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            redo?.();
          }
          break;
      }
    },
    [engine, play, pause, seek, totalDuration, selectedItemId, removeItem, duplicateItem, deselectItem, undo, redo],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
