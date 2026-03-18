import { motion, AnimatePresence } from 'framer-motion';
import {
  FlaskConical, ChevronDown, ChevronRight,
  Trash2, Clock, Trophy, Loader2, AlertCircle,
} from 'lucide-react';
import { statusBadge } from '../libs/testUtils';
import { TestComparisonTable } from './TestComparisonTable';
import type { PersonaTestRun } from '@/lib/bindings/PersonaTestRun';
import type { PersonaTestResult } from '@/lib/bindings/PersonaTestResult';

interface TestHistoryListProps {
  testRuns: PersonaTestRun[];
  expandedRunId: string | null;
  toggleExpand: (runId: string) => void;
  onDelete: (runId: string) => void;
  activeTestResults: PersonaTestResult[];
  activeTestResultsRunId: string | null;
}

function parseSummary(run: PersonaTestRun) {
  if (!run.summary) return null;
  try {
    return JSON.parse(run.summary) as {
      best_quality_model?: string;
      best_value_model?: string;
      rankings?: Array<{ model_id: string; composite_score: number; total_cost_usd: number }>;
    };
  } catch { return null; }
}

export function TestHistoryList({
  testRuns, expandedRunId, toggleExpand, onDelete,
  activeTestResults, activeTestResultsRunId,
}: TestHistoryListProps) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
        <Clock className="w-3.5 h-3.5" />
        Test History
      </h4>

      {testRuns.length === 0 ? (
        <div className="text-center py-12 bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl">
          <div className="w-14 h-14 rounded-xl bg-primary/8 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <FlaskConical className="w-7 h-7 text-primary/40" />
          </div>
          <p className="text-sm text-muted-foreground/80">No test runs yet</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Select models above and run a test</p>
        </div>
      ) : (
        <div className="space-y-2">
          {testRuns.map((run) => {
            const isExpanded = expandedRunId === run.id;
            const summary = parseSummary(run);
            const modelsList: string[] = (() => {
              try { return JSON.parse(run.models_tested); } catch { return []; }
            })();

            return (
              <div key={run.id} data-testid={`test-run-${run.id}`} className="border border-primary/10 rounded-xl overflow-hidden">
                <button
                  data-testid={`test-run-expand-${run.id}`}
                  onClick={() => toggleExpand(run.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-background/30 hover:bg-secondary/20 transition-colors text-left"
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground/80 font-medium">
                        {modelsList.join(', ') || 'Test Run'}
                      </span>
                      <span className={statusBadge(run.status)}>{run.status}</span>
                      {run.scenarios_count > 0 && (
                        <span className="text-sm text-muted-foreground/80">
                          {run.scenarios_count} scenario{run.scenarios_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/80">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(run.created_at).toLocaleString()}
                      </span>
                      {summary?.best_quality_model && (
                        <span className="flex items-center gap-1 text-primary/70">
                          <Trophy className="w-3 h-3" />
                          Best: {summary.best_quality_model}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    data-testid={`test-run-delete-${run.id}`}
                    onClick={(e) => { e.stopPropagation(); onDelete(run.id); }}
                    className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground/80 hover:text-red-400 transition-colors"
                    title="Delete test run"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t border-primary/10 bg-secondary/10"
                    >
                      <div className="p-4">
                        {run.error && (
                          <div className="flex items-start gap-2 px-3 py-2.5 mb-4 rounded-xl bg-red-500/10 border border-red-500/20">
                            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                            <span className="text-sm text-red-400">{run.error}</span>
                          </div>
                        )}
                        {activeTestResultsRunId === run.id ? (
                          <TestComparisonTable results={activeTestResults} />
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading results...
                          </div>
                        )}
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
