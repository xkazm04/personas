import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useCanvasCamera } from '../lib/useCanvasCamera';

const VIEW_W = 800;
const VIEW_H = 600;

/** A detached <svg> with a stubbed layout box so fit()/zoomBy() see a viewport
 *  (jsdom reports a 0×0 rect otherwise). Real addEventListener for the wheel
 *  effect. */
function makeSvgRef() {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.getBoundingClientRect = () =>
    ({ width: VIEW_W, height: VIEW_H, left: 0, top: 0, right: VIEW_W, bottom: VIEW_H, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return { current: el };
}

/** World point currently under screen pixel (px,py): world = (screen - offset)/z. */
const worldUnder = (cam: { x: number; y: number; z: number }, px: number, py: number) => ({
  x: (px - cam.x) / cam.z,
  y: (py - cam.y) / cam.z,
});

describe('useCanvasCamera', () => {
  afterEach(() => {
    // renderHook auto-unmounts between tests via its own cleanup.
  });

  it('starts centred at the origin with z=0.5', () => {
    const { result } = renderHook(() => useCanvasCamera(makeSvgRef()));
    expect(result.current.cam).toEqual({ x: 0, y: 0, z: 0.5 });
  });

  it('zoomBy keeps the world point under the viewport centre fixed', () => {
    const { result } = renderHook(() => useCanvasCamera(makeSvgRef()));
    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const before = worldUnder(result.current.cam, cx, cy);
    act(() => result.current.zoomBy(1.7));
    const after = worldUnder(result.current.cam, cx, cy);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // And the zoom level actually changed.
    expect(result.current.cam.z).toBeCloseTo(0.85, 6);
  });

  it('clamps zoom-in to the MAX_Z ceiling (3)', () => {
    const { result } = renderHook(() => useCanvasCamera(makeSvgRef()));
    act(() => result.current.zoomBy(1000));
    expect(result.current.cam.z).toBeCloseTo(3, 6);
  });

  it('clamps zoom-out to the MIN_Z floor (0.06)', () => {
    const { result } = renderHook(() => useCanvasCamera(makeSvgRef()));
    act(() => result.current.zoomBy(0.00001));
    expect(result.current.cam.z).toBeCloseTo(0.06, 6);
  });

  it('fit centres the given bounds in the viewport', () => {
    const { result } = renderHook(() => useCanvasCamera(makeSvgRef()));
    const bounds = { minX: -400, minY: -300, maxX: 400, maxY: 300 };
    act(() => result.current.fit(bounds));
    const { cam } = result.current;
    // World centre of the bounds should land at the viewport centre.
    const centreX = (bounds.minX + bounds.maxX) / 2;
    const centreY = (bounds.minY + bounds.maxY) / 2;
    expect(centreX * cam.z + cam.x).toBeCloseTo(VIEW_W / 2, 6);
    expect(centreY * cam.z + cam.y).toBeCloseTo(VIEW_H / 2, 6);
  });

  it('fit clamps zoom into [0.12, 0.9]', () => {
    const { result } = renderHook(() => useCanvasCamera(makeSvgRef()));
    // Tiny bounds would zoom way in → clamped to the 0.9 ceiling.
    act(() => result.current.fit({ minX: 0, minY: 0, maxX: 1, maxY: 1 }));
    expect(result.current.cam.z).toBeCloseTo(0.9, 6);
    // Huge bounds would zoom way out → clamped to the 0.12 floor.
    act(() => result.current.fit({ minX: -100000, minY: -100000, maxX: 100000, maxY: 100000 }));
    expect(result.current.cam.z).toBeCloseTo(0.12, 6);
  });
});
