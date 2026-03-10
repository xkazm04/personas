import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, ArrowRight, RefreshCw, PackagePlus } from 'lucide-react';

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
  const [refinementText, setRefinementText] = useState('');

  const handleRefineSubmit = () => {
    if (!refinementText.trim() || !onRefine) return;
    onRefine(refinementText.trim());
    setRefinementText('');
  };

  return (
    <motion.div
      key="done"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center justify-center py-12 gap-4"
    >
      <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
        <CheckCircle className="w-6 h-6 text-emerald-400" />
      </div>
      <div className="text-center">
        <h3 className="text-sm font-semibold text-foreground">Credential Created</h3>
        <p className="text-sm text-muted-foreground/90 mt-1">
          {connectorLabel} credential has been securely saved.
          {refinementCount > 0 && (
            <span className="text-muted-foreground/60"> (revision {refinementCount})</span>
          )}
        </p>
      </div>
      {registeredConnectorName && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 max-w-md"
        >
          <PackagePlus className="w-4 h-4 shrink-0 text-violet-400" />
          <p className="text-sm text-foreground/80">
            <span className="text-violet-400 font-medium">{registeredConnectorName}</span>
            {' '}connector added to your catalog — now available for other personas and template adoption.
          </p>
        </motion.div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 rounded-xl text-sm font-medium transition-all"
        >
          Done
        </button>
        {onViewCredential && (
          <button
            onClick={onViewCredential}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all"
          >
            View Credential
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Additive refinement input */}
      {onRefine && (
        <div className="w-full max-w-md mt-4 pt-4 border-t border-primary/10">
          <p className="text-sm text-muted-foreground/70 text-center mb-2">
            Need to adjust scopes, add fields, or tweak the configuration?
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
              placeholder="e.g. add write scopes, add staging environment..."
              className="flex-1 px-3 py-2 bg-secondary/40 border border-primary/10 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30 transition-colors"
            />
            <button
              onClick={handleRefineSubmit}
              disabled={!refinementText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 rounded-xl text-sm font-medium transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refine
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
