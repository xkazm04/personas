import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  DENSITY_VIEWS,
  reapUnknownDensityKeys,
  resetDensityStateForTests,
  useDensity,
} from "../useDensity";

const KNOWN = "execution-list" as const;

describe("useDensity", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDensityStateForTests();
  });

  it("starts at the view's registered default and persists a change", () => {
    const { result } = renderHook(() => useDensity(KNOWN));
    expect(result.current.density).toBe(DENSITY_VIEWS[KNOWN]);

    act(() => { result.current.setDensity("compact"); });
    expect(result.current.density).toBe("compact");
    expect(localStorage.getItem(`density:${KNOWN}`)).toBe("compact");
  });

  it("reaps density: rows for views that are not in the registry", () => {
    localStorage.setItem("density:retired-view", "compact");
    localStorage.setItem("density:another-dead-one", "cozy");
    localStorage.setItem(`density:${KNOWN}`, "cozy");
    localStorage.setItem("unrelated:key", "keep me");

    const removed = reapUnknownDensityKeys().sort();

    expect(removed).toEqual(["density:another-dead-one", "density:retired-view"]);
    expect(localStorage.getItem("density:retired-view")).toBeNull();
    expect(localStorage.getItem("density:another-dead-one")).toBeNull();
    expect(localStorage.getItem(`density:${KNOWN}`)).toBe("cozy");
    expect(localStorage.getItem("unrelated:key")).toBe("keep me");
  });

  it("sweeps dead rows on first use, and only once", () => {
    localStorage.setItem("density:retired-view", "compact");

    renderHook(() => useDensity(KNOWN));
    expect(localStorage.getItem("density:retired-view")).toBeNull();

    // A row written after the one-shot sweep is not re-reaped by a later render.
    localStorage.setItem("density:retired-view", "compact");
    renderHook(() => useDensity(KNOWN));
    expect(localStorage.getItem("density:retired-view")).toBe("compact");
  });

  it("keeps consumers of the same view in sync and drops empty listener sets", () => {
    const a = renderHook(() => useDensity(KNOWN));
    const b = renderHook(() => useDensity(KNOWN));

    act(() => { a.result.current.setDensity("cozy"); });
    expect(b.result.current.density).toBe("cozy");

    a.unmount();
    b.unmount();
    // Nothing observable to assert beyond it not throwing; the pruning branch runs here.
    expect(localStorage.getItem(`density:${KNOWN}`)).toBe("cozy");
  });
});
