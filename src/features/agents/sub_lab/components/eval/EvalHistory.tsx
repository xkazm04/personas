import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Trash2, Clock, Grid3X3, AlertCircle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { statusBadge } from '@/lib/eval/evalFramework';
import { EvalResultsGrid } from './EvalResultsGrid';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import type { LabEvalRun } from '@/lib/bindings/LabEvalRun';

function parseVersionNums(run: LabEvalRun) {
  try { const nums = JSON.parse(run.versionNumbers) as number[]; return nums.map((n) => `v${n}`).join(', '); }
  catch { return run.versionNumbers; }
}

interface EvalHistoryProps {
  runs: LabEvalRun[];
  resultsMap: Record<string, LabEvalResult[]>;
  expandedRunId: string | null;
  onToggleExpand: (runId: string | null) => void;
  onDelete: (runId: string) => void;
}

export function EvalHistory({ runs, resultsMap, expandedRunId, onToggleExpand, onDelete }: EvalHistoryProps) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
        <Clock className="w-3.5 h-3.5" />
        Eval History
      </h4>

      {runs.length === 0 ? (
        <div className="text-center py-12 bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl" data-testid="eval-history-empty">
          <div className="w-14 h-14 rounded-xl bg-primary/8 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <Grid3X3 className="w-7 h-7 text-primary/40" />
          </div>
          <p className="text-sm text-muted-foreground/80">No evaluation runs yet</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Select versions and models, then run</p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => {
            const isExpanded = expandedRunId === run.id;
            return (
              <div key={run.id} className="border border-primary/10 rounded-xl overflow-hidden" data-testid={`eval-run-${run.id}`}>
                <Button variant="ghost" onClick={() => onToggleExpand(isExpanded ? null : run.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-background/30 hover:bg-secondary/20 text-left" data-testid={`eval-run-toggle-${run.id}`}>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono text-foreground/80">{parseVersionNums(run)}</span>
                      <span className={statusBadge(run.status)}>{run.status}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/80">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(run.createdAt).toLocaleString()}</span>
                      {run.scenariosCount > 0 && <span className="text-sm">{run.scenariosCount} scenarios</span>}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); onDelete(run.id); }}
                    className="p-1.5 hover:bg-red-500/15 text-muted-foreground/80 hover:text-red-400" title="Delete run" data-testid={`eval-run-delete-${run.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </Button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="border-t border-primary/10 bg-secondary/10">
                      <div className="p-4">
                        {run.error && (
                          <div className="flex items-start gap-2 px-3 py-2.5 mb-4 rounded-xl bg-red-500/10 border border-red-500/20">
                            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" /><span className="text-sm text-red-400">{run.error}</span>
                          </div>
                        )}
                        <EvalResultsGrid results={resultsMap[run.id] ?? []} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
