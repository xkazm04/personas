import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, ChevronRight, Trash2, Clock, Wand2, AlertCircle, Check,
} from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { MatrixResultsView } from '../../components/matrix/MatrixResultsView';
import { statusBadge } from '../../shared/labUtils';

export function MatrixHistory() {
  const matrixRuns = useAgentStore((s) => s.matrixRuns);
  const matrixResultsMap = useAgentStore((s) => s.matrixResultsMap);
  const fetchMatrixResults = useAgentStore((s) => s.fetchMatrixResults);
  const deleteMatrixRun = useAgentStore((s) => s.deleteMatrixRun);

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const handleToggle = (id: string) => {
    const next = expandedRunId === id ? null : id;
    setExpandedRunId(next);
    if (next) fetchMatrixResults(next);
  };

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
        <Clock className="w-3.5 h-3.5" />
        Matrix History
      </h4>

      {matrixRuns.length === 0 ? (
        <div className="text-center py-12 bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl">
          <div className="w-14 h-14 rounded-xl bg-violet-500/8 border border-violet-500/12 flex items-center justify-center mx-auto mb-4">
            <Wand2 className="w-7 h-7 text-violet-400/40" />
          </div>
          <p className="text-sm text-muted-foreground/80">No matrix runs yet</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Describe a change above to generate and test a draft</p>
        </div>
      ) : (
        <div className="space-y-2">
          {matrixRuns.map((run) => {
            const isExpanded = expandedRunId === run.id;
            return (
              <div key={run.id} className="border border-primary/10 rounded-xl overflow-hidden">
                <button
                  onClick={() => handleToggle(run.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-background/30 hover:bg-secondary/20 transition-colors text-left"
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground/80 font-medium truncate max-w-[300px]">
                        {run.userInstruction}
                      </span>
                      <span className={statusBadge(run.status)}>{run.status}</span>
                      {run.draftAccepted && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-sm font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                          <Check className="w-3 h-3" /> Accepted
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/80">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(run.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void deleteMatrixRun(run.id); }}
                    className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground/80 hover:text-red-400 transition-colors"
                    title="Delete run"
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
                        <MatrixResultsView run={run} results={matrixResultsMap[run.id] ?? []} />
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
