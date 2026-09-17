import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { DriveMeta } from "@/api/drive";

const toastCatchSpy = vi.fn();
vi.mock("@/lib/silentCatch", () => ({
  silentCatch: () => () => {},
  toastCatch: (context: string) => (err: unknown) => toastCatchSpy(context, err),
}));

vi.mock("@/api/drive", () => ({
  DRIVE_TAG_COLORS: ["red", "orange", "yellow", "green", "blue", "purple", "gray"],
  driveLabelId: (c: string) => `label:${c}`,
  driveMetaGet: vi.fn(),
  driveTagsSet: vi.fn(),
  driveTagUpsert: vi.fn(),
  driveTagDelete: vi.fn(),
}));

import * as api from "@/api/drive";
import { useDriveMeta } from "../useDriveMeta";

const red = { id: "label:red", name: "red", color: "red" as const, builtin: true };
const work = { id: "tag:1", name: "Work", color: "blue" as const, builtin: false };
const loaded: DriveMeta = {
  version: 1,
  vocab: [red, work],
  labels: { "a.txt": ["tag:1", "label:red"] },
  warning: null,
};

describe("useDriveMeta", () => {
  beforeEach(() => {
    vi.mocked(api.driveMetaGet).mockReset();
    vi.mocked(api.driveTagsSet).mockReset();
    vi.mocked(api.driveTagDelete).mockReset();
    toastCatchSpy.mockClear();
  });

  it("loads on mount and resolves tags in vocab order", async () => {
    vi.mocked(api.driveMetaGet).mockResolvedValue(loaded);
    const { result } = renderHook(() => useDriveMeta());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.meta).toEqual(loaded);
    expect(result.current.tagsFor("a.txt").map((t) => t.id)).toEqual(["label:red", "tag:1"]);
    expect(result.current.tagsFor("missing")).toEqual([]);
  });

  it("applies setTags optimistically and rolls back on rejection", async () => {
    vi.mocked(api.driveMetaGet).mockResolvedValue(loaded);
    let reject!: (e: unknown) => void;
    vi.mocked(api.driveTagsSet).mockReturnValue(
      new Promise<DriveMeta>((_, r) => {
        reject = r;
      }),
    );
    const { result } = renderHook(() => useDriveMeta());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.setTags("b.txt", ["tag:1"]);
    });
    expect(result.current.tagsFor("b.txt").map((t) => t.id)).toEqual(["tag:1"]);
    expect(api.driveTagsSet).toHaveBeenCalledWith("b.txt", ["tag:1"]);

    await act(async () => {
      reject(new Error("disk full"));
      await pending;
    });
    expect(result.current.tagsFor("b.txt")).toEqual([]);
    expect(toastCatchSpy).toHaveBeenCalledWith("drive:tags", expect.any(Error));
  });

  it("refuses to delete a builtin label", async () => {
    vi.mocked(api.driveMetaGet).mockResolvedValue(loaded);
    const { result } = renderHook(() => useDriveMeta());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.deleteTag("label:red"));
    expect(api.driveTagDelete).not.toHaveBeenCalled();
    expect(result.current.meta?.vocab).toHaveLength(2);
  });

  it("falls back to the seven builtin labels and makes writes no-ops when the backend rejects", async () => {
    vi.mocked(api.driveMetaGet).mockRejectedValue(new Error("command not found"));
    const { result } = renderHook(() => useDriveMeta());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.meta?.vocab.map((t) => t.id)).toEqual([
      "label:red", "label:orange", "label:yellow", "label:green", "label:blue", "label:purple", "label:gray",
    ]);
    expect(result.current.meta?.vocab.every((t) => t.builtin)).toBe(true);

    await act(() => result.current.toggleTag("x.png", "label:blue"));
    expect(result.current.tagsFor("x.png").map((t) => t.id)).toEqual(["label:blue"]);
    expect(api.driveTagsSet).not.toHaveBeenCalled();
    expect(toastCatchSpy).not.toHaveBeenCalled();
  });
});
