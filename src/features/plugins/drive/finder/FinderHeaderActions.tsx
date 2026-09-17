import type { ReactNode } from "react";
import { Copy, Scissors, Trash2, X } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import Button from "@/features/shared/components/buttons/Button";

import type { DriveApi } from "./types";

interface Props {
  drive: DriveApi;
  variantSwitcher?: ReactNode;
  onRequestDelete: () => void;
}

/**
 * Page-header actions: the Classic|Finder switcher plus either an item-count
 * pill or, with a selection, the count and the bulk chips (copy / cut /
 * delete / clear). The danger chip sits behind a hairline so the eye reads
 * "different group" before the label does.
 */
export function FinderHeaderActions({ drive, variantSwitcher, onRequestDelete }: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  const count = drive.selection.size;
  const ic = "w-3.5 h-3.5";

  return (
    <div className="flex items-center gap-2">
      {variantSwitcher}
      {count > 0 ? (
        <div
          className="flex items-center gap-0.5 pl-2.5 pr-0.5 py-0.5 rounded-full bg-primary/15 border border-primary/30"
          data-testid="finder-selection-pill"
        >
          <span className="typo-body font-medium tabular-nums text-foreground mr-1">
            {tx(f.items_selected_n, { count })}
          </span>
          <Button variant="ghost" size="xs" icon={<Copy className={ic} />} onClick={drive.copySelection}>
            {f.bulk_copy}
          </Button>
          <Button variant="ghost" size="xs" icon={<Scissors className={ic} />} onClick={drive.cutSelection}>
            {f.bulk_cut}
          </Button>
          <span aria-hidden className="mx-0.5 w-px h-3.5 bg-status-error/40" />
          <Button variant="danger" size="xs" icon={<Trash2 className={ic} />} onClick={onRequestDelete}>
            {f.bulk_delete}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={f.bulk_clear}
            title={f.bulk_clear}
            onClick={drive.clearSelection}
          >
            <X className={ic} />
          </Button>
        </div>
      ) : (
        <span
          className="px-2.5 py-1 rounded-full bg-secondary/30 border border-border typo-body tabular-nums text-foreground"
          data-testid="finder-items-total"
        >
          {tx(f.items_total_n, { count: drive.visibleEntries.length })}
        </span>
      )}
    </div>
  );
}
