import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, ChevronRight, Trash2, Clock, GitBranch, AlertCircle,
} from 'lucide-react';
import { AbResultsView } from '../../components/ab/AbResultsView';
import { statusBadge } from '../../shared/labUtils';

interface AbRun {
  id: string;
  versionANum: number;
  versionBNum: number;
  status: string;
  createdAt: string;
  error?: string | null;
}

interface AbHistoryProps {
  abRuns: AbRun[];
  expandedRunId: string | null;
  setExpandedRunId: (id: string | null) => void;
  abResultsMap: Record<string, unknown[]>;
  deleteAbRun: (id: string) => Promise<void>;
}

export function AbHistory({
  abRuns,
  expandedRunId,
  setExpandedRunId,
  abResultsMap,
  deleteAbRun,
}: AbHistoryProps) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
        <Clock className="w-3.5 h-3.5" />
        A/B History
      </h4>

      {abRuns.length === 0 ? (
        <div className="text-center py-12 bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl">
          <div className="w-14 h-14 rounded-xl bg-primary/8 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <GitBranch className="w-7 h-7 text-primary/40" />
          </div>
          <p className="text-sm text-muted-foreground/80">No A/B test runs yet</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Select two versions and run a comparison</p>
        </div>
      ) : (
        <div className="space-y-2">
          {abRuns.map((run) => {
            const isExpanded = expandedRunId === run.id;
            return (
              <div key={run.id} className="border border-primary/10 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-background/30 hover:bg-secondary/20 transition-colors text-left"
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground/80 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-sm font-mono bg-blue-500/15 text-blue-400">v{run.versionANum}</span>
                      <span className="text-muted-foreground/50 text-sm">vs</span>
                      <span className="px-1.5 py-0.5 rounded text-sm font-mono bg-violet-500/15 text-violet-400">v{run.versionBNum}</span>
                      <span className={statusBadge(run.status)}>{run.status}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/80">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(run.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void deleteAbRun(run.id); }}
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
                        <AbResultsView results={(abResultsMap[run.id] ?? []) as never[]} />
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
