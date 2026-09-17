import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import {
  driveAbsPaths,
  driveDuplicate,
  driveExportTo,
  driveImportPaths,
  driveOpenInOs,
  driveRevealInOs,
  type DriveEntry,
  type DriveTransferReport,
} from "@/api/drive";
import { copyText } from "@/hooks/utility/interaction/useCopyToClipboard";
import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import { useToastStore } from "@/stores/toastStore";

import { startNativeDrag } from "./nativeDrag";
import type { DriveApi } from "./types";

/**
 * Entry-level actions that talk to the OS or copy bytes on the Rust side:
 * open / reveal / copy path plus import, export, duplicate
 * and the native drag-out (Finder-only). Every rejection is toasted or
 * recorded — none is swallowed.
 */
export function useFinderTransfers(drive: DriveApi) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const f = t.plugins.drive.finder;

  const handleOpen = useCallback(
    (entry: DriveEntry) => {
      if (entry.kind === "folder") {
        drive.navigate(entry.path);
        return;
      }
      driveOpenInOs(entry.path).catch((err) => {
        toastCatch("finder:open")(err);
        drive.refresh(); // the file may be gone — reconcile the listing
      });
    },
    [drive],
  );

  const handleReveal = useCallback(
    (entry: DriveEntry) => {
      driveRevealInOs(entry.path).catch((err) => {
        toastCatch("finder:reveal")(err);
        drive.refresh();
      });
    },
    [drive],
  );

  const handleCopyPath = useCallback(
    (entry: DriveEntry) => {
      copyText(entry.path)
        .then((ok) => {
          if (!ok) addToast(t.plugins.drive.finder.insp_copy_path, "error");
        })
        .catch(silentCatch("finder:copy-path"));
    },
    [addToast, t],
  );

  const afterTransfer = useCallback(() => {
    drive.refresh();
    drive.refreshStorage();
    drive.refreshRecent();
  }, [drive]);

  const toastReport = useCallback(
    (report: DriveTransferReport, done: string, failed: string, tooLarge?: string) => {
      if (report.added > 0) addToast(tx(done, { count: report.added }), "success");
      if (tooLarge && report.tooLarge.length > 0)
        addToast(tx(tooLarge, { count: report.tooLarge.length }), "error");
      if (report.failed.length > 0) addToast(tx(failed, { count: report.failed.length }), "error");
    },
    [addToast, tx],
  );

  const handleImport = useCallback(async () => {
    try {
      const picked = await open({ multiple: true, title: f.import_title });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      const report = await driveImportPaths(paths, drive.currentPath);
      toastReport(report, f.import_done_n, f.import_failed_n, f.import_too_large_n);
      afterTransfer();
    } catch (err) {
      toastCatch("finder:import")(err);
    }
  }, [drive.currentPath, f, toastReport, afterTransfer]);

  const handleExport = useCallback(async () => {
    const paths = Array.from(drive.selection);
    if (paths.length === 0) return;
    try {
      const dir = await open({ directory: true, multiple: false, title: f.export_title });
      if (!dir || Array.isArray(dir)) return;
      const report = await driveExportTo(paths, dir);
      toastReport(report, f.export_done_n, f.export_failed_n);
    } catch (err) {
      toastCatch("finder:export")(err);
    }
  }, [drive.selection, f, toastReport]);

  const handleDuplicate = useCallback(async () => {
    const paths = Array.from(drive.selection);
    if (paths.length === 0) return;
    for (const p of paths) {
      try {
        await driveDuplicate(p);
      } catch (err) {
        toastCatch("finder:duplicate", f.duplicate_failed)(err);
      }
    }
    afterTransfer();
  }, [drive.selection, f.duplicate_failed, afterTransfer]);

  const handleNativeDragOut = useCallback(
    (paths: string[]) => {
      driveAbsPaths(paths)
        .then(startNativeDrag)
        .then((ok) => {
          if (!ok) addToast(f.drag_out_unavailable, "warning");
        })
        .catch(toastCatch("finder:drag-out"));
    },
    [addToast, f.drag_out_unavailable],
  );

  return {
    handleOpen,
    handleReveal,
    handleCopyPath,
    handleImport,
    handleExport,
    handleDuplicate,
    handleNativeDragOut,
  };
}
