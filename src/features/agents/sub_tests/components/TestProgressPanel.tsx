import { motion, AnimatePresence } from 'framer-motion';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

interface PerModelProgress {
  modelId: string;
  label: string;
  completed: number;
  total: number;
  isActive: boolean;
}

interface TestProgressPanelProps {
  isRunning: boolean;
  progress: {
    phase?: string;
    modelId?: string;
    scenarioName?: string;
    current?: number;
    total?: number;
    scores?: { tool_accuracy?: number; output_quality?: number; protocol_compliance?: number };
  } | null;
  perModelProgress: PerModelProgress[];
}

export function TestProgressPanel({ isRunning, progress, perModelProgress }: TestProgressPanelProps) {
  return (
    <AnimatePresence>
      {isRunning && progress && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LoadingSpinner className="text-primary" />
                <span className="text-sm text-foreground/80 capitalize">
                  {progress.phase === 'generating'
                    ? 'Generating test scenarios...'
                    : progress.phase === 'executing'
                      ? `Testing ${progress.modelId ?? ''} -- ${progress.scenarioName ?? ''}`
                      : progress.phase}
                </span>
              </div>
              {progress.total && (
                <span className="text-sm text-muted-foreground/90">
                  {progress.current ?? 0} / {progress.total}
                </span>
              )}
            </div>

            {progress.total && (
              <div className="space-y-2">
                {perModelProgress.map((model) => (
                  <div key={model.modelId} className="flex items-center gap-2.5">
                    <span className="w-20 text-sm text-muted-foreground/80 truncate">{model.label}</span>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: model.total }).map((_, i) => {
                        const done = i < model.completed;
                        const active = model.isActive && i === model.completed && model.completed < model.total;
                        return (
                          <span
                            key={`${model.modelId}-${i}`}
                            className={`w-2 h-2 rounded-full border ${
                              done
                                ? 'bg-emerald-400 border-emerald-400'
                                : active
                                  ? 'bg-primary border-primary animate-pulse'
                                  : 'border-muted-foreground/40'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {progress.scores && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground/90">
                <span>Tool: {progress.scores.tool_accuracy ?? '\u2014'}</span>
                <span>Output: {progress.scores.output_quality ?? '\u2014'}</span>
                <span>Protocol: {progress.scores.protocol_compliance ?? '\u2014'}</span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
