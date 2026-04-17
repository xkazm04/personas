import { useTranslation } from '@/i18n/useTranslation';
import { useState } from 'react';
import { Sparkles, Check, X } from 'lucide-react';
import type { TopologySuggestion } from '@/lib/bindings/TopologySuggestion';

// -- Shared constants -------------------------------------------------

import {
  GitBranch,
  AlertTriangle,
  Unlink,
  RotateCcw,
  ArrowRightLeft,
} from 'lucide-react';

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

// -- Sub-components ---------------------------------------------------

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
      <span className="text-sm text-muted-foreground font-mono">{Math.round(value * 100)}%</span>
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
    <span className={`px-1.5 py-0.5 text-sm font-mono uppercase rounded border ${colors[impact as keyof typeof colors] ?? colors.low}`}>
      {impact}
    </span>
  );
}

// -- Main -------------------------------------------------------------

interface OptimizerResultsProps {
  suggestions: TopologySuggestion[];
  loading: boolean;
  hasData: boolean;
  onAcceptSuggestion: (suggestion: TopologySuggestion) => void;
  onDismissSuggestion: (suggestionId: string) => void;
}

export default function OptimizerResults({
  suggestions,
  loading,
  hasData,
  onAcceptSuggestion,
  onDismissSuggestion,
}: OptimizerResultsProps) {
  const { t } = useTranslation();
  const pt = t.pipeline;
  const [hoveredSuggestion, setHoveredSuggestion] = useState<string | null>(null);

  return (
    <div className="max-h-80 overflow-y-auto">
      {loading && !hasData && (
        <div className="px-3 py-6 text-center">
          <div className="w-5 h-5 mx-auto mb-2 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">{pt.analyzing_pipeline}</p>
        </div>
      )}

      {!loading && !hasData && (
        <div className="px-3 py-6 text-center">
          <Sparkles className="w-5 h-5 mx-auto mb-2 text-muted-foreground/80" />
          <p className="text-sm text-muted-foreground/80">{pt.run_pipeline_twice}</p>
          <p className="text-sm text-muted-foreground/80 mt-0.5">{pt.run_pipeline_twice_hint}</p>
        </div>
      )}

      {hasData && suggestions.length === 0 && (
        <div className="px-3 py-6 text-center">
          <Check className="w-5 h-5 mx-auto mb-2 text-emerald-400/60" />
          <p className="text-sm text-foreground/80">{pt.topology_looks_good}</p>
          <p className="text-sm text-muted-foreground/80 mt-0.5">{pt.no_improvements}</p>
        </div>
      )}

      {suggestions.map((s) => {
        const colors = SUGGESTION_COLORS[s.suggestion_type] ?? DEFAULT_COLORS;
        const Icon = SUGGESTION_ICONS[s.suggestion_type] ?? Sparkles;
        const isHovered = hoveredSuggestion === s.id;

        return (
          <div
            key={s.id}
            onMouseEnter={() => setHoveredSuggestion(s.id)}
            onMouseLeave={() => setHoveredSuggestion(null)}
            className={`animate-fade-slide-in px-3 py-2.5 border-b border-primary/8 last:border-b-0 transition-colors ${
              isHovered ? 'bg-primary/5' : ''
            }`}
          >
            <div className="flex items-start gap-2">
              <div className={`mt-0.5 p-1 rounded-card ${colors.bg} border ${colors.border}`}>
                <Icon className={`w-3 h-3 ${colors.text}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-sm font-semibold text-foreground/90 truncate">
                    {s.title}
                  </span>
                  <ImpactBadge impact={s.impact} />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                  {s.description}
                </p>
                <div className="flex items-center justify-between mt-1.5">
                  <ConfidenceBar value={s.confidence} />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onAcceptSuggestion(s)}
                      className="p-1 rounded-card bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                      title={pt.accept_suggestion}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onDismissSuggestion(s.id)}
                      className="p-1 rounded-card bg-primary/5 text-muted-foreground border border-primary/15 hover:bg-primary/10 transition-colors"
                      title={t.common.dismiss}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
