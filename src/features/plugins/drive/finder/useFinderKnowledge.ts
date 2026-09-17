import { useCallback, useState } from "react";

import type { DriveEntry } from "@/api/drive";
import type { KnowledgeBase } from "@/api/vault/database/vectorKb";
import { toastCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import { useToastStore } from "@/stores/toastStore";

import type { KnowledgeTarget, UseDriveKnowledgeResult } from "../knowledge/useDriveKnowledge";
import type { DriveApi } from "./types";

export interface KbPickerState {
  mode: "ingest" | "open";
  targets: KnowledgeTarget[];
  label: string;
}

/**
 * Knowledge-base bridge (classic parity). The picker holds what the pick is
 * FOR: an "ingest" pick sends the targets to the chosen KB then opens the
 * drawer on it; an "open" pick goes straight to the drawer. A null entry
 * means the open folder; a row inside a multi-selection acts on all of it.
 */
export function useFinderKnowledge(drive: DriveApi, knowledge: UseDriveKnowledgeResult) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [kbPicker, setKbPicker] = useState<KbPickerState | null>(null);
  const [knowledgeKb, setKnowledgeKb] = useState<KnowledgeBase | null>(null);

  const targetsFor = useCallback(
    (entry: DriveEntry | null): KnowledgeTarget[] => {
      if (!entry) return [{ path: drive.currentPath, kind: "folder" }];
      if (drive.selection.size > 1 && drive.selection.has(entry.path)) {
        return drive.visibleEntries
          .filter((e) => drive.selection.has(e.path))
          .map((e) => ({ path: e.path, kind: e.kind }));
      }
      return [{ path: entry.path, kind: entry.kind }];
    },
    [drive],
  );

  const handleAddToKnowledge = useCallback(
    (entry: DriveEntry | null) => {
      const targets = targetsFor(entry);
      const label =
        targets.length > 1
          ? tx(t.plugins.drive.finder.items_selected_n, { count: targets.length })
          : (entry?.name ?? (drive.currentPath || "/"));
      setKbPicker({ mode: "ingest", targets, label });
    },
    [targetsFor, drive.currentPath, t, tx],
  );

  const handleOpenKnowledge = useCallback(() => {
    setKbPicker({ mode: "open", targets: [], label: drive.currentPath || "/" });
  }, [drive.currentPath]);

  const handleKbPicked = useCallback(
    async (kb: KnowledgeBase) => {
      const picker = kbPicker;
      setKbPicker(null);
      if (picker?.mode === "ingest") {
        try {
          const count = await knowledge.ingest(picker.targets, kb.id);
          // "Queued", not "added" — ingestion is a background job.
          addToast(tx(t.plugins.drive.finder.kb_ingest_queued_n, { count }), "success");
        } catch (err) {
          toastCatch("finder:knowledge:ingest")(err);
          return;
        }
      }
      setKnowledgeKb(kb);
    },
    [kbPicker, knowledge, addToast, t, tx],
  );

  return {
    kbPicker,
    closeKbPicker: () => setKbPicker(null),
    knowledgeKb,
    closeKnowledgeKb: () => setKnowledgeKb(null),
    handleAddToKnowledge,
    handleOpenKnowledge,
    handleKbPicked,
  };
}

export type FinderKnowledgeApi = ReturnType<typeof useFinderKnowledge>;
