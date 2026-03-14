import { describe, it, expect } from "vitest";
import {
  DIMENSION_TO_CELL,
  ALL_CELL_KEYS,
  resolveCellKeys,
} from "../constants/dimensionMapping";

describe("dimensionMapping", () => {
  describe("resolveCellKeys", () => {
    it('maps "identity" to ["use-cases"]', () => {
      expect(resolveCellKeys("identity")).toEqual(["use-cases"]);
    });

    it('maps "capabilities" to ["connectors", "use-cases"] (multi-cell)', () => {
      expect(resolveCellKeys("capabilities")).toEqual(["connectors", "use-cases"]);
    });

    it('maps "tools" to ["connectors"]', () => {
      expect(resolveCellKeys("tools")).toEqual(["connectors"]);
    });

    it('maps "triggers" to ["triggers"]', () => {
      expect(resolveCellKeys("triggers")).toEqual(["triggers"]);
    });

    it('maps "activation" to ["triggers"]', () => {
      expect(resolveCellKeys("activation")).toEqual(["triggers"]);
    });

    it('maps "oversight" to ["human-review"]', () => {
      expect(resolveCellKeys("oversight")).toEqual(["human-review"]);
    });

    it('maps "memory" to ["memory"]', () => {
      expect(resolveCellKeys("memory")).toEqual(["memory"]);
    });

    it('maps "error_handling" to ["error-handling"]', () => {
      expect(resolveCellKeys("error_handling")).toEqual(["error-handling"]);
    });

    it('maps "notifications" to ["messages"]', () => {
      expect(resolveCellKeys("notifications")).toEqual(["messages"]);
    });

    it('maps "events" to ["events"]', () => {
      expect(resolveCellKeys("events")).toEqual(["events"]);
    });

    it("returns [] for unknown dimensions", () => {
      expect(resolveCellKeys("unknown_dimension")).toEqual([]);
    });

    it("returns [] for empty string", () => {
      expect(resolveCellKeys("")).toEqual([]);
    });
  });

  describe("ALL_CELL_KEYS", () => {
    it("contains exactly 8 cell keys", () => {
      expect(ALL_CELL_KEYS).toHaveLength(8);
    });

    it("contains the expected cell keys", () => {
      const expected = [
        "use-cases",
        "connectors",
        "triggers",
        "human-review",
        "memory",
        "error-handling",
        "messages",
        "events",
      ];
      expect([...ALL_CELL_KEYS]).toEqual(expected);
    });
  });

  describe("DIMENSION_TO_CELL integrity", () => {
    it("all mapped values are subsets of ALL_CELL_KEYS", () => {
      const validKeys = new Set<string>(ALL_CELL_KEYS);
      for (const [dimension, cellKeys] of Object.entries(DIMENSION_TO_CELL)) {
        for (const key of cellKeys) {
          expect(validKeys.has(key), `"${key}" from dimension "${dimension}" is not in ALL_CELL_KEYS`).toBe(true);
        }
      }
    });

    it("has alias pairs that resolve to the same cells", () => {
      // identity/purpose both map to use-cases
      expect(resolveCellKeys("identity")).toEqual(resolveCellKeys("purpose"));
      // activation/scheduling/triggers all map to triggers
      expect(resolveCellKeys("activation")).toEqual(resolveCellKeys("scheduling"));
      expect(resolveCellKeys("activation")).toEqual(resolveCellKeys("triggers"));
      // oversight/human_review both map to human-review
      expect(resolveCellKeys("oversight")).toEqual(resolveCellKeys("human_review"));
      // memory/persistence both map to memory
      expect(resolveCellKeys("memory")).toEqual(resolveCellKeys("persistence"));
      // error_handling/fallback both map to error-handling
      expect(resolveCellKeys("error_handling")).toEqual(resolveCellKeys("fallback"));
      // notifications/messaging both map to messages
      expect(resolveCellKeys("notifications")).toEqual(resolveCellKeys("messaging"));
      // events/subscriptions both map to events
      expect(resolveCellKeys("events")).toEqual(resolveCellKeys("subscriptions"));
    });
  });
});
