import { describe, expect, it } from 'vitest';
import { isCanvasNote, parseCanvasNote } from '../chat/athenaChatCanvasSummary';

/** Exactly the body `companion_canvas_control_result` appends. */
function episode(kind: string, envelope: unknown): string {
  return (
    `[canvas] Result of your \`canvas_control\` (${kind}):\n\n` +
    `${JSON.stringify(envelope)}\n\n` +
    '`camera.band` is what the user now sees. If `ok` is false, the ' +
    '`reason` names why — do not silently re-emit the same action; adjust ' +
    'or tell the user.'
  );
}

describe('isCanvasNote', () => {
  it('matches only the canvas readback prefix', () => {
    expect(isCanvasNote('[canvas] Result of your `canvas_control` (camera.fit):')).toBe(true);
    expect(isCanvasNote('  [canvas] leading whitespace is fine')).toBe(true);
    expect(isCanvasNote('[fleet] something else')).toBe(false);
    expect(isCanvasNote('Here is what the canvas looks like')).toBe(false);
  });
});

describe('parseCanvasNote', () => {
  it('pulls kind, band and visible count out of a successful readback', () => {
    const note = parseCanvasNote(
      episode('camera.focus', {
        seq: 1,
        ok: true,
        camera: {
          x: 635.07,
          y: 295.21,
          z: 0.129,
          band: 'far',
          viewport: { w: 1029, h: 682 },
          visibleSlugs: ['a', 'b', 'c'],
        },
      }),
    );
    expect(note).toEqual({
      kind: 'camera.focus',
      ok: true,
      band: 'far',
      visibleCount: 3,
    });
  });

  it('counts back through the bridge’s "…+N more" truncation sentinel', () => {
    const slugs = [...Array(10).keys()].map(String);
    const note = parseCanvasNote(
      episode('camera.fit', {
        seq: 2,
        ok: true,
        camera: {
          x: 0,
          y: 0,
          z: 1,
          band: 'mid',
          viewport: { w: 800, h: 600 },
          visibleSlugs: [...slugs, '…+4 more'],
        },
      }),
    );
    // 10 real slugs + the sentinel standing in for 4 more.
    expect(note?.visibleCount).toBe(14);
  });

  it('carries the refusal reason instead of camera facts when ok is false', () => {
    const note = parseCanvasNote(
      episode('dim.open', { seq: 3, ok: false, reason: 'band_too_far' }),
    );
    expect(note).toMatchObject({ kind: 'dim.open', ok: false, reason: 'band_too_far' });
    expect(note?.band).toBeUndefined();
  });

  it('records a clamped camera', () => {
    const note = parseCanvasNote(
      episode('camera.zoom', {
        seq: 4,
        ok: true,
        clamped: true,
        camera: { x: 0, y: 0, z: 4, band: 'close', viewport: { w: 1, h: 1 }, visibleSlugs: [] },
      }),
    );
    expect(note?.clamped).toBe(true);
    expect(note?.visibleCount).toBe(0);
  });

  it('degrades to the kind alone when the envelope is truncated or absent', () => {
    // The backend caps the body at 1200 chars, so a clipped JSON tail is a
    // real case — the summary must still name what she did.
    const clipped = '[canvas] Result of your `canvas_control` (camera.pan):\n\n{"seq":9,"ok":tr';
    expect(parseCanvasNote(clipped)).toEqual({ kind: 'camera.pan', ok: true });
    expect(parseCanvasNote('[canvas] Result of your `canvas_control` (island.menu):')).toEqual({
      kind: 'island.menu',
      ok: true,
    });
  });

  it('returns null for anything that is not a canvas readback', () => {
    expect(parseCanvasNote('[fleet]')).toBeNull();
    expect(parseCanvasNote('plain assistant prose')).toBeNull();
    // Right prefix, no parseable kind → not a note we can summarize.
    expect(parseCanvasNote('[canvas] something unrecognised')).toBeNull();
  });

  it('ignores a band the canvas grammar does not define', () => {
    const note = parseCanvasNote(
      episode('camera.read', {
        seq: 5,
        ok: true,
        camera: { x: 0, y: 0, z: 1, band: 'galactic', viewport: { w: 1, h: 1 }, visibleSlugs: [] },
      }),
    );
    expect(note?.band).toBeUndefined();
  });
});
