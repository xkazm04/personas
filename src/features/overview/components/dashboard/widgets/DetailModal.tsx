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
      portal
      containerClassName="fixed inset-0 z-[200] flex items-center justify-center p-6"
      panelClassName="relative bg-gradient-to-b from-background via-background to-[color-mix(in_srgb,var(--color-background),var(--color-primary)_3%)] border border-primary/15 rounded-2xl shadow-elevation-4 shadow-black/30 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)]"
    >
      {/* Ambient glow effects */}
      <div className="absolute top-0 left-1/4 w-1/2 h-32 bg-primary/[0.04] blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-1/3 h-24 bg-accent/[0.03] blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="relative flex items-start justify-between px-6 py-4 border-b border-primary/[0.08] flex-shrink-0 bg-secondary/10">
        <div className="flex-1 min-w-0 pr-4">
          <h3 id="detail-modal-title" className="text-base font-semibold text-foreground/95 tracking-tight">{title}</h3>
          {subtitle && (
            <p className="text-sm text-muted-foreground/70 mt-1 leading-relaxed">{subtitle}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/60 hover:text-foreground/90 transition-colors focus-ring"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="relative flex-1 overflow-y-auto px-6 py-5 flex flex-col min-h-0">
        {children}
      </div>

      {/* Footer actions */}
      {actions && (
        <div className="relative flex items-center justify-end gap-2 px-6 py-3 border-t border-primary/[0.08] bg-secondary/15 flex-shrink-0">
          {actions}
        </div>
      )}
    </BaseModal>
  );
}
