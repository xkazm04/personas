import { X, AlertCircle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { statusBadge } from '@/lib/eval/evalFramework';
import { useTranslation } from '@/i18n/useTranslation';

interface LabResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  run: {
    status: string;
    createdAt: string;
    error?: string | null;
  };
  modeLabel: string;
  headerChips?: React.ReactNode;
  footerActions?: React.ReactNode;
  children: React.ReactNode;
}

export function LabResultModal({
  isOpen,
  onClose,
  run,
  modeLabel,
  headerChips,
  footerActions,
  children,
}: LabResultModalProps) {
  const { t } = useTranslation();
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="lab-result-modal" maxWidthClass="max-w-[92vw]">
      <div className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-primary/10 bg-gradient-to-r from-secondary/50 via-background/95 to-secondary/50 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 id="lab-result-modal" className="typo-heading font-semibold text-foreground/90 tracking-wide">{modeLabel} {t.agents.lab.results_suffix}</h2>
            <span className={statusBadge(run.status)}>{run.status}</span>
            {headerChips}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="typo-caption text-foreground">{new Date(run.createdAt).toLocaleString()}</span>
            <button data-testid="lab-result-modal-close" onClick={onClose} aria-label="Close results" className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 bg-gradient-to-b from-background/60 to-background/40">
          {run.error && (
            <div className="flex items-start gap-2 px-3 py-2.5 mb-4 rounded-modal bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <span className="typo-body text-red-400">{run.error}</span>
            </div>
          )}
          {children}
        </div>

        {/* Footer */}
        {footerActions && (
          <div className="flex items-center gap-3 px-5 py-3 border-t border-primary/10 bg-gradient-to-r from-secondary/40 via-background/95 to-secondary/40 backdrop-blur-sm flex-shrink-0">
            {footerActions}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
