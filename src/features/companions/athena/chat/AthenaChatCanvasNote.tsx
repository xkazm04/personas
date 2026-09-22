/**
 * AthenaChatCanvasNote — the human face of a `[canvas]` system episode.
 *
 * Renders as a slim, quiet row in the same family as the autonomous/fleet
 * markers: this is provenance ("she touched the canvas"), not conversation.
 * The raw envelope is still in the episode for Athena; the user gets a
 * sentence. See `athenaChatCanvasSummary.ts` for why.
 */

import { Frame, TriangleAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CanvasNote } from './athenaChatCanvasSummary';

type CompanionStrings = ReturnType<typeof useTranslation>['t']['plugins']['companion'];

/** Map an action kind to its localized "what just happened" sentence. */
function actionLabel(c: CompanionStrings, kind: string): string {
  switch (kind) {
    case 'camera.read':
      return c.canvas_note_camera_read;
    case 'camera.pan':
      return c.canvas_note_camera_pan;
    case 'camera.zoom':
      return c.canvas_note_camera_zoom;
    case 'camera.focus':
      return c.canvas_note_camera_focus;
    case 'camera.fit':
      return c.canvas_note_camera_fit;
    case 'dim.open':
      return c.canvas_note_dim_open;
    case 'category.open':
      return c.canvas_note_category_open;
    case 'island.menu':
      return c.canvas_note_island_menu;
    default:
      return c.canvas_note_generic;
  }
}

/** Map a machine fail reason to plain language. Unknown reasons fall through. */
function reasonLabel(c: CompanionStrings, reason: string | undefined): string | null {
  switch (reason) {
    case 'unknown_slug':
      return c.canvas_note_reason_unknown_slug;
    case 'unknown_target':
      return c.canvas_note_reason_unknown_target;
    case 'band_too_far':
      return c.canvas_note_reason_band_too_far;
    case 'demo_scene':
      return c.canvas_note_reason_demo_scene;
    case 'canvas_closed':
      return c.canvas_note_reason_canvas_closed;
    case 'bad_request':
      return c.canvas_note_reason_bad_request;
    default:
      return null;
  }
}

/** Localized name for the detail level the camera settled at. */
function bandLabel(c: CompanionStrings, band: CanvasNote['band']): string | null {
  switch (band) {
    case 'far':
      return c.canvas_note_band_far;
    case 'mid':
      return c.canvas_note_band_mid;
    case 'near':
      return c.canvas_note_band_near;
    case 'close':
      return c.canvas_note_band_close;
    default:
      return null;
  }
}

export function AthenaChatCanvasNote({ note }: { note: CanvasNote }) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;

  // Detail suffix: only the parts we actually have. A failure trades the
  // camera facts for the reason it refused — that IS the useful detail.
  const details: string[] = [];
  if (note.ok) {
    const band = bandLabel(c, note.band);
    if (band) details.push(band);
    if (note.visibleCount != null) {
      details.push(
        tx(
          note.visibleCount === 1
            ? c.canvas_note_visible_one
            : c.canvas_note_visible_other,
          { count: note.visibleCount },
        ),
      );
    }
    if (note.clamped) details.push(c.canvas_note_clamped);
  } else {
    const reason = reasonLabel(c, note.reason);
    if (reason) details.push(reason);
  }

  return (
    <div
      className="flex items-start gap-2 my-1 px-2 py-1"
      data-testid="companion-canvas-note"
      data-canvas-note-kind={note.kind}
      data-canvas-note-ok={note.ok ? 'true' : 'false'}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {note.ok ? (
          <Frame className="w-3.5 h-3.5 text-primary/70" />
        ) : (
          <TriangleAlert className="w-3.5 h-3.5 text-amber-400" />
        )}
      </span>
      <span className="min-w-0 typo-caption text-foreground">
        <span className="font-medium">
          {note.ok ? actionLabel(c, note.kind) : c.canvas_note_failed}
        </span>
        {details.length > 0 && (
          <span className="opacity-70"> — {details.join(' · ')}</span>
        )}
      </span>
    </div>
  );
}
