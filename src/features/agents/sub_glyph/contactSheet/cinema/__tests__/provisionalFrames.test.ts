import { describe, it, expect } from "vitest";
import { en } from "@/i18n/en";
import type { ProvisionalBuildState } from "@/stores/slices/agents/matrixBuildSlice";
import { provisionalDims, provisionalFieldDim, provisionalFrameValues } from "../provisionalFrames";
import { deriveFrameState, populatedDims } from "../sheetModel";

const EMPTY: ProvisionalBuildState = { capabilities: {}, order: [] };

const PREVIEW: ProvisionalBuildState = {
  order: ["uc_digest", "uc_alert"],
  capabilities: {
    uc_digest: {
      id: "uc_digest",
      title: "Morning digest",
      fields: {
        suggested_trigger: { trigger_type: "schedule", config: { cron: "0 7 * * *" } },
        connectors: ["gmail"],
        review_policy: { mode: "never" },
      },
    },
    uc_alert: { id: "uc_alert", title: "Urgent alert", fields: {} },
  },
};

describe("provisionalFrames", () => {
  it("maps each v3 field to the frame the authoritative pass would light", () => {
    expect(provisionalFieldDim("suggested_trigger")).toBe("trigger");
    expect(provisionalFieldDim("connectors")).toBe("connector");
    expect(provisionalFieldDim("notification_channels")).toBe("message");
    expect(provisionalFieldDim("review_policy")).toBe("review");
    expect(provisionalFieldDim("memory_policy")).toBe("memory");
    expect(provisionalFieldDim("event_subscriptions")).toBe("event");
    expect(provisionalFieldDim("error_handling")).toBe("error");
    expect(provisionalFieldDim("sample_output")).toBe("task");
    expect(provisionalFieldDim("tool_hints")).toBeNull();
  });

  it("an empty preview touches no frame", () => {
    expect(provisionalDims(EMPTY).size).toBe(0);
    expect(Object.values(provisionalFrameValues(EMPTY, en)).every((v) => v === null)).toBe(true);
  });

  it("develops the task frame and each resolved field's frame", () => {
    expect([...provisionalDims(PREVIEW)].sort()).toEqual(["connector", "review", "task", "trigger"]);
  });

  it("draws the pictures it can, and nothing it cannot", () => {
    const v = provisionalFrameValues(PREVIEW, en);
    expect(v.task?.caps).toEqual(["Morning digest", "Urgent alert"]);
    expect(v.trigger?.triggerKind).toBe("schedule");
    expect(v.trigger?.week?.days.every(Boolean)).toBe(true);
    expect(v.connector?.apps).toEqual(["gmail"]);
    expect(v.review).toBeNull(); // develops with its caption only
  });

  it("a preview develops an empty frame but never lights it or makes it populated", () => {
    const base = { isCompose: false, act: "casting" as const, fromBuild: "blank" as const, answered: false, hasValue: false };
    expect(deriveFrameState({ ...base, previewing: true })).toBe("filling");
    expect(deriveFrameState({ ...base, previewing: false })).toBe("blank");
    // Confirmed data (or an answer) lights; the preview cannot override it.
    expect(deriveFrameState({ ...base, hasValue: true, previewing: true })).toBe("lit");
    expect(deriveFrameState({ ...base, fromBuild: "lit", previewing: true })).toBe("lit");
    // A frame waiting on a question stays pending, not developing.
    expect(deriveFrameState({ ...base, fromBuild: "pending", previewing: true })).toBe("pending");
    // A stopped build un-develops.
    expect(deriveFrameState({ ...base, act: "stopped", previewing: true })).toBe("blank");
    // Full colour is counted from CONFIRMED values only (useSheetState feeds
    // populatedDims `values`, never the preview's pictures).
    const confirmed = { trigger: null, task: null, connector: null, message: null, review: null, memory: null, event: null, error: null };
    expect(Object.values(populatedDims(confirmed, {}, [])).some(Boolean)).toBe(false);
  });
});
