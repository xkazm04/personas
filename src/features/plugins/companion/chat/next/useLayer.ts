/**
 * useLayer — which of the two layers is showing, and the keys that move
 * between them. Layer one is the conversation; everything else is a nested
 * view that takes the conversation's full space until Esc brings it back.
 */

import { useCallback, useState } from 'react';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { Turn } from './exchange';

export type LayerView =
  | { kind: 'chat' }
  | { kind: 'work'; focus: string | null; project: string | null }
  | { kind: 'turn'; turn: Turn }
  | { kind: 'modes' }
  /** Layered voice: a report opened from a ref link or its one-line card. */
  | { kind: 'report'; id: string };

export function useLayer() {
  const [view, setView] = useState<LayerView>({ kind: 'chat' });
  const back = useCallback(() => setView({ kind: 'chat' }), []);
  const openWork = useCallback(
    (focus: string | null = null, project: string | null = null) => setView({ kind: 'work', focus, project }),
    [],
  );
  const openTurn = useCallback((turn: Turn) => setView({ kind: 'turn', turn }), []);
  const openReport = useCallback((id: string) => setView({ kind: 'report', id }), []);
  const openModes = useCallback(() => setView((v) => (v.kind === 'modes' ? { kind: 'chat' } : { kind: 'modes' })), []);
  const toggleWork = useCallback(
    () => setView((v) => (v.kind === 'work' ? { kind: 'chat' } : { kind: 'work', focus: null, project: null })),
    [],
  );

  // The chat modal is a full-screen layer: it sits on that rung of the app's
  // keyboard ladder so a ConfirmDialog raised inside it still takes Esc first.
  useAppKeyboard(
    (e) => {
      if (e.altKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        toggleWork();
        return true;
      }
      if (e.key !== 'Escape') return false;
      // Esc inside a text field belongs to that field (slash palette, rename).
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || (el.tagName === 'TEXTAREA' && (el as HTMLTextAreaElement).value))) return false;
      if (view.kind === 'chat') return false;
      setView({ kind: 'chat' });
      return true;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY },
  );

  return { view, setView, back, openWork, openTurn, openReport, openModes, toggleWork };
}

export type LayerApi = ReturnType<typeof useLayer>;
