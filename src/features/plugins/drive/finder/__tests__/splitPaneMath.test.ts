import { describe, it, expect } from "vitest";

import {
  DIVIDER_KEY_STEP,
  PANE_LIMITS,
  clampPaneWidth,
  dragPaneWidth,
  keyPaneWidth,
} from "../shell/splitPaneMath";

describe("splitPaneMath", () => {
  it("clamps each pane to its own range and rounds", () => {
    expect(clampPaneWidth("sidebar", 10)).toBe(PANE_LIMITS.sidebar.min);
    expect(clampPaneWidth("sidebar", 9999)).toBe(PANE_LIMITS.sidebar.max);
    expect(clampPaneWidth("sidebar", 200.6)).toBe(201);
    expect(clampPaneWidth("inspector", 0)).toBe(PANE_LIMITS.inspector.min);
    expect(clampPaneWidth("inspector", 1000)).toBe(PANE_LIMITS.inspector.max);
    expect(clampPaneWidth("inspector", Number.NaN)).toBe(PANE_LIMITS.inspector.def);
  });

  it("grows the sidebar rightwards and the inspector leftwards on drag", () => {
    expect(dragPaneWidth("sidebar", 232, 100, 150)).toBe(282);
    expect(dragPaneWidth("sidebar", 232, 100, 50)).toBe(182);
    expect(dragPaneWidth("inspector", 300, 800, 750)).toBe(350);
    expect(dragPaneWidth("inspector", 300, 800, 900)).toBe(PANE_LIMITS.inspector.min);
  });

  it("steps by DIVIDER_KEY_STEP on arrow keys, moving the divider physically", () => {
    expect(keyPaneWidth("sidebar", 232, "ArrowRight")).toBe(232 + DIVIDER_KEY_STEP);
    expect(keyPaneWidth("sidebar", 232, "ArrowLeft")).toBe(232 - DIVIDER_KEY_STEP);
    expect(keyPaneWidth("inspector", 300, "ArrowRight")).toBe(300 - DIVIDER_KEY_STEP);
    expect(keyPaneWidth("inspector", 300, "ArrowLeft")).toBe(300 + DIVIDER_KEY_STEP);
    expect(keyPaneWidth("sidebar", PANE_LIMITS.sidebar.max, "ArrowRight")).toBe(
      PANE_LIMITS.sidebar.max,
    );
    expect(keyPaneWidth("sidebar", 232, "Enter")).toBeNull();
  });
});
