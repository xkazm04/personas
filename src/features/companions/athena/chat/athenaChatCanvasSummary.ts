/**
 * `[canvas]` system episodes — machine readback, human summary.
 *
 * When Athena steers the Mastermind canvas (`canvas_control`), the frontend
 * bridge reports the settled `CanvasActionResult` back and the backend appends
 * it as a System episode so she can read on her next turn where the camera
 * ended up (`commands/companion/canvas_control.rs`). That episode is written
 * for HER — it is a JSON envelope with camera coordinates, a zoom band, and a
 * list of visible island uuids — and until now the transcript rendered it
 * verbatim, so the user got a wall of `{"seq":1,"ok":true,"camera":{…}}` in the
 * middle of their conversation.
 *
 * The episode body stays exactly as it is (it is Athena's memory, and trimming
 * it would blind her). This module is the DISPLAY side: recognise the note,
 * pull out the few facts a human cares about, and let the transcript render a
 * one-line "here's what I just did on the canvas" instead.
 */

/** Zoom bands the canvas reports back, coarse → fine. */
export type CanvasNoteBand = 'far' | 'mid' | 'near' | 'close';

const BANDS: readonly string[] = ['far', 'mid', 'near', 'close'];

export interface CanvasNote {
  /** Action kind that settled, e.g. `camera.focus`. */
  kind: string;
  /** Did the canvas actually do it? */
  ok: boolean;
  /** Machine reason when `ok` is false, e.g. `band_too_far`. */
  reason?: string;
  /** Detail level the user is now looking at. */
  band?: CanvasNoteBand;
  /** How many islands are in view after the action. */
  visibleCount?: number;
  /** The camera landed short of the request (z clamp). */
  clamped?: boolean;
}

/** Cheap prefix test — runs on every system bubble, so keep it a `startsWith`. */
export function isCanvasNote(text: string): boolean {
  return text.trimStart().startsWith('[canvas]');
}

/**
 * Parse a `[canvas]` episode body into the handful of display facts.
 *
 * Deliberately forgiving: an unparseable body still yields a note with just
 * the kind (or `null` if even that is missing), because rendering "Athena
 * steered the canvas" beats rendering raw JSON, and rendering raw JSON beats
 * throwing inside a transcript row.
 */
export function parseCanvasNote(text: string): CanvasNote | null {
  if (!isCanvasNote(text)) return null;

  const kind = /`canvas_control`\s*\(([^)]+)\)/.exec(text)?.[1]?.trim() ?? '';
  if (!kind) return null;

  const note: CanvasNote = { kind, ok: true };

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return note;

  let envelope: unknown;
  try {
    envelope = JSON.parse(text.slice(start, end + 1));
  } catch {
    // A truncated envelope (the backend caps the body at 1200 chars) is
    // expected often enough that it is not worth a breadcrumb — the kind
    // alone still produces an honest summary.
    return note;
  }
  if (!envelope || typeof envelope !== 'object') return note;

  const env = envelope as Record<string, unknown>;
  if (typeof env.ok === 'boolean') note.ok = env.ok;
  if (typeof env.reason === 'string') note.reason = env.reason;
  if (env.clamped === true) note.clamped = true;

  const camera = env.camera;
  if (camera && typeof camera === 'object') {
    const cam = camera as Record<string, unknown>;
    if (typeof cam.band === 'string' && BANDS.includes(cam.band)) {
      note.band = cam.band as CanvasNoteBand;
    }
    if (Array.isArray(cam.visibleSlugs)) {
      // The bridge truncates the list and appends a "…+N more" sentinel, so
      // count that back out rather than reporting a capped 10.
      const tail = cam.visibleSlugs[cam.visibleSlugs.length - 1];
      const more =
        typeof tail === 'string' ? /^…\+(\d+) more$/.exec(tail)?.[1] : undefined;
      note.visibleCount = more
        ? cam.visibleSlugs.length - 1 + Number(more)
        : cam.visibleSlugs.length;
    }
  }

  return note;
}
