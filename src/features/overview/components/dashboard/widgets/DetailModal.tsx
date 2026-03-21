import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';

interface DetailModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export default function DetailModal({ title, subtitle, onClose, actions, children }: DetailModalProps) {
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="detail-modal-title"
      size="full"
      panelClassName="bg-gradient-to-b from-background via-background to-secondary/30 border border-primary/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[90vh]"
    >
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-primary/10 flex-shrink-0">
        <div className="flex-1 min-w-0 pr-4">
          <h3 id="detail-modal-title" className="typo-heading text-foreground/90">{title}</h3>
          {subtitle && (
            <p className="typo-body text-muted-foreground/80 mt-1">{subtitle}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/90 hover:text-foreground/95 transition-colors focus-ring"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col min-h-0">
        {children}
      </div>

      {/* Footer actions */}
      {actions && (
        <div className="flex items-center justify-end gap-2 p-4 border-t border-primary/10 bg-secondary/20 flex-shrink-0">
          {actions}
        </div>
      )}
    </BaseModal>
  );
}
