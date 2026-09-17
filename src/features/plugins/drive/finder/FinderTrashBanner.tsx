import { RotateCcw, Trash2 } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import AsyncButton from "@/features/shared/components/buttons/AsyncButton";
import Button from "@/features/shared/components/buttons/Button";

interface Props {
  itemCount: number;
  selectionCount: number;
  onRestoreSelection: () => Promise<void>;
  onRequestEmpty: () => void;
}

/** Strip shown while browsing `.trash`: retention note, Put back, Empty Trash. */
export function FinderTrashBanner({ itemCount, selectionCount, onRestoreSelection, onRequestEmpty }: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  return (
    <div
      className="flex items-center gap-3 px-4 py-1.5 border-b border-status-error/25 bg-status-error/10"
      data-testid="finder-trash-banner"
    >
      <Trash2 className="w-4 h-4 text-status-error flex-shrink-0" aria-hidden />
      <span className="flex-1 min-w-0 typo-body text-foreground truncate">{f.trash_banner}</span>
      {selectionCount > 0 && (
        <AsyncButton
          variant="secondary"
          size="xs"
          icon={<RotateCcw className="w-3.5 h-3.5" />}
          onClick={onRestoreSelection}
        >
          {tx(f.trash_restore_n, { count: selectionCount })}
        </AsyncButton>
      )}
      <Button
        variant="danger"
        size="xs"
        icon={<Trash2 className="w-3.5 h-3.5" />}
        disabled={itemCount === 0}
        onClick={onRequestEmpty}
      >
        {f.trash_empty}
      </Button>
    </div>
  );
}
