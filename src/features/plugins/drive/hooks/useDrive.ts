import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DriveEntry,
  DriveSearchHit,
  DriveStorageInfo,
  DriveTreeNode,
  driveCopy,
  driveDelete,
  driveList,
  driveListTree,
  driveMkdir,
  driveMove,
  driveParentPath,
  driveRename,
  driveSearch,
  driveStorageInfo,
  driveWriteText,
} from "@/api/drive";
import { toastCatch } from "@/lib/silentCatch";
import { visualForEntry } from "../designTokens";

export type ClipboardMode = "copy" | "cut";
export type ViewMode = "list" | "icons" | "columns";
export type SortKey = "name" | "size" | "modified" | "kind";
export type SortDir = "asc" | "desc";

/**
 * Run async tasks with a fixed concurrency cap. Each Tauri invoke crosses an
 * IPC boundary (~5–10ms minimum), so a sequential await loop on N items
 * compounds linearly. A small cap lets multiple ops fly in parallel without
 * blowing up the IPC thread pool.
 */
const BULK_OP_CONCURRENCY = 8;
async function runBulk<T>(
  items: T[],
  task: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length <= 1) {
    for (const item of items) await task(item);
    return;
  }
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(BULK_OP_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) break;
        await task(next);
      }
    },
  );
  await Promise.all(workers);
}

export interface DriveClipboard {
  mode: ClipboardMode;
  paths: string[];
}

export interface UseDriveResult {
  // Navigation
  currentPath: string;
  history: string[];
  historyIndex: number;
  canGoBack: boolean;
  canGoForward: boolean;
  navigate: (path: string) => void;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;

  // Entries
  entries: DriveEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  tree: DriveTreeNode | null;
  refreshTree: () => void;

  // Selection
  selection: Set<string>;
  isSelected: (path: string) => boolean;
  selectOnly: (path: string) => void;
  toggleSelect: (path: string, additive: boolean) => void;
  selectRange: (path: string) => void;
  clearSelection: () => void;
  selectAll: () => void;

  // Sort + filter
  sortKey: SortKey;
  sortDir: SortDir;
  setSort: (key: SortKey, dir?: SortDir) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  visibleEntries: DriveEntry[];

  // View mode
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;

  // Clipboard
  clipboard: DriveClipboard | null;
  copySelection: () => void;
  cutSelection: () => void;
  pasteHere: () => Promise<void>;

  // Mutations
  createFolder: (name: string) => Promise<void>;
  createFile: (name: string, content?: string) => Promise<void>;
  rename: (path: string, newName: string) => Promise<void>;
  remove: (paths: string[]) => Promise<void>;
  move: (src: string, dst: string) => Promise<void>;

  // Storage meter
  storage: DriveStorageInfo | null;
  refreshStorage: () => void;

  // Highlight recent writes for ~1.2s
  recentlyWritten: Set<string>;

  /**
   * Read previously-loaded entries for a path without re-fetching. Used by
   * the columns view to avoid a fresh IPC call for every parent column the
   * user has already navigated through. Returns null if the path was never
   * cached (caller should fall back to driveList).
   */
  cachedEntriesFor: (path: string) => DriveEntry[] | null;

  // Recursive search across the entire managed drive. The local
  // `searchQuery` filter is per-folder; when it produces no results, the
  // UI escalates to this — a backend walk via drive_search.
  recursiveResults: DriveSearchHit[] | null;
  recursiveQuery: string | null;
  recursiveLoading: boolean;
  runRecursiveSearch: () => Promise<void>;
  clearRecursiveSearch: () => void;
}

/**
 * Master hook for the Drive Finder UI. Owns navigation history, entry cache,
 * selection, clipboard, sort/filter/view preferences, and all mutations. The
 * Finder components should treat this as their single source of truth.
 */
