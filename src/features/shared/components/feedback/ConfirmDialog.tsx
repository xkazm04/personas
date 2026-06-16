import { useState } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { BaseModal } from "@/lib/ui/BaseModal";

interface ConfirmDialogProps {
  title: string;
  body?: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * May return a promise; while it is pending the dialog disables both
   * buttons and ignores backdrop/Escape dismissal so the action cannot be
   * fired twice (double-click, trackpad bounce, impatient retry).
   */
  onConfirm: () => void | Promise<void>;
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
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.resolve(onConfirm());
    } finally {
      // React 19 makes a state update after unmount a safe no-op, so this is
      // fine whether or not onConfirm closed the dialog. If it stayed open
      // (e.g. the action threw), re-enabling lets the user retry.
      setBusy(false);
    }
  };

  const handleCancel = () => {
    if (busy) return;
    onCancel();
  };

  return (
    <BaseModal
      isOpen
      onClose={handleCancel}
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
            onClick={handleCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel ?? t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            aria-busy={busy}
            className={`px-3 py-1.5 rounded-input typo-body font-semibold border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
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
