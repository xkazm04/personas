import { describe, it, expect, beforeEach, vi } from "vitest";

// dynamicTours pulls the tauri invoke wrapper for its IPC helpers; the
// validation surface under test is pure, so stub the transport out.
vi.mock("@/lib/tauriInvoke", () => ({
  invokeWithTimeout: vi.fn(() => Promise.resolve()),
}));

import manifest from "@/features/onboarding/anchors/tourAnchorManifest.json";
import {
  validateDynamicTour,
  ingestComposedTour,
  isKnownAnchor,
  COMPOSED_STEP_EVENT,
  type ComposedTourRecord,
} from "./dynamicTours";
import { getTourById } from "./tourSlice";

const knownTestid = manifest.testids[0]!;
const knownSection = manifest.sidebarSections[0]!;

function makeRecord(steps: unknown[], patch: Partial<ComposedTourRecord> = {}): ComposedTourRecord {
  return {
    id: "athena-11111111-2222-3333-4444-555555555555",
    topic: "scheduling a weekly digest",
    title: "Scheduling a weekly digest",
    description: "How timed triggers drive an agent.",
    icon: "Sparkles",
    color: "violet",
    stepsJson: JSON.stringify(steps),
    status: "ready",
    createdAt: "2026-07-30T00:00:00Z",
    ...patch,
  };
}

function validStep() {
  return {
    id: "open-schedules",
    title: "Open Schedules",
    description: "The schedules dashboard lists every timed trigger.",
    hint: "Look at the list.",
    nav: { sidebarSection: knownSection },
    highlightTestId: knownTestid,
    narration: "Here is where your schedules live.",
    subSteps: [],
  };
}

describe("dynamicTours validation (anchor-manifest gate)", () => {
  beforeEach(() => {
    globalThis.__personasDynamicTours = undefined;
  });

  it("accepts a valid composed tour and forces the acknowledge completion event", () => {
    const result = validateDynamicTour(makeRecord([validStep()]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.def.steps[0]!.completeOn).toBe(COMPOSED_STEP_EVENT);
      expect(result.def.icon).toBe("Sparkles");
    }
  });

  it("rejects a step with an unknown spotlight anchor (never silently plays it)", () => {
    const step = { ...validStep(), highlightTestId: "totally-hallucinated-anchor-xyz" };
    const result = validateDynamicTour(makeRecord([step]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("unknown anchor");
  });

  it("rejects unknown sidebar sections and sub-tab setters", () => {
    const badNav = { ...validStep(), nav: { sidebarSection: "not-a-section" } };
    expect(validateDynamicTour(makeRecord([badNav])).ok).toBe(false);

    const badSetter = {
      ...validStep(),
      nav: { sidebarSection: knownSection, subTabSetter: "setEvilTab", subTab: "x" },
    };
    expect(validateDynamicTour(makeRecord([badSetter])).ok).toBe(false);
  });

  it("rejects anchors that would break out of the querySelector string", () => {
    expect(isKnownAnchor('a"]{}')).toBe(false);
    expect(isKnownAnchor("")).toBe(false);
  });

  it("accepts dynamic-prefix anchors", () => {
    const prefix = manifest.dynamicPrefixes[0];
    if (prefix) {
      expect(isKnownAnchor(`${prefix}some-suffix`)).toBe(true);
    }
  });

  it("rejects empty step lists, malformed JSON, and non-dynamic ids", () => {
    expect(validateDynamicTour(makeRecord([])).ok).toBe(false);
    expect(validateDynamicTour(makeRecord([validStep()], { stepsJson: "not json" })).ok).toBe(false);
    expect(validateDynamicTour(makeRecord([validStep()], { id: "getting-started" })).ok).toBe(false);
  });

  it("rejects the whole tour when ANY sub-step anchor is unknown", () => {
    const step = {
      ...validStep(),
      subSteps: [{ id: "s1", label: "Look", hint: "", highlightTestId: "nope-not-real-anchor-zz" }],
    };
    if (!isKnownAnchor("nope-not-real-anchor-zz")) {
      expect(validateDynamicTour(makeRecord([step])).ok).toBe(false);
    }
  });

  it("ingestComposedTour registers a valid tour so GuidedTour can resolve it", () => {
    const record = makeRecord([validStep()]);
    const id = ingestComposedTour(record);
    expect(id).toBe(record.id);
    expect(getTourById(record.id as `athena-${string}`)?.title).toBe(record.title);
  });

  it("ingestComposedTour returns null (and registers nothing) for an invalid tour", () => {
    const record = makeRecord([{ ...validStep(), highlightTestId: "hallucinated-zzz-not-real" }]);
    const id = ingestComposedTour(record);
    expect(id).toBeNull();
    expect(getTourById(record.id as `athena-${string}`)).toBeUndefined();
  });
});
