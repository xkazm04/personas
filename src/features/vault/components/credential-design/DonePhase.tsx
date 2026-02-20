import { motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';

interface DonePhaseProps {
  connectorLabel?: string;
  onClose: () => void;
}

export function DonePhase({ connectorLabel, onClose }: DonePhaseProps) {
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
        <p className="text-xs text-muted-foreground/50 mt-1">
          {connectorLabel} credential has been securely saved.
        </p>
      </div>
      <button
        onClick={onClose}
        className="mt-2 px-5 py-2 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all"
      >
        Done
      </button>
    </motion.div>
  );
}
