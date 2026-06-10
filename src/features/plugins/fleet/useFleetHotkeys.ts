import { useEffect, useRef } from 'react';

/**
 * Handlers the Sessions-tab hotkey layer dispatches to. All optional — an
 * absent handler simply makes its key a no-op (e.g. `/` when the search
 * input isn't rendered because there's only one session).
 */
export interface FleetHotkeyHandlers {
  /** `n` — jump focus to the next awaiting-input session. */
  onNextWaiting?: () => void;
  /** `↑` / `↓` — move session focus through the visible (grouped) list. */
  onMoveFocus?: (delta: 1 | -1) => void;
  /** `/` — focus the session search input. */
  onFocusSearch?: () => void;
  /** `g` — toggle the fullscreen terminal grid overlay. */
  onToggleGrid?: () => void;
  /** `?` — open the shortcuts help modal. */
  onShowHelp?: () => void;
}

/**
 * Document-level triage hotkeys for the Fleet Sessions tab.
 *
 * Deliberately conservative about when it fires: any modifier chord, any
 * typing context (inputs, textareas, contenteditable — which also covers
 * xterm.js's hidden helper textarea, so keys typed INTO a focused terminal
 * never trigger fleet navigation), or `enabled: false` (a modal/drawer is
 * open) all bypass the layer entirely.
 *
 * `gridOpen` narrows the active set to `g` (close the grid) and `n` (next
 * waiting) — arrow focus-moves and search make no sense over the overlay.
 */
export function useFleetHotkeys(
  enabled: boolean,
  gridOpen: boolean,
  handlers: FleetHotkeyHandlers,
): void {
  // Keep the latest handlers in a ref so the listener attaches once.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      const h = handlersRef.current;
      switch (e.key) {
        case 'n':
          h.onNextWaiting?.();
          break;
        case 'g':
          h.onToggleGrid?.();
          break;
        case '?':
          if (gridOpen) return;
          h.onShowHelp?.();
          break;
        case '/':
          if (gridOpen) return;
          e.preventDefault();
          h.onFocusSearch?.();
          break;
        case 'ArrowDown':
          if (gridOpen) return;
          e.preventDefault();
          h.onMoveFocus?.(1);
          break;
        case 'ArrowUp':
          if (gridOpen) return;
          e.preventDefault();
          h.onMoveFocus?.(-1);
          break;
        default:
          return;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, gridOpen]);
}
