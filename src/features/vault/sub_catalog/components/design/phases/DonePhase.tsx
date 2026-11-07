import { useState } from 'react';
import { CheckCircle, ArrowRight, RefreshCw, PackagePlus } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

interface DonePhaseProps {
  connectorLabel?: string;
  registeredConnectorName?: string | null;
  refinementCount?: number;
  onClose: () => void;
  onViewCredential?: () => void;
  onRefine?: (refinementText: string) => void;
}

export function DonePhase({
  connectorLabel,
  registeredConnectorName,
  refinementCount = 0,
  onClose,
  onViewCredential,
  onRefine,
}: DonePhaseProps) {
  const { t, tx } = useTranslation();
  const dp = t.vault.design_phases;
  const [refinementText, setRefinementText] = useState('');

  const handleRefineSubmit = () => {
    if (!refinementText.trim() || !onRefine) return;
    onRefine(refinementText.trim());
    setRefinementText('');
  };

  return (
    <div
      key="done"
      className="animate-fade-slide-in flex flex-col items-center justify-center py-12 gap-4"
    >
      <div className="w-12 h-12 rounded-full bg-status-success/15 flex items-center justify-center">
        <CheckCircle className="w-6 h-6 text-status-success" />
      </div>
      <div className="text-center">
        <h3 className="typo-heading text-foreground">{dp.credential_created}</h3>
        <p className="typo-body text-foreground mt-1">
          {tx(dp.credential_saved_message, { label: connectorLabel ?? '' })}
          {refinementCount > 0 && (
            <span className="text-foreground"> {tx(dp.revision_count, { count: refinementCount })}</span>
          )}
        </p>
      </div>
      {registeredConnectorName && (
        <div
          className="animate-fade-slide-in flex items-center gap-2.5 px-4 py-2.5 rounded-modal bg-role-agent/10 border border-role-agent/20 max-w-md"
        >
          <PackagePlus className="w-4 h-4 shrink-0 text-role-agent" />
          <p className="typo-body text-foreground">
            <span className="text-role-agent font-medium">{registeredConnectorName}</span>
            {' '}{dp.connector_added_to_catalog}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <Button variant="secondary" onClick={onClose}>
          {t.common.done}
        </Button>
        {onViewCredential && (
          <Button
            type="button"
            onClick={onViewCredential}
            variant="primary"
            size="md"
            iconRight={<ArrowRight className="w-3.5 h-3.5" />}
          >
            {dp.view_credential}
          </Button>
        )}
      </div>

      {/* Additive refinement input */}
      {onRefine && (
        <div className="w-full max-w-md mt-4 pt-4 border-t border-hair">
          <p className="typo-body text-foreground text-center mb-2">
            {dp.refine_hint}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={refinementText}
              onChange={(e) => setRefinementText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleRefineSubmit();
                }
              }}
              placeholder={dp.refine_placeholder}
              className="flex-1 px-3 py-2 bg-surface-2 border border-hair rounded-modal typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/30 transition-colors"
            />
            <Button
              variant="secondary"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={handleRefineSubmit}
              disabled={!refinementText.trim()}
            >
              {dp.refine}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
