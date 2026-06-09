import { RotateCcw, Trash2 } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";

/**
 * Context strip shown while browsing the trash root. Explains the 7-day
 * retention policy and carries the two trash-specific actions: Restore
 * (enabled with a selection — moves items back out) and Empty trash
 * (hard-deletes everything; the parent confirms first). Rose-tinted to
 * match the sidebar Trash node — this is the "you are in the danger
 * drawer" signal.
 */
export function DriveTrashBanner({
  itemCount,
  selectionCount,
  onRestoreSelection,
  onRequestEmpty,
}: {
  itemCount: number;
  selectionCount: number;
  onRestoreSelection: () => void;
  onRequestEmpty: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-rose-500/20 bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent">
      <Trash2 className="w-4 h-4 text-rose-300 flex-shrink-0" />
      <span className="flex-1 min-w-0 typo-body text-foreground truncate">
        {t.plugins.drive.trash_banner}
      </span>
      {selectionCount > 0 && (
        <button
          type="button"
          onClick={onRestoreSelection}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-body font-medium text-cyan-100 bg-cyan-500/15 border border-cyan-500/35 hover:bg-cyan-500/25 transition-colors focus-ring"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t.plugins.drive.trash_restore}
          <span className="tabular-nums opacity-80">({selectionCount})</span>
        </button>
      )}
      <button
        type="button"
        onClick={onRequestEmpty}
        disabled={itemCount === 0}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-body font-medium text-rose-100 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-ring"
      >
        <Trash2 className="w-3.5 h-3.5" />
        {t.plugins.drive.trash_empty}
      </button>
    </div>
  );
}
