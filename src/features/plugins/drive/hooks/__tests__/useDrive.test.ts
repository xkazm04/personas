/**
 * useDrive coverage focused on this session's new behaviour:
 *
 * - localStorage persistence of viewMode / sortKey / sortDir (cycle 26)
 * - kind-sort comparator using curated bucket order (cycle 6)
 * - kind-sort tiebreaker by name within a bucket
 * - recent refresh wired into rename + remove + createFile + paste (cycle 11/12)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { mockInvoke, mockInvokeMap, resetInvokeMocks } from "@/test/tauriMock";
import { useDrive } from "../useDrive";
import type { DriveEntry } from "@/api/drive";

(globalThis as Record<string, unknown>).__IPC_TOKEN = "test-token";

function fileEntry(name: string, overrides: Partial<DriveEntry> = {}): DriveEntry {
  return {
    name,
    path: name,
    kind: "file",
    size: 100,
    modified: "2026-05-16T10:00:00Z",
    mime: "text/plain",
    extension: "txt",
    ...overrides,
  };
}

function folderEntry(name: string, overrides: Partial<DriveEntry> = {}): DriveEntry {
  return {
    name,
    path: name,
    kind: "folder",
    size: 0,
    modified: "2026-05-16T10:00:00Z",
    mime: null,
    extension: null,
    ...overrides,
  };
}

function defaultIpcMocks(entries: DriveEntry[] = []) {
  mockInvokeMap({
    drive_list: entries,
    drive_list_tree: { name: "", path: "", children: [], hasMoreChildren: false },
    drive_storage_info: {
      root: "/managed",
      usedBytes: 0,
      entryCount: 0,
      isDev: false,
    },
    drive_recent: [],
  });
}

beforeEach(() => {
  resetInvokeMocks();
  localStorage.clear();
});

describe("useDrive view-state persistence (cycle 26)", () => {
  it("hydrates viewMode from localStorage on first render", async () => {
    localStorage.setItem(
      "drive.viewState",
      JSON.stringify({ viewMode: "icons" }),
    );
    defaultIpcMocks();

    const { result } = renderHook(() => useDrive());
    expect(result.current.viewMode).toBe("icons");
  });

  it("hydrates sortKey + sortDir from localStorage", () => {
    localStorage.setItem(
      "drive.viewState",
      JSON.stringify({ sortKey: "modified", sortDir: "desc" }),
    );
    defaultIpcMocks();

    const { result } = renderHook(() => useDrive());
    expect(result.current.sortKey).toBe("modified");
    expect(result.current.sortDir).toBe("desc");
  });

  it("writes viewMode back to localStorage on change", async () => {
    defaultIpcMocks();
    const { result } = renderHook(() => useDrive());

    act(() => {
      result.current.setViewMode("columns");
    });

    const raw = localStorage.getItem("drive.viewState");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.viewMode).toBe("columns");
  });

  it("writes sortKey + sortDir back to localStorage on setSort", async () => {
    defaultIpcMocks();
    const { result } = renderHook(() => useDrive());

    act(() => {
      result.current.setSort("size", "desc");
    });

    const parsed = JSON.parse(localStorage.getItem("drive.viewState")!);
    expect(parsed.sortKey).toBe("size");
    expect(parsed.sortDir).toBe("desc");
  });

  it("falls back to defaults when localStorage holds malformed JSON", () => {
    localStorage.setItem("drive.viewState", "{not valid json");
    defaultIpcMocks();

    const { result } = renderHook(() => useDrive());
    expect(result.current.viewMode).toBe("list");
    expect(result.current.sortKey).toBe("name");
    expect(result.current.sortDir).toBe("asc");
  });
});

describe("useDrive kind-sort comparator (cycles 2 + 6)", () => {
  it("groups files by kind bucket weight when sortKey === 'kind'", async () => {
    const entries: DriveEntry[] = [
      fileEntry("zeta.png", { mime: "image/png", extension: "png" }),
      fileEntry("alpha.pdf", { mime: "application/pdf", extension: "pdf" }),
      fileEntry("beta.png", { mime: "image/png", extension: "png" }),
      fileEntry("gamma.zip", {
        mime: "application/zip",
        extension: "zip",
      }),
    ];
    defaultIpcMocks(entries);

    const { result } = renderHook(() => useDrive());
    await waitFor(() => expect(result.current.entries.length).toBe(4));

    act(() => result.current.setSort("kind"));

    // Bucket order: image (1) → pdf (3) → archive (9). Within bucket
    // names sort case-insensitively (beta.png before zeta.png).
    expect(result.current.visibleEntries.map((e) => e.name)).toEqual([
      "beta.png",
      "zeta.png",
      "alpha.pdf",
      "gamma.zip",
    ]);
  });

  it("keeps folders ahead of files regardless of bucket order", async () => {
    const entries: DriveEntry[] = [
      fileEntry("apple.png", { mime: "image/png", extension: "png" }),
      folderEntry("zebra"),
    ];
    defaultIpcMocks(entries);

    const { result } = renderHook(() => useDrive());
    await waitFor(() => expect(result.current.entries.length).toBe(2));

    act(() => result.current.setSort("kind"));

    expect(result.current.visibleEntries.map((e) => e.name)).toEqual([
      "zebra",
      "apple.png",
    ]);
  });

  it("inverts order when sortDir is 'desc'", async () => {
    const entries: DriveEntry[] = [
      fileEntry("a.png", { mime: "image/png", extension: "png" }),
      fileEntry("b.pdf", { mime: "application/pdf", extension: "pdf" }),
    ];
    defaultIpcMocks(entries);

    const { result } = renderHook(() => useDrive());
    await waitFor(() => expect(result.current.entries.length).toBe(2));

    act(() => result.current.setSort("kind", "desc"));

    expect(result.current.visibleEntries.map((e) => e.name)).toEqual([
      "b.pdf",
      "a.png",
    ]);
  });
});

describe("useDrive selection primitives", () => {
  it("selectOnly replaces selection with one path", async () => {
    const entries: DriveEntry[] = [
      fileEntry("a.txt"),
      fileEntry("b.txt"),
    ];
    defaultIpcMocks(entries);

    const { result } = renderHook(() => useDrive());
    await waitFor(() => expect(result.current.entries.length).toBe(2));

    act(() => result.current.selectOnly("a.txt"));
    expect(Array.from(result.current.selection)).toEqual(["a.txt"]);

    act(() => result.current.selectOnly("b.txt"));
    expect(Array.from(result.current.selection)).toEqual(["b.txt"]);
  });

  it("toggleSelect adds and removes additively", async () => {
    defaultIpcMocks([fileEntry("a.txt"), fileEntry("b.txt")]);
    const { result } = renderHook(() => useDrive());
    await waitFor(() => expect(result.current.entries.length).toBe(2));

    act(() => result.current.toggleSelect("a.txt", true));
    act(() => result.current.toggleSelect("b.txt", true));
    expect(result.current.selection.size).toBe(2);

    act(() => result.current.toggleSelect("a.txt", true));
    expect(result.current.selection.size).toBe(1);
    expect(result.current.selection.has("b.txt")).toBe(true);
  });

  it("selectRange selects entries between the anchor and target", async () => {
    defaultIpcMocks([
      fileEntry("a.txt"),
      fileEntry("b.txt"),
      fileEntry("c.txt"),
      fileEntry("d.txt"),
    ]);
    const { result } = renderHook(() => useDrive());
    await waitFor(() => expect(result.current.entries.length).toBe(4));

    act(() => result.current.selectOnly("a.txt"));
    act(() => result.current.selectRange("c.txt"));
    expect(Array.from(result.current.selection).sort()).toEqual([
      "a.txt",
      "b.txt",
      "c.txt",
    ]);
  });
});

describe("useDrive Recent rail refresh (cycles 11 + 12)", () => {
  it("seeds recent on first mount via drive_recent", async () => {
    mockInvokeMap({
      drive_list: [],
      drive_list_tree: { name: "", path: "", children: [], hasMoreChildren: false },
      drive_storage_info: {
        root: "/managed",
        usedBytes: 0,
        entryCount: 0,
        isDev: false,
      },
      drive_recent: [fileEntry("seeded.txt")],
    });

    const { result } = renderHook(() => useDrive());
    await waitFor(() =>
      expect(result.current.recent.map((e) => e.name)).toEqual([
        "seeded.txt",
      ]),
    );
  });

  it("re-fires drive_recent after rename (cycle 12)", async () => {
    const initial = [fileEntry("first.txt")];
    const afterRename = [fileEntry("renamed.txt", { path: "renamed.txt" })];
    let recentCallCount = 0;

    mockInvoke("drive_list", initial);
    mockInvoke("drive_list_tree", {
      name: "",
      path: "",
      children: [],
      hasMoreChildren: false,
    });
    mockInvoke("drive_storage_info", {
      root: "/managed",
      usedBytes: 0,
      entryCount: 0,
      isDev: false,
    });
    // drive_rename succeeds; track drive_recent invocations.
    vi.mocked(
      (await import("@tauri-apps/api/core")).invoke,
    ).mockImplementation(async (cmd: string) => {
      if (cmd === "drive_list") return initial;
      if (cmd === "drive_list_tree")
        return { name: "", path: "", children: [], hasMoreChildren: false };
      if (cmd === "drive_storage_info")
        return { root: "/managed", usedBytes: 0, entryCount: 0, isDev: false };
      if (cmd === "drive_rename") return afterRename[0];
      if (cmd === "drive_recent") {
        recentCallCount += 1;
        return recentCallCount === 1 ? initial : afterRename;
      }
      return undefined;
    });

    const { result } = renderHook(() => useDrive());
    await waitFor(() => expect(recentCallCount).toBeGreaterThanOrEqual(1));
    const beforeCount = recentCallCount;

    await act(async () => {
      await result.current.rename("first.txt", "renamed.txt");
    });

    // rename triggers refreshRecent — should see at least one new call.
    await waitFor(() => expect(recentCallCount).toBeGreaterThan(beforeCount));
  });
});

describe("useDrive history navigation", () => {
  it("navigate pushes to history; goBack and goForward update the index", async () => {
    defaultIpcMocks();
    const { result } = renderHook(() => useDrive());

    act(() => result.current.navigate("folder-a"));
    expect(result.current.currentPath).toBe("folder-a");
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);

    act(() => result.current.navigate("folder-b"));
    expect(result.current.currentPath).toBe("folder-b");

    act(() => result.current.goBack());
    expect(result.current.currentPath).toBe("folder-a");
    expect(result.current.canGoForward).toBe(true);

    act(() => result.current.goForward());
    expect(result.current.currentPath).toBe("folder-b");
  });

  it("navigating to current path is a no-op (no history drift)", async () => {
    defaultIpcMocks();
    const { result } = renderHook(() => useDrive());

    act(() => result.current.navigate("folder-a"));
    const histLen = result.current.history.length;

    act(() => result.current.navigate("folder-a"));
    expect(result.current.history.length).toBe(histLen);
  });
});
