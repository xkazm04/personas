import { useTranslation } from '@/i18n/useTranslation';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ChevronDown, ChevronUp, RotateCcw, BarChart3, TrendingUp } from 'lucide-react';
import type { PipelineAnalytics } from '@/lib/bindings/PipelineAnalytics';
import type { TopologySuggestion } from '@/lib/bindings/TopologySuggestion';
import OptimizerResults from './OptimizerResults';

interface OptimizerPanelProps {
  analytics: PipelineAnalytics | null;
  loading: boolean;
  onAcceptSuggestion: (suggestion: TopologySuggestion) => void;
  onDismissSuggestion: (suggestionId: string) => void;
  onRefresh: () => void;
  dismissedIds: Set<string>;
}

export default function OptimizerPanel({
  analytics,
  loading,
  onAcceptSuggestion,
  onDismissSuggestion,
  onRefresh,
  dismissedIds,
}: OptimizerPanelProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  const [expanded, setExpanded] = useState(false);

  const suggestions = (analytics?.suggestions ?? []).filter((s) => !dismissedIds.has(s.id));
  const hasSuggestions = suggestions.length > 0;
  const hasData = analytics && analytics.total_runs > 0;

  return (
    <div className="absolute top-14 right-3 z-30 w-72">
      {/* Toggle button */}
      <motion.button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-modal border backdrop-blur-md transition-all text-left ${
          hasSuggestions
            ? 'bg-indigo-500/8 border-indigo-500/20 hover:border-indigo-500/35'
            : 'bg-secondary/60 border-primary/15 hover:border-primary/25'
        }`}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <div className="relative">
          <Sparkles className={`w-4 h-4 ${hasSuggestions ? 'text-indigo-400' : 'text-foreground'}`} />
          {hasSuggestions && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          )}
        </div>
        <span className={`typo-body font-medium flex-1 ${hasSuggestions ? 'text-foreground/90' : 'text-foreground'}`}>
          {pt.topology_optimizer}
          {hasSuggestions && (
            <span className="ml-1.5 typo-body text-indigo-400">
              {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-foreground" />
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
            <div className="mt-1.5 rounded-modal border border-primary/15 bg-secondary/70 backdrop-blur-md overflow-hidden">
              {/* Stats bar */}
              {hasData && (
                <div className="px-3 py-2 border-b border-primary/10 flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="w-3 h-3 text-foreground" />
                    <span className="typo-code text-foreground font-mono">
                      {analytics.total_runs} run{analytics.total_runs !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-foreground" />
                    <span className="typo-code text-foreground font-mono">
                      {pt.success_rate.replace('{rate}', String(Math.round(analytics.success_rate * 100)))}
                    </span>
                  </div>
                  <div className="flex-1" />
                  <button
                    onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                    className="p-1 rounded-card hover:bg-primary/10 transition-colors"
                    title={pt.refresh_analytics}
                  >
                    <RotateCcw className={`w-3 h-3 text-foreground ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              )}

              <OptimizerResults
                suggestions={suggestions}
                loading={loading}
                hasData={!!hasData}
                onAcceptSuggestion={onAcceptSuggestion}
                onDismissSuggestion={onDismissSuggestion}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
