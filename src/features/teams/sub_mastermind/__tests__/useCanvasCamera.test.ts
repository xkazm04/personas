import { describe, it, expect, afterEach, vi } from 'vitest';
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

/** A detached world <g> for the imperative-pan path. */
function makeWorldRef() {
  return { current: document.createElementNS('http://www.w3.org/2000/svg', 'g') };
}

/** Minimal synthetic pointer event the camera handlers actually read. */
const ptr = (over: Partial<{ button: number; pointerId: number; clientX: number; clientY: number }>) =>
  ({ button: 0, pointerId: 1, clientX: 0, clientY: 0, currentTarget: { setPointerCapture() {} }, ...over }) as never;

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

describe('useCanvasCamera — render-free navigation', () => {
  it('pans imperatively: world transform moves, but cam state does NOT commit until release', () => {
    const svgRef = makeSvgRef();
    const worldRef = makeWorldRef();
    const { result } = renderHook(() => useCanvasCamera(svgRef, worldRef));
    const before = { ...result.current.cam }; // { x:0, y:0, z:0.5 }

    act(() => result.current.handlers.onPointerDown(ptr({ clientX: 100, clientY: 100 })));
    act(() => result.current.handlers.onPointerMove(ptr({ clientX: 140, clientY: 70 })));

    // No React commit while dragging — the island tree never sees a new cam.
    expect(result.current.cam).toEqual(before);
    // The world <g> transform was driven directly (Δ = +40, −30; z unchanged).
    expect(worldRef.current.getAttribute('transform')).toBe('translate(40 -30) scale(0.5)');
    // …and the live camera (camRef) tracks the in-progress pan for gesture math.
    expect(result.current.camRef.current).toMatchObject({ x: 40, y: -30, z: 0.5 });

    // Release commits the panned position exactly once.
    act(() => result.current.handlers.onPointerUp(ptr({})));
    expect(result.current.cam).toMatchObject({ x: 40, y: -30, z: 0.5 });
  });

  it('a sub-threshold press (≤3px) is a click, not a pan — no transform, no commit', () => {
    const svgRef = makeSvgRef();
    const worldRef = makeWorldRef();
    const { result } = renderHook(() => useCanvasCamera(svgRef, worldRef));
    act(() => result.current.handlers.onPointerDown(ptr({ clientX: 100, clientY: 100 })));
    act(() => result.current.handlers.onPointerMove(ptr({ clientX: 102, clientY: 101 })));
    act(() => result.current.handlers.onPointerUp(ptr({})));
    expect(result.current.cam).toEqual({ x: 0, y: 0, z: 0.5 });
    expect(worldRef.current.getAttribute('transform')).toBeNull();
  });

  it('coalesces a burst of wheel events into ONE committed state update per frame', () => {
    const rafs: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafs.push(cb); return rafs.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const svgRef = makeSvgRef();
      const { result } = renderHook(() => useCanvasCamera(svgRef));
      const el = svgRef.current;
      rafs.length = 0; // ignore anything React scheduled during mount

      // Three wheel-ins in the same frame.
      act(() => {
        for (let n = 0; n < 3; n++) {
          el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, cancelable: true }));
        }
      });
      // Exactly one frame scheduled for the burst, and nothing committed yet.
      expect(rafs).toHaveLength(1);
      expect(result.current.cam.z).toBeCloseTo(0.5, 6);

      // Flush the frame → a single commit carrying the combined factor.
      act(() => rafs.forEach((cb) => cb(0)));
      const combined = Math.exp(-(-100) * 0.0016) ** 3;
      expect(result.current.cam.z).toBeCloseTo(0.5 * combined, 5);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
