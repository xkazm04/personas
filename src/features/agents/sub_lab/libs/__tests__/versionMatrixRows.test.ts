import { describe, it, expect } from "vitest";
import { buildVersionRows, type BuildRowsCtx } from "../versionMatrixRows";
import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";
import type { LabVersionRating } from "@/lib/bindings/LabVersionRating";

function version(n: number, tag = "experimental"): PersonaPromptVersion {
  return {
    id: `v${n}`,
    persona_id: "p1",
    version_number: n,
    structured_prompt: null,
    system_prompt: `prompt ${n}`,
    change_summary: null,
    tag,
    created_at: "2026-01-01T00:00:00Z",
    design_context: null,
    last_design_result: null,
    resolved_cells: null,
    icon: null,
    color: null,
  };
}

function rating(versionId: string, modelId: string, composite: number | null): LabVersionRating {
  return {
    versionId,
    versionNumber: Number(versionId.replace("v", "")),
    modelId,
    provider: "anthropic",
    compositeScore: composite,
    toolAccuracy: composite,
    outputQuality: composite,
    protocolCompliance: composite,
    costUsd: 0.1,
    durationMs: 1000,
    sampleCount: 1,
    lastMeasuredAt: "2026-01-02T00:00:00Z",
  };
}

const baseCtx: BuildRowsCtx = {
  versions: [],
  ratings: [],
  activeVersionId: null,
  activeModelId: null,
  activeProvider: "anthropic",
  baselineVersionId: null,
};

describe("buildVersionRows", () => {
  it("creates one row per measured (version, model) pair", () => {
    const rows = buildVersionRows({
      ...baseCtx,
      versions: [version(2), version(1)],
      ratings: [rating("v2", "opus", 86), rating("v2", "sonnet", 81), rating("v1", "opus", 79)],
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.key)).toContain("v2::opus");
    expect(rows.map((r) => r.key)).toContain("v2::sonnet");
    expect(rows.map((r) => r.key)).toContain("v1::opus");
  });

  it("marks exactly one active row at (activeVersion, activeModel)", () => {
    const rows = buildVersionRows({
      ...baseCtx,
      versions: [version(2, "production"), version(1)],
      ratings: [rating("v2", "opus", 86), rating("v2", "sonnet", 81)],
      activeVersionId: "v2",
      activeModelId: "sonnet",
    });
    const active = rows.filter((r) => r.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].key).toBe("v2::sonnet");
  });

  it("synthesizes an unmeasured active row when the live model has no rating", () => {
    const rows = buildVersionRows({
      ...baseCtx,
      versions: [version(2, "production")],
      ratings: [rating("v2", "opus", 86)],
      activeVersionId: "v2",
      activeModelId: "haiku",
    });
    const active = rows.find((r) => r.isActive);
    expect(active).toBeTruthy();
    expect(active!.modelId).toBe("haiku");
    expect(active!.composite).toBeNull();
    // active row sorts first within the version
    expect(rows[0].isActive).toBe(true);
  });

  it("gives an unmeasured version a single placeholder row", () => {
    const rows = buildVersionRows({ ...baseCtx, versions: [version(1)], ratings: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0].modelId).toBeNull();
    expect(rows[0].composite).toBeNull();
  });

  it("flags the best-scoring model per version with the ★", () => {
    const rows = buildVersionRows({
      ...baseCtx,
      versions: [version(1)],
      ratings: [rating("v1", "opus", 70), rating("v1", "sonnet", 90)],
    });
    expect(rows.find((r) => r.modelId === "sonnet")!.isBestForVersion).toBe(true);
    expect(rows.find((r) => r.modelId === "opus")!.isBestForVersion).toBe(false);
  });

  it("computes Δ vs baseline on the same model", () => {
    const rows = buildVersionRows({
      ...baseCtx,
      versions: [version(2), version(1)],
      ratings: [rating("v2", "opus", 86), rating("v1", "opus", 79)],
      baselineVersionId: "v1",
    });
    const v2opus = rows.find((r) => r.key === "v2::opus")!;
    expect(v2opus.deltaVsBaseline).toBe(7);
    // baseline's own row has no delta
    const v1opus = rows.find((r) => r.key === "v1::opus")!;
    expect(v1opus.deltaVsBaseline).toBeNull();
  });
});
