import { useCallback, useRef, useState } from "react";

import { driveWrite } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import { useToastStore } from "@/stores/toastStore";

import type { DriveApi } from "./types";

// The backend refuses any write over 50 MB (drive/mod.rs, MAX_WRITE_BYTES);
// this pre-check only skips the FileReader round-trip for files that would be
// refused anyway, so a drift here degrades to a slower refusal, never a wrong
// one. It is deliberately NOT load-bearing.
export const EXTERNAL_DROP_MAX_BYTES = 50 * 1024 * 1024;

const hasFiles = (e: React.DragEvent) => e.dataTransfer?.types?.includes("Files") ?? false;

/**
 * OS → Drive drag-drop for the main column. A counter (not a boolean) tracks
 * dragenter/leave because the events fire per element and would flicker on
 * every child boundary. `dropTarget` is the folder row / tree node the cursor
 * is over (reported by the views and sidebar); null drops into the open folder.
 */
export function useExternalDrop(drive: DriveApi) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [active, setActive] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const counter = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    counter.current += 1;
    setActive(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    counter.current = Math.max(0, counter.current - 1);
    if (counter.current === 0) {
      setActive(false);
      setDropTarget(null);
    }
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      counter.current = 0;
      setActive(false);
      const dest = dropTarget ?? drive.currentPath;
      setDropTarget(null);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      let added = 0;
      let tooLarge = 0;
      let failed = 0;
      for (const file of files) {
        if (file.size > EXTERNAL_DROP_MAX_BYTES) {
          tooLarge += 1;
          continue;
        }
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          await driveWrite(dest ? `${dest}/${file.name}` : file.name, buf);
          added += 1;
        } catch (err) {
          failed += 1;
          silentCatch("finder:external-drop")(err);
        }
      }
      drive.refresh();
      drive.refreshStorage();
      drive.refreshRecent();
      const f = t.plugins.drive.finder;
      if (added > 0) addToast(tx(f.import_done_n, { count: added }), "success");
      if (tooLarge > 0) addToast(tx(f.import_too_large_n, { count: tooLarge }), "error");
      if (failed > 0) addToast(tx(f.import_failed_n, { count: failed }), "error");
    },
    [drive, dropTarget, addToast, t, tx],
  );

  return { active, dropTarget, setDropTarget, onDragEnter, onDragOver, onDragLeave, onDrop };
}
