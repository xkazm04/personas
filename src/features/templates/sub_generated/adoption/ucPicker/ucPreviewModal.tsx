// Full-screen preview modal that shows what the selected use case's
// sample In-App Message looks like when delivered.

import { Inbox, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';

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
      panelClassName="relative bg-gradient-to-b from-background via-background to-[color-mix(in_srgb,var(--color-background),var(--color-primary)_3%)] border border-primary/15 rounded-2xl shadow-elevation-4 shadow-black/30 overflow-hidden flex flex-col max-h-[calc(100vh-3rem)] w-full max-w-3xl"
    >
      <div className="absolute top-0 left-1/4 w-1/2 h-32 bg-primary/[0.04] blur-3xl pointer-events-none" />
      <div className="relative flex items-start justify-between px-6 py-4 border-b border-primary/[0.08] flex-shrink-0 bg-secondary/10">
        <div className="flex-1 min-w-0 pr-4">
          <h3
            id="uc-preview-title"
            className="typo-body-lg font-semibold text-foreground/95 tracking-tight inline-flex items-center gap-2.5"
          >
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-card bg-primary/15 ring-1 ring-primary/30 text-primary">
              <Inbox className="w-5 h-5" />
            </span>
            {title}
          </h3>
          {subtitle && <p className="typo-body text-foreground/70 mt-1 leading-relaxed">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          className="focus-ring p-1.5 rounded-card hover:bg-secondary/60 text-foreground/80 hover:text-foreground transition-colors"
          aria-label="Close preview"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="relative flex-1 overflow-y-auto px-6 py-5 flex flex-col min-h-0">{children}</div>
    </BaseModal>
  );
}
