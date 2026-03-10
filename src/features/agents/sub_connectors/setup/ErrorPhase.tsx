import { AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

interface ErrorPhaseProps {
  errorMessage: string;
  onClose: () => void;
  onRetry: () => void;
}

export function ErrorPhase({ errorMessage, onClose, onRetry }: ErrorPhaseProps) {
  return (
    <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
      <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-brand-rose/5 border border-brand-rose/15">
        <AlertCircle className="w-4 h-4 text-brand-rose/70 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-brand-rose/80">Design failed</p>
          <p className="text-sm text-brand-rose/50 mt-0.5">{errorMessage}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-border text-muted-foreground hover:bg-secondary/50 transition-colors">
          Close
        </button>
        <button onClick={onRetry} className="px-4 py-2 text-sm font-medium rounded-xl bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors">
          Try Again
        </button>
      </div>
    </motion.div>
  );
}
