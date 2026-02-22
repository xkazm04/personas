import { motion } from 'framer-motion';
import { CheckCircle, ArrowRight } from 'lucide-react';

interface DonePhaseProps {
  connectorLabel?: string;
  onClose: () => void;
  onViewCredential?: () => void;
}

export function DonePhase({ connectorLabel, onClose, onViewCredential }: DonePhaseProps) {
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
        </p>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={onClose}
          className="px-5 py-2 bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 rounded-xl text-sm font-medium transition-all"
        >
          Done
        </button>
        {onViewCredential && (
          <button
            onClick={onViewCredential}
            className="flex items-center gap-1.5 px-5 py-2 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all"
          >
            View Credential
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