export function useDrive(initialPath: string = ""): UseDriveResult {
  const [history, setHistory] = useState<string[]>([initialPath]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const currentPath = history[historyIndex] ?? "";

  const [entries, setEntries] = useState<DriveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<DriveTreeNode | null>(null);
  const [storage, setStorage] = useState<DriveStorageInfo | null>(null);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [clipboard, setClipboard] = useState<DriveClipboard | null>(null);
  const [recentlyWritten, setRecentlyWritten] = useState<Set<string>>(
    new Set(),
  );
  const [recursiveResults, setRecursiveResults] = useState<DriveSearchHit[] | null>(null);
  const [recursiveQuery, setRecursiveQuery] = useState<string | null>(null);
  const [recursiveLoading, setRecursiveLoading] = useState(false);

  const lastAnchorRef = useRef<string | null>(null);
  const flashTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Cache of path → entries observed via refresh(). Lets the columns view
  // re-render parent columns from memory instead of re-issuing driveList per
  // visited level. Mutations invalidate touched paths.
  const pathCacheRef = useRef<Map<string, DriveEntry[]>>(new Map());

  // Clear any pending flash timers on unmount so they don't setState on a
  // dead component (~1.2s window after a mutation).
  useEffect(() => {
    const timers = flashTimersRef.current;
    return () => {
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
    };
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    driveList(currentPath)
      .then((list) => {
        setEntries(list);
        pathCacheRef.current.set(currentPath, list);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, [currentPath]);

  const cachedEntriesFor = useCallback((path: string): DriveEntry[] | null => {
    return pathCacheRef.current.get(path) ?? null;
  }, []);

  const refreshTree = useCallback(() => {
    driveListTree("", 4)
      .then(setTree)
      .catch(toastCatch("drive:listTree"));
  }, []);

  const refreshStorage = useCallback(() => {
    driveStorageInfo().then(setStorage).catch(toastCatch("drive:storageInfo"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    refreshTree();
    refreshStorage();
  }, [refreshTree, refreshStorage]);

  // Clear selection on navigation.
  useEffect(() => {
    setSelection(new Set());
    lastAnchorRef.current = null;
  }, [currentPath]);

  // Recursive search — escalation path when the local folder filter has
  // no hits. Driven by the consumer (DriveFileList CTA), not auto-fired.
  const runRecursiveSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setRecursiveLoading(true);
    try {
      const results = await driveSearch(q);
      setRecursiveResults(results);
      setRecursiveQuery(q);
    } catch (e) {
      toastCatch("drive:search")(e);
    } finally {
      setRecursiveLoading(false);
    }
  }, [searchQuery]);

  const clearRecursiveSearch = useCallback(() => {
    setRecursiveResults(null);
    setRecursiveQuery(null);
  }, []);

  // Drop recursive results when the user changes path or clears the query —
  // the results are tied to "what was the user searching for at the
  // moment of escalation," and stale results would mislead the next view.
  useEffect(() => {
    setRecursiveResults(null);
    setRecursiveQuery(null);
  }, [currentPath]);

  useEffect(() => {
    if (searchQuery.trim() === "") {
      setRecursiveResults(null);
      setRecursiveQuery(null);
    }
  }, [searchQuery]);

  // Navigation
  const navigate = useCallback(
    (path: string) => {
      // Navigating to the current path is a no-op — don't push history or
      // advance the index. Without this guard the index would drift past the
      // array length when a user clicks the current breadcrumb (or any code
      // path that re-navigates to the same location).
      const truncated = history.slice(0, historyIndex + 1);
      if (truncated[truncated.length - 1] === path) return;
      setHistory([...truncated, path]);
      setHistoryIndex(truncated.length);
    },
    [history, historyIndex],
  );

  const goBack = useCallback(() => {
    setHistoryIndex((i) => Math.max(0, i - 1));
  }, []);

  const goForward = useCallback(() => {
    setHistoryIndex((i) => Math.min(history.length - 1, i + 1));
  }, [history.length]);

  const goUp = useCallback(() => {
    const parent = driveParentPath(currentPath);
    if (parent !== currentPath) navigate(parent);
  }, [currentPath, navigate]);

  // Selection
  const isSelected = useCallback((path: string) => selection.has(path), [selection]);

  const selectOnly = useCallback((path: string) => {
    setSelection(new Set([path]));
    lastAnchorRef.current = path;
  }, []);

  const toggleSelect = useCallback((path: string, additive: boolean) => {
    let added = true;
    setSelection((prev) => {
      if (!additive) return new Set([path]);
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
        added = false;
      } else {
        next.add(path);
      }
      return next;
    });
    // Only update the anchor when the path was added (or replaced the selection).
    // Anchoring on a deselect would make the next shift-click measure range from
    // the just-removed item — surprising behavior.
    if (added) lastAnchorRef.current = path;
  }, []);

  const selectRange = useCallback(
    (path: string) => {
      const anchor = lastAnchorRef.current;
      if (!anchor) {
        selectOnly(path);
        return;
      }
      const indexOf = (p: string) => entries.findIndex((e) => e.path === p);
      const a = indexOf(anchor);
      const b = indexOf(path);
      if (a < 0 || b < 0) {
        selectOnly(path);
        return;
      }
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const next = new Set<string>();
      for (let i = lo; i <= hi; i++) {
        const e = entries[i];
        if (e) next.add(e.path);
      }
      setSelection(next);
    },
    [entries, selectOnly],
  );

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const selectAll = useCallback(() => {
    setSelection(new Set(entries.map((e) => e.path)));
  }, [entries]);

  // Sort + search
  const setSort = useCallback(
    (key: SortKey, dir?: SortDir) => {
      setSortKey(key);
      setSortDir(
        dir ?? (key === sortKey ? (sortDir === "asc" ? "desc" : "asc") : "asc"),
      );
    },
    [sortKey, sortDir],
  );

  const visibleEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => e.name.toLowerCase().includes(q))
      : entries;
    const sorted = [...filtered].sort((a, b) => {
      // Folders first regardless of sort key.
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case "size":
          cmp = a.size - b.size;
          break;
        case "modified":
          cmp = a.modified.localeCompare(b.modified);
          break;
        case "kind": {
          // Group by resolved kind bucket (image / code / data / …) — same
          // mapping the Kind column displays. Within a bucket fall back to
          // case-insensitive name so files inside the group are scannable.
          // The previous extension-only compare interleaved unrelated kinds
          // (.css next to .json next to .png) and made the "Kind" sort
          // inconsistent with the column it's named after.
          const ak = visualForEntry(a).labelKey;
          const bk = visualForEntry(b).labelKey;
          cmp = ak.localeCompare(bk);
          if (cmp === 0)
            cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [entries, searchQuery, sortKey, sortDir]);

  // Clipboard
  const copySelection = useCallback(() => {
    if (selection.size === 0) return;
    setClipboard({ mode: "copy", paths: Array.from(selection) });
  }, [selection]);

  const cutSelection = useCallback(() => {
    if (selection.size === 0) return;
    setClipboard({ mode: "cut", paths: Array.from(selection) });
  }, [selection]);

  const flashWrite = useCallback((path: string) => {
    setRecentlyWritten((prev) => new Set(prev).add(path));
    const id = setTimeout(() => {
      flashTimersRef.current.delete(id);
      setRecentlyWritten((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }, 1200);
    flashTimersRef.current.add(id);
  }, []);

  const pasteHere = useCallback(async () => {
    if (!clipboard) return;
    const mode = clipboard.mode;
    await runBulk(clipboard.paths, async (src) => {
      const base = src.split("/").pop() ?? "file";
      const dst = currentPath ? `${currentPath}/${base}` : base;
      try {
        const entry = mode === "copy"
          ? await driveCopy(src, dst)
          : await driveMove(src, dst);
        flashWrite(entry.path);
      } catch (e) {
        toastCatch("drive:paste")(e);
      }
    });
    if (mode === "cut") setClipboard(null);
    refresh();
    refreshTree();
    refreshStorage();
  }, [clipboard, currentPath, refresh, refreshTree, refreshStorage, flashWrite]);

  // Mutations
  const createFolder = useCallback(
    async (name: string) => {
      const rel = currentPath ? `${currentPath}/${name}` : name;
      try {
        const entry = await driveMkdir(rel);
        flashWrite(entry.path);
      } catch (e) {
        toastCatch("drive:mkdir")(e);
        return;
      }
      refresh();
      refreshTree();
    },
    [currentPath, refresh, refreshTree, flashWrite],
  );

  const createFile = useCallback(
    async (name: string, content: string = "") => {
      const rel = currentPath ? `${currentPath}/${name}` : name;
      try {
        const entry = await driveWriteText(rel, content);
        flashWrite(entry.path);
      } catch (e) {
        toastCatch("drive:createFile")(e);
        return;
      }
      refresh();
      refreshStorage();
    },
    [currentPath, refresh, refreshStorage, flashWrite],
  );

  const rename = useCallback(
    async (path: string, newName: string) => {
      try {
        const entry = await driveRename(path, newName);
        flashWrite(entry.path);
      } catch (e) {
        toastCatch("drive:rename")(e);
        return;
      }
      refresh();
      refreshTree();
    },
    [refresh, refreshTree, flashWrite],
  );

  const remove = useCallback(
    async (paths: string[]) => {
      await runBulk(paths, async (path) => {
        try {
          await driveDelete(path);
        } catch (e) {
          toastCatch("drive:delete")(e);
        }
      });
      clearSelection();
      refresh();
      refreshTree();
      refreshStorage();
    },
    [refresh, refreshTree, refreshStorage, clearSelection],
  );

  const move = useCallback(
    async (src: string, dst: string) => {
      try {
        const entry = await driveMove(src, dst);
        flashWrite(entry.path);
      } catch (e) {
        toastCatch("drive:move")(e);
        return;
      }
      refresh();
      refreshTree();
    },
    [refresh, refreshTree, flashWrite],
  );

  // Derived flags
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  return {
    currentPath,
    history,
    historyIndex,
    canGoBack,
    canGoForward,
    navigate,
    goBack,
    goForward,
    goUp,

    entries,
    loading,
    error,
    refresh,
    tree,
    refreshTree,

    selection,
    isSelected,
    selectOnly,
    toggleSelect,
    selectRange,
    clearSelection,
    selectAll,

    sortKey,
    sortDir,
    setSort,
    searchQuery,
    setSearchQuery,
    visibleEntries,

    viewMode,
    setViewMode,

    clipboard,
    copySelection,
    cutSelection,
    pasteHere,

    createFolder,
    createFile,
    rename,
    remove,
    move,

    storage,
    refreshStorage,

    recentlyWritten,

    cachedEntriesFor,

    recursiveResults,
    recursiveQuery,
    recursiveLoading,
    runRecursiveSearch,
    clearRecursiveSearch,
  };
}
