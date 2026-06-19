import { useMemo } from 'react';
import { AlertTriangle, Shield, Zap, DollarSign, TrendingDown, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { PersonaHealthSignal, RoutingRecommendation } from '@/stores/slices/overview/personaHealthSlice';
import { InsightPanel } from './InsightPanel';
import { buildAlerts, type InsightAlert, type AlertKind } from './data';

const ALERT_ICON: Record<AlertKind, LucideIcon> = {
  budget: DollarSign, failure: TrendingDown, healing: AlertTriangle, critical: Zap,
};
const SEV: Record<InsightAlert['severity'], { border: string; bg: string; text: string }> = {
  critical: { border: 'border-status-error/20', bg: 'bg-status-error/5', text: 'text-status-error' },
  warning: { border: 'border-status-warning/20', bg: 'bg-status-warning/5', text: 'text-status-warning' },
};

export function AlertsPanel({ signals, recommendations }: { signals: PersonaHealthSignal[]; recommendations: RoutingRecommendation[] }) {
  const { t } = useTranslation();
  const pa = t.overview.predictive_alerts_extra;
  const alerts = useMemo(() => buildAlerts(signals, t), [signals, t]);
  const empty = alerts.length === 0 && recommendations.length === 0;

  const subtitle = empty
    ? pa.all_nominal
    : `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}${recommendations.length > 0 ? `, ${recommendations.length} rec${recommendations.length !== 1 ? 's' : ''}` : ''}`;

  return (
    <InsightPanel icon={empty ? Shield : AlertTriangle} accent={empty ? 'success' : 'warning'} title={pa.title} subtitle={subtitle}>
      {empty ? (
        <div className="flex items-center gap-2 px-3 py-4 rounded-card bg-status-success/5 border border-status-success/15">
          <Shield className="w-5 h-5 text-status-success shrink-0" />
          <p className="typo-body text-status-success">{pa.no_alerts}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map(a => <AlertRow key={a.id} alert={a} />)}
          {recommendations.length > 0 && (
            <div className="pt-2 mt-1 border-t border-primary/10">
              <div className="flex items-center gap-1.5 mb-2">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="typo-caption text-foreground">{pa.byom_recommendations}</span>
              </div>
              <div className="flex flex-col gap-2">
                {recommendations.map(r => (
                  <div key={r.personaId} className="flex items-center gap-2 p-2.5 rounded-card border border-primary/15 bg-primary/5">
                    <div className="flex-1 min-w-0">
                      <p className="typo-caption text-foreground truncate">{r.personaName}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="typo-code px-1.5 py-0.5 rounded bg-secondary/60 text-foreground">{r.currentProvider ?? 'default'}</span>
                        <ArrowRight className="w-3 h-3 text-primary shrink-0" />
                        <span className="typo-code px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/20">{r.recommendedProvider}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="typo-data text-status-success">-<Numeric value={r.estimatedSaving} unit="usd" />{pa.per_month}</p>
                      <p className="typo-caption text-foreground tabular-nums"><Numeric value={r.confidence * 100} precision={0} />{pa.confidence_pct}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </InsightPanel>
  );
}

function AlertRow({ alert }: { alert: InsightAlert }) {
  const sv = SEV[alert.severity];
  const Icon = ALERT_ICON[alert.kind];
  return (
    <div className={`flex items-start gap-2.5 p-2.5 rounded-card border ${sv.border} ${sv.bg}`}>
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${sv.text}`} />
      <div className="flex-1 min-w-0">
        <p className="typo-caption text-foreground/90">{alert.title}</p>
        <div className="flex items-center gap-2 mt-1 min-w-0">
          <span className="inline-flex items-center gap-1 typo-caption text-foreground min-w-0">
            <PersonaIcon icon={alert.personaIcon} color={alert.personaColor} display="framed" frameSize="xs" />
            <span className="truncate">{alert.personaName}</span>
          </span>
          <span className={`typo-data tabular-nums shrink-0 ${sv.text}`}>{alert.metric}</span>
        </div>
      </div>
    </div>
  );
}
