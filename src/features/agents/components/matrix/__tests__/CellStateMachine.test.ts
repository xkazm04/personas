import { describe, it, expect } from "vitest";
import { CELL_STATE_CLASSES, getCellStateClasses } from "../cellStateClasses";
import type { CellBuildStatus } from "@/lib/types/buildTypes";

const ALL_STATUSES: CellBuildStatus[] = [
  "hidden",
  "revealed",
  "pending",
  "filling",
  "resolved",
  "highlighted",
  "updated",
  "error",
];

describe("CELL_STATE_CLASSES", () => {
  it("maps all 8 CellBuildStatus values", () => {
    expect(Object.keys(CELL_STATE_CLASSES)).toHaveLength(8);
  });

  it("has an entry for every CellBuildStatus value", () => {
    for (const status of ALL_STATUSES) {
      expect(CELL_STATE_CLASSES).toHaveProperty(status);
    }
  });

  it("each entry has border, bg, opacity, and interactive properties", () => {
    for (const status of ALL_STATUSES) {
      const config = CELL_STATE_CLASSES[status];
      expect(config).toHaveProperty("border");
      expect(config).toHaveProperty("bg");
      expect(config).toHaveProperty("opacity");
      expect(config).toHaveProperty("interactive");
      expect(typeof config.border).toBe("string");
      expect(typeof config.bg).toBe("string");
      expect(typeof config.opacity).toBe("string");
      expect(typeof config.interactive).toBe("boolean");
    }
  });

  it("'hidden' has opacity-0 and interactive: false", () => {
    const config = CELL_STATE_CLASSES.hidden;
    expect(config.opacity).toContain("opacity-0");
    expect(config.interactive).toBe(false);
  });

  it("'resolved' has opacity-100 and interactive: true", () => {
    const config = CELL_STATE_CLASSES.resolved;
    expect(config.opacity).toContain("opacity-100");
    expect(config.interactive).toBe(true);
  });

  it("'highlighted' has interactive: true (for Q&A click)", () => {
    const config = CELL_STATE_CLASSES.highlighted;
    expect(config.interactive).toBe(true);
  });

  it("'revealed' is not interactive (ghosted outline)", () => {
    const config = CELL_STATE_CLASSES.revealed;
    expect(config.interactive).toBe(false);
  });

  it("'pending' is not interactive", () => {
    const config = CELL_STATE_CLASSES.pending;
    expect(config.interactive).toBe(false);
  });

  it("'filling' is not interactive", () => {
    const config = CELL_STATE_CLASSES.filling;
    expect(config.interactive).toBe(false);
  });

  it("'error' is interactive", () => {
    const config = CELL_STATE_CLASSES.error;
    expect(config.interactive).toBe(true);
  });
});

describe("getCellStateClasses", () => {
  it("returns the correct config for each valid status", () => {
    for (const status of ALL_STATUSES) {
      const result = getCellStateClasses(status);
      expect(result).toEqual(CELL_STATE_CLASSES[status]);
    }
  });

  it("returns 'hidden' config for unknown status (graceful fallback)", () => {
    const result = getCellStateClasses("nonexistent-status");
    expect(result).toEqual(CELL_STATE_CLASSES.hidden);
  });

  it("returns 'hidden' config for empty string", () => {
    const result = getCellStateClasses("");
    expect(result).toEqual(CELL_STATE_CLASSES.hidden);
  });
});
