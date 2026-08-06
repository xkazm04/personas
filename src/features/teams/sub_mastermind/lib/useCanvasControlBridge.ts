// `canvas_control` → steering the live canvas (WP4, 2026-08-06).
//
// The v2 door onto the canvas action grammar: Athena's op auto-fires (steering
// is reversible view state — the camera moves or a popover opens, nothing
// mutates), the dispatcher already validated the kind and resolved any slug
// against the published scene, and this bridge is the whole frontend half:
// route to the canvas, dispatch into the grammar, report the settled result
// back so it lands in her session as a next-turn system note.
//
// Mounted app-wide next to the other always-on companion bridges (NOT inside
// MastermindPage) for the same reason as useCanvasPanelBridge: she can steer
// while the user is anywhere in the app, and the grammar's pickup window is
// exactly what carries the action across the route-in mount.
import { useCallback } from 'react';

import {
  COMPANION_CANVAS_CONTROL_EVENT,
  type CompanionCanvasControlEvent,
} from '@/api/companion';
import { companionCanvasControlResult } from '@/api/companion/bridges';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import {
  dispatchCanvasAction,
  type CanvasActionRequest,
  type CanvasActionResult,
} from './canvasActionStore';

/** Defense in depth — the dispatcher only emits these, but an event is an
 *  event: anything else is dropped here rather than reaching the grammar. */
const STEERING_KINDS = new Set([
  'camera.read',
  'camera.pan',
  'camera.zoom',
  'camera.focus',
  'camera.fit',
  'dim.open',
  'category.open',
  'island.menu',
]);

/** Slugs the reported envelope may name — the episode is a note, not a dump. */
const VISIBLE_SLUGS_MAX = 10;

/** Trim the readback for the transcript: the full visible-slug list can be a
 *  whole portfolio; ten plus an honest "+N more" tells her the same thing. */
function compactResult(result: CanvasActionResult): CanvasActionResult {
  const cam = result.camera;
  if (!cam || cam.visibleSlugs.length <= VISIBLE_SLUGS_MAX) return result;
  return {
    ...result,
    camera: {
      ...cam,
      visibleSlugs: [
        ...cam.visibleSlugs.slice(0, VISIBLE_SLUGS_MAX),
        `…+${cam.visibleSlugs.length - VISIBLE_SLUGS_MAX} more`,
      ],
    },
  };
}

/** Subscribe to Athena's canvas steering. Safe to mount once. */
export function useCanvasControlBridge(): void {
  useTauriEvent<CompanionCanvasControlEvent>(
    COMPANION_CANVAS_CONTROL_EVENT,
    useCallback((event) => {
      const { sessionId, action } = event.payload ?? {};
      if (!sessionId || typeof action !== 'string') return;
      let parsed: CanvasActionRequest;
      try {
        parsed = JSON.parse(action) as CanvasActionRequest;
      } catch (e) {
        silentCatch('mastermind canvas_control action parse')(e);
        return;
      }
      if (!STEERING_KINDS.has(parsed.kind)) return;
      // The canvas answers only while mounted — route there first. The
      // grammar's pickup timeout holds the action across the mount, and a
      // canvas that still never answers reports `canvas_closed` honestly.
      const s = useSystemStore.getState();
      s.setSidebarSection('teams');
      s.setTeamsTab('mastermind');
      void dispatchCanvasAction(parsed)
        .then((result) =>
          companionCanvasControlResult({
            sessionId,
            kind: parsed.kind,
            result: JSON.stringify(compactResult(result)),
          }),
        )
        .catch(silentCatch('mastermind canvas_control result report'));
    }, []),
    'companion_canvas_control_listen',
  );
}
