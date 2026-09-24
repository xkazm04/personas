/** usePromotePreview: fetch the read-only promote preview while the draft sits
 *  at test_complete, re-fetch when the operator changes the capability
 *  exclusions, and never call once the draft is promoted.
 *  scan-sweep challenge-2026-09-23, commands-design B.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import type { PromotePreview } from "@/lib/bindings/PromotePreview";

const previewPromoteBuildDraft = vi.fn<
  (sessionId: string, personaId: string, excluded?: string[]) => Promise<PromotePreview>
>();
vi.mock("@/api/agents/buildSession", () => ({
  previewPromoteBuildDraft: (sessionId: string, personaId: string, excluded?: string[]) =>
    previewPromoteBuildDraft(sessionId, personaId, excluded),
}));

import { usePromotePreview, type PromotePreviewArgs } from "../usePromotePreview";

const PREVIEW: PromotePreview = { promotable: true, refusal: null, setup: null, nextFires: [] };

function args(over: Partial<PromotePreviewArgs> = {}): PromotePreviewArgs {
  return { sessionId: "s1", personaId: "p1", phase: "test_complete", excludedIds: [], ...over };
}

describe("usePromotePreview", () => {
  beforeEach(() => {
    previewPromoteBuildDraft.mockReset();
    previewPromoteBuildDraft.mockResolvedValue(PREVIEW);
  });

  it("fetches once at test_complete and exposes the preview", async () => {
    const { result } = renderHook(() => usePromotePreview(args()));
    await waitFor(() => expect(result.current).toEqual(PREVIEW));
    expect(previewPromoteBuildDraft).toHaveBeenCalledTimes(1);
    expect(previewPromoteBuildDraft).toHaveBeenCalledWith("s1", "p1", []);
  });

  it("re-fetches with the new exclusion list when a capability is removed", async () => {
    const { rerender } = renderHook((p: PromotePreviewArgs) => usePromotePreview(p), {
      initialProps: args(),
    });
    await waitFor(() => expect(previewPromoteBuildDraft).toHaveBeenCalledTimes(1));
    rerender(args({ excludedIds: ["uc_b"] }));
    await waitFor(() => expect(previewPromoteBuildDraft).toHaveBeenCalledTimes(2));
    expect(previewPromoteBuildDraft).toHaveBeenLastCalledWith("s1", "p1", ["uc_b"]);
    // Same list again (a new array with the same ids) is not a new question.
    rerender(args({ excludedIds: ["uc_b"] }));
    await new Promise((r) => setTimeout(r, 0));
    expect(previewPromoteBuildDraft).toHaveBeenCalledTimes(2);
  });

  it("makes no call once the draft is promoted", async () => {
    const { result } = renderHook(() => usePromotePreview(args({ phase: "promoted" })));
    await new Promise((r) => setTimeout(r, 0));
    expect(previewPromoteBuildDraft).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("a failed preview resolves to null rather than throwing", async () => {
    previewPromoteBuildDraft.mockRejectedValue(new Error("ipc down"));
    const { result } = renderHook(() => usePromotePreview(args()));
    await waitFor(() => expect(previewPromoteBuildDraft).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });
});
