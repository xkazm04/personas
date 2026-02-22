import { Check, Wrench, Zap, Bell } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface DesignPhaseAppliedProps {
  result: DesignAnalysisResult | null;
  onReset: () => void;
}

export function DesignPhaseApplied({ result, onReset }: DesignPhaseAppliedProps) {
  return (
    <motion.div
      key="applied"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col items-center justify-center py-12 gap-3"
    >
      <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
        <Check className="w-5 h-5 text-emerald-400" />
      </div>
      <span className="text-sm text-emerald-400 font-medium">
        Design applied successfully!
      </span>

      {result && (
        <div className="mt-2 w-full max-w-sm space-y-2">
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground/80">
            {(result.suggested_tools?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="w-3 h-3" />
                {result.suggested_tools.length} tool{result.suggested_tools.length !== 1 ? 's' : ''}
              </span>
            )}
            {(result.suggested_triggers?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Zap className="w-3 h-3" />
                {result.suggested_triggers.length} trigger{result.suggested_triggers.length !== 1 ? 's' : ''}
              </span>
            )}
            {(result.suggested_notification_channels?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Bell className="w-3 h-3" />
                {result.suggested_notification_channels!.length} channel{result.suggested_notification_channels!.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {result.summary && (
            <p className="text-sm text-muted-foreground/80 text-center line-clamp-2">
              {result.summary}
            </p>
          )}
        </div>
      )}

      <button
        onClick={onReset}
        className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-secondary/50 text-foreground/90 hover:bg-secondary/70 transition-colors"
      >
        <Check className="w-3.5 h-3.5" />
        Done
      </button>
    </motion.div>
  );
}
