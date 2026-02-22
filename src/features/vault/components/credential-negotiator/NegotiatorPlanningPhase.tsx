import { motion } from 'framer-motion';
import { Loader2, Check, Brain } from 'lucide-react';

interface NegotiatorPlanningPhaseProps {
  progressLines: string[];
  onCancel: () => void;
}

export function NegotiatorPlanningPhase({ progressLines, onCancel }: NegotiatorPlanningPhaseProps) {
  return (
    <motion.div
      key="negotiator-planning"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-3 px-4 py-3 bg-violet-500/10 border border-violet-500/20 rounded-xl">
        <Brain className="w-4 h-4 text-violet-400 shrink-0 animate-pulse" />
        <p className="text-sm text-violet-200/80">
          AI is analyzing the developer portal and generating a step-by-step provisioning plan...
        </p>
      </div>

      <div className="px-2 py-3 space-y-0.5">
        {progressLines.map((line, i) => {
          const isLast = i === progressLines.length - 1;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-3 py-1.5"
            >
              {isLast ? (
                <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />
              ) : (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
              <span className={`text-sm ${isLast ? 'text-foreground' : 'text-muted-foreground/90'}`}>
                {line}
              </span>
            </motion.div>
          );
        })}
        {progressLines.length === 0 && (
          <div className="flex items-center gap-3 py-1.5">
            <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />
            <span className="text-sm text-muted-foreground/90">Initializing negotiator...</span>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}
