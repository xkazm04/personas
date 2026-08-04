// `compose_canvas_panel` → a live panel beside the canvas (WP3, 2026-08-04).
//
// Athena's compose op auto-fires (the panel proposes, it never runs anything —
// every action inside it is still consent-gated by SurfaceRenderer), so this
// bridge is the whole frontend half: persist, navigate, focus.
//
// Mounted app-wide next to the other always-on companion bridges, NOT inside
// MastermindPage: she can compose a panel while the user is anywhere in the
// app, and a listener that only exists while the canvas is open would drop
// exactly the composition that was supposed to bring him there.
import { useCallback } from 'react';

import {
  COMPANION_COMPOSE_CANVAS_PANEL_EVENT,
  type CompanionComposeCanvasPanelEvent,
} from '@/api/companion';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { focusCanvasProject } from './focusStore';
import { hydrateLayout, saveAthenaPanel } from './layoutStore';

/** Subscribe to Athena's canvas-panel compositions. Safe to mount once. */
export function useCanvasPanelBridge(): void {
  useTauriEvent<CompanionComposeCanvasPanelEvent>(
    COMPANION_COMPOSE_CANVAS_PANEL_EVENT,
    useCallback((event) => {
      const { slug, specVersion, spec } = event.payload ?? {};
      if (!slug || typeof spec !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(spec);
      } catch (e) {
        silentCatch('mastermind compose_canvas_panel spec parse')(e);
        return;
      }
      // The store must be hydrated before a write, or the panel would be
      // saved onto an empty doc and clobber the user's layout on flush.
      void hydrateLayout().then(() => {
        // `saveAthenaPanel` refuses a spec version this build doesn't know, so
        // an unsupported envelope simply never becomes a panel.
        saveAthenaPanel(slug, {
          specVersion: typeof specVersion === 'number' ? specVersion : 1,
          spec: parsed,
          composedAt: new Date().toISOString(),
        });
        const s = useSystemStore.getState();
        s.setSidebarSection('teams');
        s.setTeamsTab('mastermind');
        // Camera travel: the island may be off-screen and therefore not in the
        // DOM at all, so focus is a camera request, never a node lookup.
        focusCanvasProject(slug, true);
      });
    }, []),
    'companion_compose_canvas_panel_listen',
  );
}
