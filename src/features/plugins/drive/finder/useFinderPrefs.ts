import { useCallback, useState } from "react";

import { jsonOr, safeLocalGet, safeLocalSet } from "@/lib/safeLocalStorage";

import {
  FINDER_PREFS_DEFAULT,
  FINDER_PREFS_KEY,
  type FinderPrefs,
  type FinderViewMode,
} from "./types";

const VIEW_MODES: readonly FinderViewMode[] = ["list", "icons", "columns", "gallery"];

/** Field-by-field coercion — a stale or hand-edited store never yields NaN widths. */
export function coerceFinderPrefs(raw: unknown): FinderPrefs {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof FinderPrefs, unknown>>;
  const num = (v: unknown, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : def;
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  return {
    sidebarW: num(src.sidebarW, FINDER_PREFS_DEFAULT.sidebarW),
    inspectorW: num(src.inspectorW, FINDER_PREFS_DEFAULT.inspectorW),
    sidebarOpen: bool(src.sidebarOpen, FINDER_PREFS_DEFAULT.sidebarOpen),
    inspectorOpen: bool(src.inspectorOpen, FINDER_PREFS_DEFAULT.inspectorOpen),
    viewMode: VIEW_MODES.includes(src.viewMode as FinderViewMode)
      ? (src.viewMode as FinderViewMode)
      : FINDER_PREFS_DEFAULT.viewMode,
  };
}

export function readFinderPrefs(): FinderPrefs {
  return coerceFinderPrefs(jsonOr<unknown>(safeLocalGet(FINDER_PREFS_KEY, "drive:finder-prefs"), null));
}

/**
 * Finder layout preferences: pane widths, open/closed panes and the view
 * mode. Hydrated once from safeLocalStorage (merged over the defaults;
 * malformed JSON falls back to the defaults) and written back on every change.
 */
export function useFinderPrefs() {
  const [prefs, setPrefs] = useState<FinderPrefs>(readFinderPrefs);

  const update = useCallback((patch: Partial<FinderPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      safeLocalSet(FINDER_PREFS_KEY, JSON.stringify(next), "drive:finder-prefs");
      return next;
    });
  }, []);

  const setViewMode = useCallback((viewMode: FinderViewMode) => update({ viewMode }), [update]);
  const setSidebarOpen = useCallback((sidebarOpen: boolean) => update({ sidebarOpen }), [update]);
  const setInspectorOpen = useCallback(
    (inspectorOpen: boolean) => update({ inspectorOpen }),
    [update],
  );
  const setSidebarW = useCallback((sidebarW: number) => update({ sidebarW }), [update]);
  const setInspectorW = useCallback((inspectorW: number) => update({ inspectorW }), [update]);

  return { prefs, setViewMode, setSidebarOpen, setInspectorOpen, setSidebarW, setInspectorW };
}

export type FinderPrefsApi = ReturnType<typeof useFinderPrefs>;
