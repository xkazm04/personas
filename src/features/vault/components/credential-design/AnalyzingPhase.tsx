import { motion } from 'framer-motion';
import { Loader2, Check } from 'lucide-react';

interface AnalyzingPhaseProps {
  outputLines: string[];
  onCancel: () => void;
}

export function AnalyzingPhase({ outputLines, onCancel }: AnalyzingPhaseProps) {
  return (
    <motion.div
      key="analyzing"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <div className="px-2 py-3 space-y-0.5">
        {outputLines.map((line, i) => {
          const isLast = i === outputLines.length - 1;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-3 py-1.5"
            >
              {isLast ? (
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
              ) : (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
              <span className={`text-sm ${isLast ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                {line}
              </span>
            </motion.div>
          );
        })}
        {outputLines.length === 0 && (
          <div className="flex items-center gap-3 py-1.5">
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
            <span className="text-sm text-muted-foreground/50">Starting analysis...</span>
          </div>
        )}
      </div>
      <div className="px-3 py-2 rounded-xl bg-secondary/30 border border-primary/10 text-xs text-muted-foreground/80">
        Claude is generating connector details, credential fields, and setup guidance based on your request.
      </div>
      <div className="flex justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/70 rounded-xl text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}
