import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  IDENTITY,
  isIdentity,
  MAX_ZOOM,
  MIN_ZOOM,
  rotateTransform,
  useQuickLookTransform,
  zoomTransform,
} from "../quicklook/useQuickLookTransform";

describe("zoomTransform", () => {
  it("clamps zoom to [1, 8] and recentres pan at minimum", () => {
    let t = IDENTITY;
    for (let i = 0; i < 40; i++) t = zoomTransform(t, 1.25);
    expect(t.zoom).toBe(MAX_ZOOM);
    t = { ...t, panX: 40, panY: -20 };
    for (let i = 0; i < 40; i++) t = zoomTransform(t, 1 / 1.25);
    expect(t.zoom).toBe(MIN_ZOOM);
    expect(t.panX).toBe(0);
    expect(t.panY).toBe(0);
  });

  it("returns the same object when already at the clamp", () => {
    const at = { ...IDENTITY, zoom: MAX_ZOOM };
    expect(zoomTransform(at, 2)).toBe(at);
    expect(zoomTransform(IDENTITY, 0.5)).toBe(IDENTITY);
  });

  it("anchors zoom at the wheel origin", () => {
    const t = zoomTransform(IDENTITY, 2, 100, 50);
    expect(t.zoom).toBe(2);
    expect(t.panX).toBe(-100);
    expect(t.panY).toBe(-50);
  });
});

describe("rotateTransform", () => {
  it("steps 90° and wraps at 360", () => {
    let t = IDENTITY;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      t = rotateTransform(t);
      seen.push(t.rotation);
    }
    expect(seen).toEqual([90, 180, 270, 0, 90]);
  });
});

describe("useQuickLookTransform", () => {
  it("resets to identity and remembers a transform per path", () => {
    const { result, rerender } = renderHook(({ path }) => useQuickLookTransform(path), {
      initialProps: { path: "a.png" },
    });
    act(() => result.current.zoomBy(2));
    act(() => result.current.rotate());
    expect(result.current.transform).toMatchObject({ zoom: 2, rotation: 90 });
    expect(isIdentity(result.current.transform)).toBe(false);

    rerender({ path: "b.png" });
    expect(isIdentity(result.current.transform)).toBe(true);

    rerender({ path: "a.png" });
    expect(result.current.transform).toMatchObject({ zoom: 2, rotation: 90 });

    act(() => result.current.reset());
    expect(result.current.transform).toEqual(IDENTITY);
  });
});
