import { useId } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { BaseModal } from "@/features/shared/components/modals";

// DriveTextPrompt was retired in cycle 34 — every name-edit op (create,
// rename) is inline-everywhere now. DriveConfirm is the only remaining
// real-modal need (delete confirmation can't be inline; the user needs
// to see the full retention warning + kind breakdown before they nuke).

interface ConfirmPromptProps {
  title: string;
  body?: React.ReactNode;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DriveConfirm({
  title,
  body,
  danger,
  onConfirm,
  onCancel,
}: ConfirmPromptProps) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <BaseModal
      isOpen
      onClose={onCancel}
      titleId={titleId}
      portal
      maxWidthClass="max-w-none"
      panelClassName="w-[400px] rounded-modal border border-primary/25 bg-background/95 shadow-elevation-3 p-4"
    >
      <div className="contents">
        <div id={titleId} className="typo-section-title mb-2">{title}</div>
        {body && (
          <div className="typo-body text-foreground mb-4 leading-relaxed">{body}</div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 transition-colors"
          >
            {t.plugins.drive.cancel}
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
            {t.plugins.drive.confirm}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
