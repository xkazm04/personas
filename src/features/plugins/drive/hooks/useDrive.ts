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
  driveRecent,
  driveRename,
  driveSearch,
  driveStorageInfo,
  driveWriteText,
} from "@/api/drive";
import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { kindBucketWeight, visualForEntry } from "../designTokens";

// localStorage key holding the user's preferred view-state (viewMode +
// sortKey + sortDir). Single JSON blob so writes are atomic and the
// shape can grow without breaking older clients.
const VIEW_STATE_KEY = "drive.viewState";

interface PersistedViewState {
  viewMode?: ViewMode;
  sortKey?: SortKey;
  sortDir?: SortDir;
}

function readPersistedViewState(): PersistedViewState {
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as PersistedViewState;
  } catch (err) { silentCatch("features/plugins/drive/hooks/useDrive:catch1")(err); }
  return {};
}

function writePersistedViewState(state: PersistedViewState) {
  try {
    const current = readPersistedViewState();
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (err) { silentCatch("features/plugins/drive/hooks/useDrive:catch2")(err); }
}

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
  // Kind-bucket filter (a `visualForEntry().labelKey`, e.g. "kind_image").
  // Null = show all kinds. Transient — resets on navigation like selection.
  kindFilter: string | null;
  setKindFilter: (key: string | null) => void;
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

  // Sidebar "Recent" rail — N most-recently-modified files across the
  // managed drive. Refreshed alongside the tree on first mount + after
  // any mutation that adds or moves a file.
  recent: DriveEntry[];
  refreshRecent: () => void;

  // Highlight recent writes for ~1.2s
  recentlyWritten: Set<string>;

  /**
   * Read previously-loaded entries for a path without re-fetching. Used by
   * the columns view to avoid a fresh IPC call for every parent column the
   * user has already navigated through. Returns null if the path was never
   * cached (caller should fall back to driveList).
   */
  cachedEntriesFor: (path: string) => DriveEntry[] | null;

  // Per-folder scroll memory — Back/Up restores where you were instead of
  // jumping to the top. Views record on scroll and recall after the folder's
  // entries have loaded. Session-scoped (clears with the component).
  rememberScroll: (path: string, top: number) => void;
  recallScroll: (path: string) => number;

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
  const [recent, setRecent] = useState<DriveEntry[]>([]);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  // viewMode / sortKey / sortDir hydrate from localStorage on first
  // render so users keep their preferred layout across sessions. Lazy
  // init avoids the JSON parse on every render.
  const [sortKey, setSortKeyRaw] = useState<SortKey>(
    () => readPersistedViewState().sortKey ?? "name",
  );
  const [sortDir, setSortDirRaw] = useState<SortDir>(
    () => readPersistedViewState().sortDir ?? "asc",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [viewMode, setViewModeRaw] = useState<ViewMode>(
    () => readPersistedViewState().viewMode ?? "list",
  );

  // setViewMode + setSort wrappers persist on every change. Direct state
  // setters (setViewModeRaw etc.) stay private to this hook.
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeRaw(mode);
    writePersistedViewState({ viewMode: mode });
  }, []);
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

  // Scroll offsets per visited path. A ref (not state) — recording on every
  // scroll event must not re-render the Finder.
  const scrollCacheRef = useRef<Map<string, number>>(new Map());
  const rememberScroll = useCallback((path: string, top: number) => {
    scrollCacheRef.current.set(path, top);
  }, []);
  const recallScroll = useCallback((path: string): number => {
    return scrollCacheRef.current.get(path) ?? 0;
  }, []);

  const refreshTree = useCallback(() => {
    driveListTree("", 4)
      .then(setTree)
      .catch(toastCatch("drive:listTree"));
  }, []);

  const refreshStorage = useCallback(() => {
    driveStorageInfo().then(setStorage).catch(toastCatch("drive:storageInfo"));
  }, []);

  const refreshRecent = useCallback(() => {
    driveRecent(5)
      .then(setRecent)
      .catch(toastCatch("drive:recent"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    refreshTree();
    refreshStorage();
    refreshRecent();
  }, [refreshTree, refreshStorage, refreshRecent]);

  // Clear selection + kind filter on navigation — both are scoped to the
  // folder you're looking at, and a stale filter on a new folder is confusing.
  useEffect(() => {
    setSelection(new Set());
    lastAnchorRef.current = null;
    setKindFilter(null);
  }, [currentPath]);

  // Self-heal a stranded filter: if the active kind no longer exists in the
  // folder (e.g. the last file of that kind was deleted or moved out), drop it
  // so the list isn't stuck empty with the filter bar auto-hidden.
  useEffect(() => {
    if (
      kindFilter &&
      !entries.some((e) => visualForEntry(e).labelKey === kindFilter)
    ) {
      setKindFilter(null);
    }
  }, [entries, kindFilter]);

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
      const nextDir =
        dir ?? (key === sortKey ? (sortDir === "asc" ? "desc" : "asc") : "asc");
      setSortKeyRaw(key);
      setSortDirRaw(nextDir);
      writePersistedViewState({ sortKey: key, sortDir: nextDir });
    },
    [sortKey, sortDir],
  );

  const visibleEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let filtered = q
      ? entries.filter((e) => e.name.toLowerCase().includes(q))
      : entries;
    // Kind-bucket filter narrows to a single resolved kind (the same bucket
    // the Kind column / sort uses), applied after the name filter. Skipped in
    // columns view — that view is navigation-centric and hides the filter bar,
    // so a dormant filter shouldn't silently prune its columns.
    if (kindFilter && viewMode !== "columns") {
      filtered = filtered.filter(
        (e) => visualForEntry(e).labelKey === kindFilter,
      );
    }
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
          //
          // Bucket ordering uses a curated weight (folders → images →
          // videos → pdfs → documents → code → data → sheets → audio →
          // archives → signatures → other) rather than alphabetic-by-key,
          // so "Other" stays at the end and visually-related groups
          // cluster.
          const aw = kindBucketWeight(visualForEntry(a).labelKey);
          const bw = kindBucketWeight(visualForEntry(b).labelKey);
          cmp = aw - bw;
          if (cmp === 0)
            cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [entries, searchQuery, kindFilter, viewMode, sortKey, sortDir]);

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
    refreshRecent();
  }, [clipboard, currentPath, refresh, refreshTree, refreshStorage, refreshRecent, flashWrite]);

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
      refreshRecent();
    },
    [currentPath, refresh, refreshStorage, refreshRecent, flashWrite],
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
      // Rename changes the file's mtime AND its name — the rail's previous
      // entry now references a stale path. Refresh so the row shows the
      // new name and stays clickable.
      refreshRecent();
    },
    [refresh, refreshTree, refreshRecent, flashWrite],
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
      // Files just deleted may have been in the rail. Refresh so the
      // displayed rows match the live tree.
      refreshRecent();
    },
    [refresh, refreshTree, refreshStorage, refreshRecent, clearSelection],
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
      refreshRecent();
    },
    [refresh, refreshTree, refreshRecent, flashWrite],
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
    kindFilter,
    setKindFilter,
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

    recent,
    refreshRecent,

    recentlyWritten,

    cachedEntriesFor,
    rememberScroll,
    recallScroll,

    recursiveResults,
    recursiveQuery,
    recursiveLoading,
    runRecursiveSearch,
    clearRecursiveSearch,
  };
}
