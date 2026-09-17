import { useCallback, useMemo, useState } from "react";

import type { DriveEntry } from "@/api/drive";

import { previewKind, type DriveApi } from "./types";

/**
 * Quick Look over the previewable entries of the open folder (visual order).
 * Opens on the given entry, else the first selected previewable entry, else
 * the first previewable one; Space toggles, Esc closes.
 */
export function useQuickLook(drive: DriveApi) {
  const [path, setPath] = useState<string | null>(null);
  const previewable = useMemo(
    () => drive.visibleEntries.filter((e) => previewKind(e) !== null),
    [drive.visibleEntries],
  );

  const open = useCallback(
    (entry?: DriveEntry) => {
      const target =
        (entry && previewKind(entry) ? entry : null) ??
        previewable.find((e) => drive.selection.has(e.path)) ??
        previewable[0];
      if (target) setPath(target.path);
    },
    [previewable, drive.selection],
  );
  const close = useCallback(() => setPath(null), []);
  const toggle = useCallback(() => {
    if (path) close();
    else open();
  }, [path, close, open]);

  return { path: previewable.length > 0 ? path : null, previewable, open, close, toggle };
}

export type QuickLookApi = ReturnType<typeof useQuickLook>;
