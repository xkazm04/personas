import { AlertTriangle, Zap, ArrowRight, Shield, TrendingDown, DollarSign } from 'lucide-react';
import type { PersonaHealthSignal, RoutingRecommendation } from '@/stores/slices/overview/personaHealthSlice';
import { useTranslation } from '@/i18n/useTranslation';

interface PredictiveAlertsProps {
  signals: PersonaHealthSignal[];
  recommendations: RoutingRecommendation[];
}

interface PredictiveAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  personaName: string;
  personaIcon: string | null;
  metric: string;
}

const SEVERITY_STYLES = {
  critical: {
    border: 'border-red-500/20',
    bg: 'bg-red-500/5',
    badge: 'bg-red-500/15 text-red-400 border-red-500/25',
    icon: 'text-red-400',
  },
  warning: {
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/5',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    icon: 'text-amber-400',
  },
  info: {
    border: 'border-blue-500/20',
    bg: 'bg-blue-500/5',
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    icon: 'text-blue-400',
  },
};

function buildPredictiveAlerts(signals: PersonaHealthSignal[]): PredictiveAlert[] {
  const { t } = useTranslation();
  const alerts: PredictiveAlert[] = [];

  for (const s of signals) {
    // Budget exhaustion prediction
    if (s.projectedExhaustionDays !== null && s.projectedExhaustionDays <= 7) {
      alerts.push({
        id: `budget-${s.personaId}`,
        severity: s.projectedExhaustionDays <= 2 ? 'critical' : 'warning',
        icon: DollarSign,
        title: s.projectedExhaustionDays === 0
          ? t.overview.predictive_alerts_extra.budget_exhausted
          : `Budget exhaustion in ${s.projectedExhaustionDays}d`,
        description: `Daily burn rate: $${s.dailyBurnRate.toFixed(2)}/day. Projected monthly: $${s.projectedMonthlyCost.toFixed(2)}.`,
        personaName: s.personaName,
        personaIcon: s.personaIcon,
        metric: `${(s.budgetRatio * 100).toFixed(0)}% used`,
      });
    }

    // Failure prediction
    if (s.predictedFailureInDays !== null) {
      alerts.push({
        id: `failure-${s.personaId}`,
        severity: s.predictedFailureInDays <= 3 ? 'critical' : 'warning',
        icon: TrendingDown,
        title: `Failure rate spike predicted in ${s.predictedFailureInDays}d`,
        description: `Success rate trending down. Current: ${s.successRate.toFixed(1)}%. Healing frequency: ${s.healingFrequency.toFixed(1)}/day.`,
        personaName: s.personaName,
        personaIcon: s.personaIcon,
        metric: `${s.successRate.toFixed(0)}% success`,
      });
    }

    // High healing frequency
    if (s.healingFrequency > 3) {
      alerts.push({
        id: `healing-${s.personaId}`,
        severity: 'warning',
        icon: AlertTriangle,
        title: t.overview.predictive_alerts_extra.excessive_healing,
        description: `${s.healingFrequency.toFixed(1)} healing events/day suggests systemic instability. ${s.rollbackCount} circuit-breaker triggers.`,
        personaName: s.personaName,
        personaIcon: s.personaIcon,
        metric: `${s.healingFrequency.toFixed(1)}/day`,
      });
    }

    // Critical grade
    if (s.grade === 'critical' && s.totalExecutions > 5) {
      alerts.push({
        id: `critical-${s.personaId}`,
        severity: 'critical',
        icon: Zap,
        title: t.overview.predictive_alerts_extra.critical_health,
        description: `Heartbeat score: ${s.heartbeatScore}/100. Multiple health signals degraded.`,
        personaName: s.personaName,
        personaIcon: s.personaIcon,
        metric: `${s.heartbeatScore}/100`,
      });
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

export function PredictiveAlerts({ signals, recommendations }: PredictiveAlertsProps) {
  const { t } = useTranslation();
  const alerts = buildPredictiveAlerts(signals);

  if (alerts.length === 0 && recommendations.length === 0) {
    return (
      <div className="rounded-modal border border-primary/10 bg-secondary/10 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-card bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Shield className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="typo-heading text-foreground/90">{t.overview.predictive_alerts_extra.title}</h3>
            <p className="text-xs text-muted-foreground/70">{t.overview.predictive_alerts_extra.all_nominal}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-4 rounded-card bg-emerald-500/5 border border-emerald-500/15">
          <Shield className="w-5 h-5 text-emerald-400" />
          <p className="text-sm text-emerald-400/80">{t.overview.predictive_alerts_extra.no_alerts}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/10 p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-card bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        </div>
        <div>
          <h3 className="typo-heading text-foreground/90">Predictive Alerts</h3>
          <p className="text-xs text-muted-foreground/70">
            {alerts.length} alert{alerts.length !== 1 ? 's' : ''}{recommendations.length > 0 ? `, ${recommendations.length} recommendation${recommendations.length !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2 mb-4">
          {alerts.map((alert) => {
            const styles = SEVERITY_STYLES[alert.severity];
            const Icon = alert.icon;
            return (
              <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-card border ${styles.border} ${styles.bg}`}>
                <Icon className={`w-4 h-4 ${styles.icon} flex-shrink-0 mt-0.5`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="typo-caption text-foreground/90">{alert.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${styles.badge}`}>{alert.severity}</span>
                  </div>
                  <p className="text-xs text-muted-foreground/70">{alert.description}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-muted-foreground/50">
                      {alert.personaIcon && <span className="mr-0.5">{alert.personaIcon}</span>}
                      {alert.personaName}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">{alert.metric}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* BYOM Routing Recommendations */}
      {recommendations.length > 0 && (
        <div className="pt-3 border-t border-primary/10">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="w-3.5 h-3.5 text-violet-400" />
            <span className="typo-caption text-foreground/80">{t.overview.predictive_alerts_extra.byom_recommendations}</span>
          </div>
          <div className="space-y-2">
            {recommendations.map((rec) => (
              <div key={rec.personaId} className="flex items-center gap-3 p-3 rounded-card border border-violet-500/15 bg-violet-500/5">
                <div className="flex-1 min-w-0">
                  <p className="typo-caption text-foreground/80">{rec.personaName}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground/70">{rec.currentProvider ?? 'default'}</span>
                    <ArrowRight className="w-3 h-3 text-violet-400" />
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20">{rec.recommendedProvider}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">{rec.reason}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="typo-caption text-emerald-400">-${rec.estimatedSaving.toFixed(2)}/mo</p>
                  <p className="text-[10px] text-muted-foreground/50">{(rec.confidence * 100).toFixed(0)}% conf</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
