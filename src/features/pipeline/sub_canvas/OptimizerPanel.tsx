import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  GitBranch,
  AlertTriangle,
  Unlink,
  ArrowRightLeft,
  RotateCcw,
  Check,
  X,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import type { PipelineAnalytics } from '@/lib/bindings/PipelineAnalytics';
import type { TopologySuggestion } from '@/lib/bindings/TopologySuggestion';

interface OptimizerPanelProps {
  analytics: PipelineAnalytics | null;
  loading: boolean;
  onAcceptSuggestion: (suggestion: TopologySuggestion) => void;
  onDismissSuggestion: (suggestionId: string) => void;
  onRefresh: () => void;
  dismissedIds: Set<string>;
}

const SUGGESTION_ICONS: Record<string, typeof Sparkles> = {
  parallelize: GitBranch,
  remove_underperformer: AlertTriangle,
  connect_isolated: Unlink,
  add_feedback: RotateCcw,
  reorder: ArrowRightLeft,
};

const SUGGESTION_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  parallelize: { bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-500' },
  remove_underperformer: { bg: 'bg-red-500/8', border: 'border-red-500/20', text: 'text-red-400', dot: 'bg-red-500' },
  connect_isolated: { bg: 'bg-amber-500/8', border: 'border-amber-500/20', text: 'text-amber-400', dot: 'bg-amber-500' },
  add_feedback: { bg: 'bg-violet-500/8', border: 'border-violet-500/20', text: 'text-violet-400', dot: 'bg-violet-500' },
  reorder: { bg: 'bg-blue-500/8', border: 'border-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-500' },
};

const DEFAULT_COLORS = { bg: 'bg-indigo-500/8', border: 'border-indigo-500/20', text: 'text-indigo-400', dot: 'bg-indigo-500' };

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1 rounded-full bg-primary/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${value * 100}%`,
            backgroundColor: value >= 0.7 ? '#10b981' : value >= 0.5 ? '#f59e0b' : '#ef4444',
          }}
        />
      </div>
      <span className="text-[9px] text-muted-foreground font-mono">{Math.round(value * 100)}%</span>
    </div>
  );
}

function ImpactBadge({ impact }: { impact: string }) {
  const colors = {
    high: 'bg-red-500/10 text-red-400 border-red-500/20',
    medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };
  return (
    <span className={`px-1.5 py-0.5 text-[8px] font-mono uppercase rounded border ${colors[impact as keyof typeof colors] ?? colors.low}`}>
      {impact}
    </span>
  );
}

export default function OptimizerPanel({
  analytics,
  loading,
  onAcceptSuggestion,
  onDismissSuggestion,
  onRefresh,
  dismissedIds,
}: OptimizerPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredSuggestion, setHoveredSuggestion] = useState<string | null>(null);

  const suggestions = (analytics?.suggestions ?? []).filter((s) => !dismissedIds.has(s.id));
  const hasSuggestions = suggestions.length > 0;
  const hasData = analytics && analytics.total_runs > 0;

  return (
    <div className="absolute top-14 right-3 z-30 w-72">
      {/* Toggle button */}
      <motion.button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border backdrop-blur-md transition-all text-left ${
          hasSuggestions
            ? 'bg-indigo-500/8 border-indigo-500/20 hover:border-indigo-500/35'
            : 'bg-secondary/60 border-primary/15 hover:border-primary/25'
        }`}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <div className="relative">
          <Sparkles className={`w-4 h-4 ${hasSuggestions ? 'text-indigo-400' : 'text-muted-foreground'}`} />
          {hasSuggestions && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          )}
        </div>
        <span className={`text-xs font-medium flex-1 ${hasSuggestions ? 'text-foreground/90' : 'text-muted-foreground'}`}>
          Topology Optimizer
          {hasSuggestions && (
            <span className="ml-1.5 text-[10px] text-indigo-400">
              {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </motion.button>

      {/* Panel content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 rounded-xl border border-primary/15 bg-secondary/70 backdrop-blur-md overflow-hidden">
              {/* Stats bar */}
              {hasData && (
                <div className="px-3 py-2 border-b border-primary/10 flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {analytics.total_runs} run{analytics.total_runs !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {Math.round(analytics.success_rate * 100)}% success
                    </span>
                  </div>
                  <div className="flex-1" />
                  <button
                    onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                    className="p-1 rounded-md hover:bg-primary/10 transition-colors"
                    title="Refresh analytics"
                  >
                    <RotateCcw className={`w-3 h-3 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              )}

              {/* Suggestion list */}
              <div className="max-h-80 overflow-y-auto">
                {loading && !analytics && (
                  <div className="px-3 py-6 text-center">
                    <div className="w-5 h-5 mx-auto mb-2 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    <p className="text-[10px] text-muted-foreground">Analyzing pipeline history...</p>
                  </div>
                )}

                {!loading && !hasData && (
                  <div className="px-3 py-6 text-center">
                    <Sparkles className="w-5 h-5 mx-auto mb-2 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground/60">Run the pipeline at least twice</p>
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">to generate optimization insights</p>
                  </div>
                )}

                {hasData && !hasSuggestions && (
                  <div className="px-3 py-6 text-center">
                    <Check className="w-5 h-5 mx-auto mb-2 text-emerald-400/60" />
                    <p className="text-xs text-foreground/60">Topology looks good</p>
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">No improvements detected</p>
                  </div>
                )}

                {suggestions.map((s) => {
                  const colors = SUGGESTION_COLORS[s.suggestion_type] ?? DEFAULT_COLORS;
                  const Icon = SUGGESTION_ICONS[s.suggestion_type] ?? Sparkles;
                  const isHovered = hoveredSuggestion === s.id;

                  return (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      onMouseEnter={() => setHoveredSuggestion(s.id)}
                      onMouseLeave={() => setHoveredSuggestion(null)}
                      className={`px-3 py-2.5 border-b border-primary/8 last:border-b-0 transition-colors ${
                        isHovered ? 'bg-primary/5' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`mt-0.5 p-1 rounded-md ${colors.bg} border ${colors.border}`}>
                          <Icon className={`w-3 h-3 ${colors.text}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[11px] font-semibold text-foreground/90 truncate">
                              {s.title}
                            </span>
                            <ImpactBadge impact={s.impact} />
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                            {s.description}
                          </p>
                          <div className="flex items-center justify-between mt-1.5">
                            <ConfidenceBar value={s.confidence} />
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => onAcceptSuggestion(s)}
                                className="p-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                                title="Accept suggestion"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => onDismissSuggestion(s.id)}
                                className="p-1 rounded-md bg-primary/5 text-muted-foreground border border-primary/15 hover:bg-primary/10 transition-colors"
                                title="Dismiss"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
