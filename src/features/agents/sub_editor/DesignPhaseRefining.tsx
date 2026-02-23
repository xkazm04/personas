import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import { TransformProgress } from '@/features/shared/components/TransformProgress';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface DesignPhaseRefiningProps {
  outputLines: string[];
  result: DesignAnalysisResult | null;
  onCancel: () => void;
}

export function DesignPhaseRefining({ outputLines, result, onCancel }: DesignPhaseRefiningProps) {
  return (
    <motion.div
      key="refining"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="space-y-3"
    >
      {result && (
        <div className="bg-secondary/30 rounded-xl px-4 py-3 border border-primary/15">
          <p className="text-sm text-muted-foreground/90 mb-1">Current design</p>
          <p className="text-sm text-foreground/90">{result.summary}</p>
        </div>
      )}

      <TransformProgress mode="analysis" lines={outputLines} isRunning={true} />

      <button
        onClick={onCancel}
        className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
        Cancel
      </button>
    </motion.div>
  );
}
