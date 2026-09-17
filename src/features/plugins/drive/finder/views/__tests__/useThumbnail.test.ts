import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import type { DriveEntry } from "@/api/drive";
import { driveThumbnail } from "@/api/drive";
import { resetThumbCache } from "../thumbCache";
import { useThumbnail } from "../useThumbnail";

vi.mock("@/api/drive", () => ({
  driveThumbnail: vi.fn(),
}));

const mockThumb = vi.mocked(driveThumbnail);

function entry(overrides: Partial<DriveEntry> = {}): DriveEntry {
  return {
    name: "photo.jpg",
    path: "pics/photo.jpg",
    kind: "file",
    size: 1234,
    modified: "2026-09-17T00:00:00Z",
    mime: "image/jpeg",
    extension: "jpg",
    ...overrides,
  };
}

// jsdom has no IntersectionObserver: the hook then asks immediately, which is
// the branch these tests exercise. No element is attached to the ref either.
const ref = { current: null };

describe("useThumbnail", () => {
  beforeEach(() => {
    resetThumbCache();
    mockThumb.mockReset();
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:thumb-${++n}`);
    URL.revokeObjectURL = vi.fn();
  });

  it("resolves an image to an object URL", async () => {
    mockThumb.mockResolvedValue(new ArrayBuffer(8));
    const { result } = renderHook(() => useThumbnail(entry(), 96, ref));
    expect(result.current).toEqual({ url: null, failed: false });
    await waitFor(() => expect(result.current.url).toBe("blob:thumb-1"));
    expect(result.current.failed).toBe(false);
    expect(mockThumb).toHaveBeenCalledWith("pics/photo.jpg", 96);
  });

  it("memoises a rejection: failed, and never re-asks the backend", async () => {
    mockThumb.mockRejectedValue(new Error("thumbnailer not built yet"));
    const first = renderHook(() => useThumbnail(entry(), 96, ref));
    await waitFor(() => expect(first.result.current.failed).toBe(true));
    expect(first.result.current.url).toBeNull();
    expect(mockThumb).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useThumbnail(entry(), 96, ref));
    expect(second.result.current).toEqual({ url: null, failed: true });
    await Promise.resolve();
    expect(mockThumb).toHaveBeenCalledTimes(1);
  });

  it("serves a second mount from the cache without another call", async () => {
    mockThumb.mockResolvedValue(new ArrayBuffer(8));
    const first = renderHook(() => useThumbnail(entry(), 256, ref));
    await waitFor(() => expect(first.result.current.url).toBe("blob:thumb-1"));
    const second = renderHook(() => useThumbnail(entry(), 256, ref));
    expect(second.result.current.url).toBe("blob:thumb-1");
    expect(mockThumb).toHaveBeenCalledTimes(1);
  });

  it("keys by edge so each size is its own request", async () => {
    mockThumb.mockResolvedValue(new ArrayBuffer(8));
    const a = renderHook(() => useThumbnail(entry(), 96, ref));
    const b = renderHook(() => useThumbnail(entry(), 1024, ref));
    await waitFor(() => expect(a.result.current.url).not.toBeNull());
    await waitFor(() => expect(b.result.current.url).not.toBeNull());
    expect(mockThumb).toHaveBeenCalledTimes(2);
  });

  it("never asks for a non-image", async () => {
    const { result } = renderHook(() =>
      useThumbnail(entry({ mime: "text/plain", name: "a.txt", path: "a.txt" }), 96, ref),
    );
    await Promise.resolve();
    expect(result.current).toEqual({ url: null, failed: false });
    expect(mockThumb).not.toHaveBeenCalled();
  });

  it("never asks for a folder", () => {
    renderHook(() => useThumbnail(entry({ kind: "folder", mime: null }), 96, ref));
    expect(mockThumb).not.toHaveBeenCalled();
  });
});
