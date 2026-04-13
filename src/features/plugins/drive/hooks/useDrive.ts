import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DriveEntry,
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
  driveStorageInfo,
  driveWriteText,
} from "@/api/drive";
import { toastCatch } from "@/lib/silentCatch";

export type ClipboardMode = "copy" | "cut";
export type ViewMode = "list" | "icons" | "columns";
export type SortKey = "name" | "size" | "modified" | "kind";
export type SortDir = "asc" | "desc";

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
}

const LIST_KEY_ROOT = "__root__";
const cacheKey = (path: string) => path || LIST_KEY_ROOT;

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

  const lastAnchorRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    driveList(currentPath)
      .then((list) => {
        setEntries(list);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, [currentPath]);

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

  // Navigation
  const navigate = useCallback(
    (path: string) => {
      setHistory((h) => {
        const truncated = h.slice(0, historyIndex + 1);
        if (truncated[truncated.length - 1] === path) return truncated;
        return [...truncated, path];
      });
      setHistoryIndex((i) => i + 1);
    },
    [historyIndex],
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
    setSelection((prev) => {
      if (!additive) return new Set([path]);
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    lastAnchorRef.current = path;
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
        case "kind":
          cmp = (a.extension ?? "").localeCompare(b.extension ?? "");
          break;
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
    setTimeout(() => {
      setRecentlyWritten((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }, 1200);
  }, []);

  const pasteHere = useCallback(async () => {
    if (!clipboard) return;
    for (const src of clipboard.paths) {
      const base = src.split("/").pop() ?? "file";
      const dst = currentPath ? `${currentPath}/${base}` : base;
      try {
        if (clipboard.mode === "copy") {
          const entry = await driveCopy(src, dst);
          flashWrite(entry.path);
        } else {
          const entry = await driveMove(src, dst);
          flashWrite(entry.path);
        }
      } catch (e) {
        toastCatch("drive:paste")(e);
      }
    }
    if (clipboard.mode === "cut") setClipboard(null);
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
      for (const path of paths) {
        try {
          await driveDelete(path);
        } catch (e) {
          toastCatch("drive:delete")(e);
        }
      }
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

  // Silence unused-var warning — kept for potential local caching later.
  void cacheKey;

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
  };
}
