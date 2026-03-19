import { motion, AnimatePresence } from 'framer-motion';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";

export function LabProgress() {
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const labProgress = useAgentStore((s) => s.labProgress);

  return (
    <AnimatePresence>
      {isLabRunning && labProgress && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-3" role="status" aria-live="polite">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LoadingSpinner className="text-primary" />
                <span className="text-sm text-foreground/80 capitalize">
                  {labProgress.phase === 'drafting'
                    ? 'Generating draft persona...'
                    : labProgress.phase === 'generating'
                      ? 'Generating test scenarios...'
                      : labProgress.phase === 'summarizing'
                        ? 'Generating test summary...'
                        : labProgress.phase === 'executing'
                          ? `Testing ${labProgress.modelId ?? ''} -- ${labProgress.scenarioName ?? ''}`
                          : labProgress.phase}
                </span>
              </div>
              {labProgress.total != null && (
                <div className="flex items-center gap-3">
                  {labProgress.elapsedMs != null && (
                    <span className="text-xs text-muted-foreground/50 tabular-nums">
                      {labProgress.elapsedMs >= 60000
                        ? `${Math.floor(labProgress.elapsedMs / 60000)}m ${Math.round((labProgress.elapsedMs % 60000) / 1000)}s`
                        : `${(labProgress.elapsedMs / 1000).toFixed(1)}s`}
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground/90 tabular-nums">
                    {labProgress.current ?? 0} / {labProgress.total}
                  </span>
                </div>
              )}
            </div>

            {labProgress.total != null && (
              <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-primary/60"
                  animate={{ width: `${((labProgress.current ?? 0) / labProgress.total) * 100}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
            )}

            {labProgress.scores && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground/90">
                <span>Tool: {labProgress.scores.tool_accuracy ?? '--'}</span>
                <span>Output: {labProgress.scores.output_quality ?? '--'}</span>
                <span>Protocol: {labProgress.scores.protocol_compliance ?? '--'}</span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
