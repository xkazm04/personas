import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { FINDER_PREFS_DEFAULT, FINDER_PREFS_KEY } from "../types";
import { coerceFinderPrefs, useFinderPrefs } from "../useFinderPrefs";

describe("useFinderPrefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hydrates from storage merged over the defaults", () => {
    localStorage.setItem(FINDER_PREFS_KEY, JSON.stringify({ viewMode: "gallery", sidebarW: 300 }));
    const { result } = renderHook(() => useFinderPrefs());
    expect(result.current.prefs).toEqual({
      ...FINDER_PREFS_DEFAULT,
      viewMode: "gallery",
      sidebarW: 300,
    });
  });

  it("persists every setter to storage", () => {
    const { result } = renderHook(() => useFinderPrefs());
    act(() => {
      result.current.setViewMode("columns");
      result.current.setSidebarOpen(false);
      result.current.setInspectorOpen(true);
      result.current.setSidebarW(200);
      result.current.setInspectorW(400);
    });
    const stored = JSON.parse(localStorage.getItem(FINDER_PREFS_KEY) ?? "{}");
    expect(stored).toEqual({
      viewMode: "columns",
      sidebarOpen: false,
      inspectorOpen: true,
      sidebarW: 200,
      inspectorW: 400,
    });
    expect(result.current.prefs).toEqual(stored);
  });

  it("falls back to the defaults on malformed JSON", () => {
    localStorage.setItem(FINDER_PREFS_KEY, "{not json");
    const { result } = renderHook(() => useFinderPrefs());
    expect(result.current.prefs).toEqual(FINDER_PREFS_DEFAULT);
  });

  it("coerces wrong-typed fields individually", () => {
    expect(
      coerceFinderPrefs({ viewMode: "tree", sidebarW: "wide", inspectorOpen: "yes", sidebarOpen: false }),
    ).toEqual({ ...FINDER_PREFS_DEFAULT, sidebarOpen: false });
    expect(coerceFinderPrefs(null)).toEqual(FINDER_PREFS_DEFAULT);
    expect(coerceFinderPrefs(42)).toEqual(FINDER_PREFS_DEFAULT);
  });
});
