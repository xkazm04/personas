import { AlertCircle, RotateCcw, ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';

interface DesignPhaseErrorProps {
  error: string | null;
  onRetry: () => void;
  onReset: () => void;
}

export function DesignPhaseError({ error, onRetry, onReset }: DesignPhaseErrorProps) {
  return (
    <motion.div
      key="error"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col items-center py-8 gap-5"
    >
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        className="w-14 h-14 rounded-full flex items-center justify-center bg-red-500/15 ring-2 ring-red-500/30"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.3 }}
        >
          <AlertCircle className="w-6 h-6 text-red-400" />
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-center"
      >
        <h3 className="text-base font-semibold text-red-400">Design analysis failed</h3>
        {error && (
          <p className="text-sm text-muted-foreground/70 mt-1.5 max-w-xs mx-auto">
            {error}
          </p>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="flex items-center gap-3"
      >
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Retry
        </button>
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-secondary/40 text-muted-foreground hover:bg-secondary/60 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
      </motion.div>
    </motion.div>
  );
}
