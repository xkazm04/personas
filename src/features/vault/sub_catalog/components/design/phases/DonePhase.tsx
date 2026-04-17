import { useState } from 'react';
import { CheckCircle, ArrowRight, RefreshCw, PackagePlus } from 'lucide-react';
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
      <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
        <CheckCircle className="w-6 h-6 text-emerald-400" />
      </div>
      <div className="text-center">
        <h3 className="typo-heading font-semibold text-foreground">{dp.credential_created}</h3>
        <p className="typo-body text-foreground mt-1">
          {tx(dp.credential_saved_message, { label: connectorLabel ?? '' })}
          {refinementCount > 0 && (
            <span className="text-foreground"> {tx(dp.revision_count, { count: refinementCount })}</span>
          )}
        </p>
      </div>
      {registeredConnectorName && (
        <div
          className="animate-fade-slide-in flex items-center gap-2.5 px-4 py-2.5 rounded-modal bg-violet-500/10 border border-violet-500/20 max-w-md"
        >
          <PackagePlus className="w-4 h-4 shrink-0 text-violet-400" />
          <p className="typo-body text-foreground">
            <span className="text-violet-400 font-medium">{registeredConnectorName}</span>
            {' '}{dp.connector_added_to_catalog}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 rounded-modal typo-body font-medium transition-all"
        >
          {t.common.done}
        </button>
        {onViewCredential && (
          <button
            onClick={onViewCredential}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-foreground rounded-modal typo-body font-medium transition-all"
          >
            {dp.view_credential}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Additive refinement input */}
      {onRefine && (
        <div className="w-full max-w-md mt-4 pt-4 border-t border-primary/10">
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
              className="flex-1 px-3 py-2 bg-secondary/40 border border-primary/10 rounded-modal typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/30 transition-colors"
            />
            <button
              onClick={handleRefineSubmit}
              disabled={!refinementText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 rounded-modal typo-body font-medium transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {dp.refine}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
