import { memo, useMemo } from 'react';
import { X, Search, AlertTriangle, Clock, ArrowRight, Zap, Shield, RefreshCw, Bell, HelpCircle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { AnomalyDrilldownData } from '@/lib/bindings/AnomalyDrilldownData';
import type { CorrelatedEvent } from '@/lib/bindings/CorrelatedEvent';
import type { RootCauseSuggestion } from '@/lib/bindings/RootCauseSuggestion';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import { useTranslation } from '@/i18n/useTranslation';

interface AnomalyDrilldownPanelProps {
  anomaly: MetricAnomaly;
  data: AnomalyDrilldownData | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

const EVENT_TYPE_CONFIG: Record<string, { icon: typeof Search; color: string; bg: string }> = {
  prompt_deployment: { icon: Zap, color: 'text-violet-400', bg: 'bg-violet-500/15' },
  credential_rotation: { icon: RefreshCw, color: 'text-amber-400', bg: 'bg-amber-500/15' },
  circuit_breaker: { icon: Shield, color: 'text-red-400', bg: 'bg-red-500/15' },
  healing_issue: { icon: RefreshCw, color: 'text-cyan-400', bg: 'bg-cyan-500/15' },
  alert: { icon: Bell, color: 'text-orange-400', bg: 'bg-orange-500/15' },
  external: { icon: HelpCircle, color: 'text-muted-foreground', bg: 'bg-secondary/30' },
};

const METRIC_LABELS: Record<string, string> = {
  cost: 'Cost',
  error_rate: 'Error Rate',
  latency: 'Latency (P95)',
};

function formatOffset(seconds: number): string {
  const abs = Math.abs(seconds);
  const direction = seconds < 0 ? 'before' : 'after';
  if (abs < 60) return `${Math.round(abs)}s ${direction}`;
  if (abs < 3600) return `${Math.round(abs / 60)}m ${direction}`;
  return `${(abs / 3600).toFixed(1)}h ${direction}`;
}

function confidenceBar(confidence: number) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-secondary/30 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground/70 tabular-nums">{pct}%</span>
    </div>
  );
}

const CorrelatedEventRow = memo(function CorrelatedEventRow({ event }: { event: CorrelatedEvent }) {
  const config = EVENT_TYPE_CONFIG[event.eventType] ?? EVENT_TYPE_CONFIG.external!;
  const Icon = config.icon;

  return (
    <div className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-secondary/20 transition-colors group">
      {/* Timeline dot + icon */}
      <div className={`flex-shrink-0 w-7 h-7 rounded-lg ${config.bg} flex items-center justify-center mt-0.5`}>
        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground/90 truncate">{event.label}</span>
          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
            {formatOffset(event.offsetSeconds)}
          </span>
        </div>
        {event.detail && (
          <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-2">{event.detail}</p>
        )}
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[10px] text-muted-foreground/50">
            {new Date(event.timestamp).toLocaleString()}
          </span>
          {confidenceBar(event.relevance)}
        </div>
      </div>
    </div>
  );
});

const RootCauseCard = memo(function RootCauseCard({ suggestion }: { suggestion: RootCauseSuggestion }) {
  const config = EVENT_TYPE_CONFIG[suggestion.eventType] ?? EVENT_TYPE_CONFIG.external!;
  const Icon = config.icon;
  const pct = Math.round(suggestion.confidence * 100);

  return (
    <div className="p-3 rounded-xl border border-primary/10 bg-secondary/10 space-y-2">
      <div className="flex items-center gap-2">
        <div className={`w-5 h-5 rounded-md ${config.bg} flex items-center justify-center`}>
          <Icon className={`w-3 h-3 ${config.color}`} />
        </div>
        <span className="text-sm font-semibold text-foreground/90">
          #{suggestion.rank} {suggestion.title}
        </span>
        <span className={`ml-auto text-xs font-medium ${
          pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'
        }`}>
          {pct}% confidence
        </span>
      </div>
      <p className="text-xs text-muted-foreground/80 leading-relaxed">{suggestion.description}</p>
      {suggestion.relatedEventTimestamp && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
          <Clock className="w-3 h-3" />
          {new Date(suggestion.relatedEventTimestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
});

export default function AnomalyDrilldownPanel({ anomaly, data, loading, error, onClose }: AnomalyDrilldownPanelProps) {
  const { t } = useTranslation();
  const metricLabel = METRIC_LABELS[anomaly.metric] ?? anomaly.metric;
  const deviationPct = anomaly.deviation_pct.toFixed(0);

  const sortedEvents = useMemo(() => {
    if (!data) return [];
    return [...data.correlatedEvents].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  }, [data]);

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      titleId="anomaly-drilldown-title"
      maxWidthClass="max-w-2xl"
      panelClassName="bg-background border border-primary/20 rounded-2xl shadow-elevation-4 overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-primary/10 bg-gradient-to-r from-red-500/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center">
              <Search className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h2 id="anomaly-drilldown-title" className="text-base font-semibold text-foreground/90">
                {t.overview.anomaly_drilldown_extra.title}
              </h2>
              <p className="text-xs text-muted-foreground/70">
                {metricLabel} spike on {new Date(anomaly.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Anomaly summary bar */}
        <div className="mt-3 flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground/60">{t.overview.anomaly_drilldown_extra.value_label}</span>
            <span className="font-medium text-red-400">{anomaly.value.toFixed(2)}</span>
          </div>
          <ArrowRight className="w-3 h-3 text-muted-foreground/40" />
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground/60">{t.overview.anomaly_drilldown_extra.baseline_label}</span>
            <span className="font-medium text-muted-foreground">{anomaly.baseline.toFixed(2)}</span>
          </div>
          <div className="ml-auto px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold text-[11px]">
            +{deviationPct}%
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-h-[60vh] overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner size="md" />
            <span className="ml-3 text-sm text-muted-foreground/70">{t.overview.anomaly_drilldown_extra.correlating}</span>
          </div>
        )}

        {error && (
          <div className="m-4 p-3 rounded-xl border border-red-500/20 bg-red-500/10 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {data && !loading && (
          <div className="p-4 space-y-5">
            {/* Root Cause Suggestions */}
            {data.rootCauseSuggestions.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-2">
                  {t.overview.anomaly_drilldown_extra.likely_root_causes}
                </h3>
                <div className="space-y-2">
                  {data.rootCauseSuggestions.map((s) => (
                    <RootCauseCard key={`${s.rank}-${s.eventType}`} suggestion={s} />
                  ))}
                </div>
              </section>
            )}

            {/* Correlated Events Timeline */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-2">
                Correlated Events ({data.correlatedEvents.length})
              </h3>
              {sortedEvents.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground/60">
                  {t.overview.anomaly_drilldown_extra.no_correlated}
                </div>
              ) : (
                <div className="space-y-0.5 relative">
                  {/* Timeline line */}
                  <div className="absolute left-[13px] top-3 bottom-3 w-px bg-primary/10" />
                  {sortedEvents.map((event, i) => (
                    <CorrelatedEventRow key={`${event.timestamp}-${event.eventType}-${i}`} event={event} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
