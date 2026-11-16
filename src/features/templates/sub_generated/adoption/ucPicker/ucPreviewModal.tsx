// Full-screen preview modal that shows what the selected use case's
// sample In-App Message looks like when delivered.

import { Inbox, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { debtText } from '@/i18n/DebtText';
import Button from '@/features/shared/components/buttons/Button';


export function PreviewModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="uc-preview-title"
      size="full"
      portal
      containerClassName="fixed inset-0 z-[10500] flex items-center justify-center p-6"
      panelClassName="relative border border-hair rounded-card shadow-elevation-4 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] w-full max-w-3xl bg-surface-1"
    >
      <div className="relative flex items-start justify-between px-6 py-4 border-b border-primary/[0.08] flex-shrink-0 bg-secondary/10">
        <div className="flex-1 min-w-0 pr-4">
          <h3
            id="uc-preview-title"
            className="typo-body-lg text-ink-1 tracking-tight inline-flex items-center gap-2.5"
          >
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-card bg-primary/15 ring-1 ring-primary/30 text-primary">
              <Inbox className="w-5 h-5" />
            </span>
            {title}
          </h3>
          {subtitle && <p className="typo-body text-foreground mt-1">{subtitle}</p>}
        </div>
        <Button
          type="button"
          onClick={onClose}
          variant="ghost"
          size="icon-sm"
          aria-label={debtText("auto_close_preview_baa55035")}
        >
          <X className="w-5 h-5" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-y-auto px-6 py-5 flex flex-col min-h-0">{children}</div>
    </BaseModal>
  );
}
