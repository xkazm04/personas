import { useEffect, useCallback } from 'react';

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
 * - D: duplicate selected
 */
export function useTimelineKeyboard({
  playing,
  play,
  pause,
  seek,
  currentTime,
  totalDuration,
  selectedItemId,
  removeItem,
  duplicateItem,
  deselectItem,
}: {
  playing: boolean;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  currentTime: number;
  totalDuration: number;
  selectedItemId: string | null;
  removeItem: (id: string) => void;
  duplicateItem?: (id: string) => void;
  deselectItem: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (playing) { pause(); } else { play(); }
          break;

        case 'Delete':
        case 'Backspace':
          if (selectedItemId) {
            e.preventDefault();
            removeItem(selectedItemId);
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          seek(Math.max(0, currentTime - (e.ctrlKey || e.metaKey ? 5 : 1)));
          break;

        case 'ArrowRight':
          e.preventDefault();
          seek(Math.min(totalDuration, currentTime + (e.ctrlKey || e.metaKey ? 5 : 1)));
          break;

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
      }
    },
    [playing, play, pause, seek, currentTime, totalDuration, selectedItemId, removeItem, duplicateItem, deselectItem],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
