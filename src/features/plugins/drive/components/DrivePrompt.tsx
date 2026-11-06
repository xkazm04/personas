import { useId } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { BaseModal } from "@/features/shared/components/modals";

import Button from '@/features/shared/components/buttons/Button';

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
          <div className="typo-body text-foreground mb-4">{body}</div>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            onClick={onCancel}
            variant="ghost"
            size="sm"
          >
            {t.plugins.drive.cancel}
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-input typo-body border transition-colors focus-ring ${
              danger
                ? "bg-status-error/20 text-status-error border-status-error/40 hover:bg-status-error/20"
                : "bg-status-info/20 text-status-info border-status-info/40 hover:bg-status-info/20"
            }`}
          >
            {t.plugins.drive.confirm}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
