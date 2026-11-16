import { type ReactNode } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';

interface DetailModalProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  /** Override the default max-width (size="full" → max-w-5xl). Pass a Tailwind
   *  max-w-* class to widen or narrow specific instances of the modal. */
  maxWidthClass?: string;
  children: ReactNode;
}

export default function DetailModal({ title, subtitle, onClose, actions, maxWidthClass, children }: DetailModalProps) {
  const { t } = useTranslation();
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="detail-modal-title"
      size="full"
      maxWidthClass={maxWidthClass}
      portal
      staggerChildren={false}
      containerClassName="fixed inset-0 z-[200] flex items-start justify-center px-6 pt-14 pb-6"
      panelClassName="relative bg-surface-1 border border-hair rounded-card shadow-elevation-4 shadow-black/30 overflow-hidden flex flex-col w-full max-h-[calc(100vh-5rem)]"
    >
      {/* Ambient glow effects */}
      <div className="absolute top-0 left-1/4 w-1/2 h-32 bg-surface-1 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-1/3 h-24 bg-accent/[0.03] blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="relative flex items-start justify-between px-6 py-4 border-b border-hair flex-shrink-0 bg-surface-1">
        <div className="flex-1 min-w-0 pr-4">
          <h3 id="detail-modal-title" className="typo-body-lg text-ink-2 tracking-tight">{title}</h3>
          {subtitle && (
            <p className="typo-body text-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.overview.detail_modal.close}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Scrollable body */}
      <div className="relative flex-1 overflow-y-auto px-6 py-5 flex flex-col min-h-0">
        {children}
      </div>

      {/* Footer actions */}
      {actions && (
        <div className="relative flex items-center justify-end gap-2 px-6 py-3 border-t border-hair bg-secondary/15 flex-shrink-0">
          {actions}
        </div>
      )}
    </BaseModal>
  );
}
