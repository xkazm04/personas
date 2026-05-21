import { useTranslation } from "@/i18n/useTranslation";
import { BaseModal } from "@/lib/ui/BaseModal";

interface ConfirmDialogProps {
  title: string;
  body?: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Themed confirm dialog. Replaces the OS-native `confirm()` with the
 * app's modal idiom: backdrop blur, Escape closes, click-outside cancels,
 * danger styling for destructive actions. Bound to `t.common.cancel` /
 * `t.common.confirm` by default; override via `cancelLabel` /
 * `confirmLabel` for action-specific verbs.
 */
export function ConfirmDialog({
  title,
  body,
  danger,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <BaseModal
      isOpen
      onClose={onCancel}
      titleId="confirm-dialog-title"
      size="sm"
      panelClassName="rounded-modal border border-primary/25 bg-background/95 shadow-elevation-3 p-4"
      portal
    >
        <div id="confirm-dialog-title" className="typo-section-title mb-2">{title}</div>
        {body && (
          <div className="typo-body text-foreground mb-4 leading-relaxed">{body}</div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 transition-colors"
          >
            {cancelLabel ?? t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-input typo-body font-semibold border transition-colors ${
              danger
                ? "bg-rose-500/25 text-rose-100 border-rose-500/45 hover:bg-rose-500/35"
                : "bg-sky-500/25 text-sky-100 border-sky-500/40 hover:bg-sky-500/35"
            }`}
          >
            {confirmLabel ?? t.common.confirm}
          </button>
        </div>
    </BaseModal>
  );
}
