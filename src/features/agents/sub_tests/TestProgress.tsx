import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ALL_MODELS } from './TestRunnerConfig';

interface TestProgressProps {
  selectedModels: Set<string>;
}

export function TestProgress({ selectedModels }: TestProgressProps) {
  const isTestRunning = usePersonaStore((s) => s.isTestRunning);
  const testRunProgress = usePersonaStore((s) => s.testRunProgress);

  const orderedSelectedModels = useMemo(
    () => ALL_MODELS.filter((m) => selectedModels.has(m.id)),
    [selectedModels],
  );

  const perModelProgress = useMemo(() => {
    const total = testRunProgress?.total ?? 0;
    const current = testRunProgress?.current ?? 0;
    const modelCount = Math.max(orderedSelectedModels.length, 1);
    const perModelTotal = total > 0 ? Math.max(1, Math.ceil(total / modelCount)) : 1;

    return orderedSelectedModels.map((m, idx) => {
      const start = idx * perModelTotal;
      const completed = Math.max(0, Math.min(perModelTotal, current - start));
      const isActive = testRunProgress?.modelId === m.id;
      return { modelId: m.id, label: m.label, completed, total: perModelTotal, isActive };
    });
  }, [orderedSelectedModels, testRunProgress?.current, testRunProgress?.modelId, testRunProgress?.total]);

  return (
    <AnimatePresence>
      {isTestRunning && testRunProgress && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
                <span className="text-sm text-foreground/80 capitalize">
                  {testRunProgress.phase === 'generating'
                    ? 'Generating test scenarios...'
                    : testRunProgress.phase === 'executing'
                      ? `Testing ${testRunProgress.modelId ?? ''} — ${testRunProgress.scenarioName ?? ''}`
                      : testRunProgress.phase}
                </span>
              </div>
              {testRunProgress.total && (
                <span className="text-sm text-muted-foreground/90">
                  {testRunProgress.current ?? 0} / {testRunProgress.total}
                </span>
              )}
            </div>

            {testRunProgress.total && (
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

            {testRunProgress.scores && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground/90">
                <span>Tool: {testRunProgress.scores.tool_accuracy ?? '—'}</span>
                <span>Output: {testRunProgress.scores.output_quality ?? '—'}</span>
                <span>Protocol: {testRunProgress.scores.protocol_compliance ?? '—'}</span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
