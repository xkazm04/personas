import { describe, it, expect } from "vitest";
import { CELL_LABELS } from "../cellVocabulary";
import { ALL_CELL_KEYS } from "@/lib/constants/dimensionMapping";

describe("CELL_LABELS", () => {
  it("maps all 8 cell keys", () => {
    expect(Object.keys(CELL_LABELS)).toHaveLength(8);
  });

  it("includes every key from ALL_CELL_KEYS", () => {
    for (const key of ALL_CELL_KEYS) {
      expect(CELL_LABELS).toHaveProperty(key);
    }
  });

  // Three renamed labels (VISL-05)
  it("renames 'use-cases' to 'Tasks'", () => {
    expect(CELL_LABELS["use-cases"]).toBe("Tasks");
  });

  it("renames 'connectors' to 'Apps & Services'", () => {
    expect(CELL_LABELS["connectors"]).toBe("Apps & Services");
  });

  it("renames 'triggers' to 'When It Runs'", () => {
    expect(CELL_LABELS["triggers"]).toBe("When It Runs");
  });

  // Five unchanged labels
  it("keeps 'human-review' as 'Human Review'", () => {
    expect(CELL_LABELS["human-review"]).toBe("Human Review");
  });

  it("keeps 'messages' as 'Messages'", () => {
    expect(CELL_LABELS["messages"]).toBe("Messages");
  });

  it("keeps 'memory' as 'Memory'", () => {
    expect(CELL_LABELS["memory"]).toBe("Memory");
  });

  it("keeps 'error-handling' as 'Errors'", () => {
    expect(CELL_LABELS["error-handling"]).toBe("Errors");
  });

  it("keeps 'events' as 'Events'", () => {
    expect(CELL_LABELS["events"]).toBe("Events");
  });
});
