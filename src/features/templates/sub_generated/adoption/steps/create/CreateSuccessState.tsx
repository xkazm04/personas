import { motion } from 'framer-motion';
import {
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { AdoptEntityError } from '../../state/adoptTypes';

interface CreateSuccessStateProps {
  draft: N8nPersonaDraft;
  partialEntityErrors: AdoptEntityError[];
  onOpenInEditor: () => void;
  onReset: () => void;
}

export function CreateSuccessState({
  draft,
  partialEntityErrors,
  onOpenInEditor,
  onReset,
}: CreateSuccessStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', damping: 15, stiffness: 300 }}
      className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.1, type: 'spring', damping: 10, stiffness: 200 }}
        className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3"
      >
        <CheckCircle2 className="w-6 h-6 text-emerald-400" />
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-sm font-semibold text-emerald-400 mb-1"
      >
        Persona Created Successfully
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-sm text-emerald-400/60 mb-4"
      >
        {draft.name ?? 'Your persona'} is ready to use.
      </motion.p>

      {partialEntityErrors.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="mx-auto max-w-xl text-left rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 mb-4"
        >
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-300/90 mb-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Partial Setup Issues
          </div>
          <div className="space-y-1">
            {partialEntityErrors.map((entry, idx) => (
              <div key={`${entry.entity_type}-${entry.entity_name}-${idx}`} className="text-sm text-amber-100/85">
                <span className="font-medium">{entry.entity_type}</span>{' '}
                "{entry.entity_name}": <span className="text-amber-200/80">{entry.error}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-center justify-center gap-3"
      >
        <button
          onClick={onOpenInEditor}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open in Editor
        </button>
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl border border-primary/15 text-muted-foreground/70 hover:bg-secondary/30 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Adopt Another
        </button>
      </motion.div>
    </motion.div>
  );
}
