import { motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

interface ErrorPhaseProps {
  error: string | null;
  onReset: () => void;
}

export function ErrorPhase({ error, onReset }: ErrorPhaseProps) {
  return (
    <motion.div
      key="error"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <div className="flex items-start gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />
        <div className="text-sm text-red-300">
          {error || 'An unexpected error occurred.'}
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/70 rounded-xl text-sm transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Try Again
        </button>
      </div>
    </motion.div>
  );
}
