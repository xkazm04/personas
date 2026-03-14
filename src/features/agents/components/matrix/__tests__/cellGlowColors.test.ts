import { describe, it, expect } from "vitest";
import {
  CELL_GLOW_COLOR_CLASSES,
  getCellGlowColorClass,
} from "../cellGlowColors";

describe("cellGlowColors", () => {
  describe("CELL_GLOW_COLOR_CLASSES", () => {
    it("maps all 8 cell keys to glow color classes", () => {
      expect(Object.keys(CELL_GLOW_COLOR_CLASSES)).toHaveLength(8);
    });
  });

  describe("getCellGlowColorClass", () => {
    it.each([
      ["use-cases", "cell-glow-violet"],
      ["connectors", "cell-glow-cyan"],
      ["triggers", "cell-glow-amber"],
      ["human-review", "cell-glow-rose"],
      ["messages", "cell-glow-blue"],
      ["memory", "cell-glow-purple"],
      ["error-handling", "cell-glow-orange"],
      ["events", "cell-glow-teal"],
    ])("returns '%s' -> '%s'", (key, expected) => {
      expect(getCellGlowColorClass(key)).toBe(expected);
    });

    it("returns empty string for unknown key", () => {
      expect(getCellGlowColorClass("unknown-key")).toBe("");
    });
  });
});
