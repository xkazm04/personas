/**
 * useRecipeStarters - a slow answer must never outlive the question.
 *
 * The match fires 300ms after typing settles. If the operator then shortens
 * the intent below MIN_LEN while that call is in flight, the shortlist is
 * cleared - and the late answer for the old intent must not paint it back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const matchMock = vi.fn();
vi.mock("@/api/recipes/recipes", () => ({
  matchRecipesToIntent: (...args: unknown[]) => matchMock(...args),
}));

import { useRecipeStarters } from "../useRecipeStarters";

const LONG = "summarize my support inbox every morning";

beforeEach(() => {
  vi.useFakeTimers();
  matchMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useRecipeStarters", () => {
  it("returns matches for an intent past MIN_LEN after the debounce", async () => {
    matchMock.mockResolvedValue([{ recipeId: "r1" }]);
    const { result } = renderHook(({ intent }) => useRecipeStarters(intent), {
      initialProps: { intent: LONG },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current).toEqual([{ recipeId: "r1" }]);
  });

  it("drops a late answer once the intent fell below MIN_LEN", async () => {
    let resolve!: (v: unknown) => void;
    matchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result, rerender } = renderHook(({ intent }) => useRecipeStarters(intent), {
      initialProps: { intent: LONG },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(matchMock).toHaveBeenCalledTimes(1);

    rerender({ intent: "short" });
    expect(result.current).toEqual([]);

    await act(async () => {
      resolve([{ recipeId: "stale" }]);
      await Promise.resolve();
    });
    expect(result.current).toEqual([]);
  });
});
