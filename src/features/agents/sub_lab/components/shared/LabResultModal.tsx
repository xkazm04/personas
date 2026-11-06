import { X, AlertCircle } from 'lucide-react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { BaseModal } from '@/lib/ui/BaseModal';
import { statusBadge } from '@/lib/eval/evalFramework';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { debtText } from '@/i18n/DebtText';
import Button from '@/features/shared/components/buttons/Button';


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
        <div className="flex items-center justify-between px-5 py-3 border-b border-hair bg-surface-1 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 id="lab-result-modal" className="typo-heading text-ink-1">{modeLabel} {t.agents.lab.results_suffix}</h2>
            <span className={statusBadge(run.status)}>{tokenLabel(t, 'execution', run.status)}</span>
            {headerChips}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="typo-caption text-ink-2">{<AbsoluteTime timestamp={run.createdAt} />}</span>
            <Button
              type="button"
              data-testid="lab-result-modal-close"
              onClick={onClose}
              aria-label={debtText("auto_close_results_b9a0e746")}
              variant="ghost"
              size="icon-sm"
              icon={<X className="w-4 h-4" />}
            />
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 bg-gradient-to-b from-background/60 to-background/40">
          {run.error && (
            <div className="flex items-start gap-2 px-3 py-2.5 mb-4 rounded-modal bg-status-error/10 border border-status-error/20">
              <AlertCircle className="w-4 h-4 text-status-error mt-0.5 flex-shrink-0" />
              <span className="typo-body text-status-error">{run.error}</span>
            </div>
          )}
          {children}
        </div>

        {/* Footer */}
        {footerActions && (
          <div className="flex items-center gap-3 px-5 py-3 border-t border-hair bg-surface-1 backdrop-blur-sm flex-shrink-0">
            {footerActions}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
