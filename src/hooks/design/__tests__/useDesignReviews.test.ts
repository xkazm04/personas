import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDesignReviews } from "../template/useDesignReviews";
import { mockInvokeMap, resetInvokeMocks, mockInvokeError } from "@/test/tauriMock";
import { clearSWRCache } from "@/lib/utils/staleWhileRevalidate";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";

// Set IPC token so invokeWithTimeout doesn't enter infinite token-wait loop
(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

function makeReview(overrides: Partial<PersonaDesignReview> = {}): PersonaDesignReview {
  return {
    id: "r-1",
    test_case_id: "tc-1",
    test_case_name: "Test Case 1",
    instruction: "Do something",
    status: "passed",
    structural_score: 0.85,
    semantic_score: 0.9,
    connectors_used: null,
    trigger_types: null,
    design_result: null,
    structural_evaluation: null,
    semantic_evaluation: null,
    test_run_id: "run-1",
    had_references: null,
    suggested_adjustment: null,
    adjustment_generation: null,
    use_case_flows: null,
    reviewed_at: "2025-01-01T00:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    adoption_count: 0,
    last_adopted_at: null,
    category: null,
    ...overrides,
  };
}

describe("useDesignReviews", () => {
  beforeEach(() => {
    resetInvokeMocks();
    clearSWRCache();
  });

  it("fetches reviews on mount", async () => {
    const reviews = [makeReview({ id: "r-1" }), makeReview({ id: "r-2" })];
    mockInvokeMap({ list_design_reviews: reviews });

    const { result } = renderHook(() => useDesignReviews());

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.reviews).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("sets error when fetch fails", async () => {
    mockInvokeError("list_design_reviews", "Network error");

    const { result } = renderHook(() => useDesignReviews());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.reviews).toEqual([]);
  });

  it("startNewReview sets error when no personaId provided", async () => {
    mockInvokeMap({ list_design_reviews: [] });

    const { result } = renderHook(() => useDesignReviews());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.startNewReview(undefined);
    });

    expect(result.current.error).toBe("No persona selected for review");
    expect(result.current.isRunning).toBe(false);
  });

  it("cancelReview stops the run", async () => {
    mockInvokeMap({ list_design_reviews: [] });

    const { result } = renderHook(() => useDesignReviews());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.cancelReview();
    });

    expect(result.current.isRunning).toBe(false);
    expect(result.current.runLines).toEqual(["[Cancelled by user]"]);
  });

  it("deleteReview removes review from list", async () => {
    const reviews = [makeReview({ id: "r-1" }), makeReview({ id: "r-2" })];
    mockInvokeMap({
      list_design_reviews: reviews,
      delete_design_review: undefined,
    });

    const { result } = renderHook(() => useDesignReviews());

    await waitFor(() => {
      expect(result.current.reviews).toHaveLength(2);
    });

    await act(async () => {
      await result.current.deleteReview("r-1");
    });

    expect(result.current.reviews).toHaveLength(1);
    expect(result.current.reviews[0]?.id).toBe("r-2");
  });

  it("deleteReview sets error on failure", async () => {
    mockInvokeMap({
      list_design_reviews: [makeReview()],
      import_design_review: undefined,
      delete_design_review: undefined,
    });

    const { result } = renderHook(() => useDesignReviews());

    await waitFor(() => {
      expect(result.current.reviews).toHaveLength(1);
    });

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "delete_design_review") return Promise.reject(new Error("Delete failed"));
      if (cmd === "list_design_reviews") return Promise.resolve([makeReview()] as never);
      return Promise.resolve(undefined as never);
    });

    await act(async () => {
      await result.current.deleteReview("r-1");
    });

    expect(result.current.error).toBe("Delete failed");
  });
});
