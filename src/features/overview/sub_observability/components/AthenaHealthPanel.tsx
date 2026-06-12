import { memo } from 'react';
import { Bot, Filter, Bell } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAthenaHealth } from '../libs/useAthenaHealth';

/**
 * Athena operational-health panel in the Observability tab (direction 6 / A4).
 * Operational quality rather than spend: the triage funnel (is the signal
 * economy actually filtering?), the proactive economy (are her nudges engaged
 * or dismissed?), and job/error health. Reads `companion_get_health` via
 * {@link useAthenaHealth}.
 */

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 px-3 py-2 min-w-0">
      <div className="typo-caption uppercase tracking-wider text-foreground truncate">{label}</div>
      <div className={`typo-heading tabular-nums ${accent ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}

export const AthenaHealthPanel = memo(function AthenaHealthPanel() {
  const { t, language } = useTranslation();
  const a = t.overview.athena;
  const { data, loading } = useAthenaHealth();

  if (loading && !data) return null;
  if (!data) return null;

  const { triage, proactive, jobs, errors } = data;
  const fmt = (n: number) => Math.round(n).toLocaleString(language);
  const engagedRate = proactive.delivered > 0 ? (proactive.engaged / proactive.delivered) * 100 : 0;
  const anyActivity =
    triage.passes > 0 || proactive.delivered > 0 || jobs.completed + jobs.failed > 0 || errors > 0;

  return (
    <div className="p-4 rounded-modal border border-primary/10 bg-secondary/20 space-y-4" data-testid="athena-health-panel">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-primary" />
        <h3 className="typo-heading text-foreground/90">{a.health_title}</h3>
        <span className="typo-caption text-foreground">{a.health_hint}</span>
      </div>

      {!anyActivity ? (
        <p className="typo-body text-foreground">{a.health_no_activity}</p>
      ) : (
        <>
          {/* Triage funnel */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-cyan-400" />
              <h4 className="typo-heading text-foreground">{a.triage_title}</h4>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <Stat label={a.triage_passes} value={fmt(triage.passes)} />
              <Stat label={a.triage_drop} value={fmt(triage.drop)} />
              <Stat label={a.triage_digest} value={fmt(triage.digest)} accent="text-amber-400" />
              <Stat label={a.triage_attention} value={fmt(triage.attention)} accent="text-rose-400" />
              <Stat label={a.triage_deep_dive} value={fmt(triage.deepDive)} accent="text-violet-400" />
              <Stat
                label={a.triage_parse_failures}
                value={fmt(triage.parseFailures)}
                accent={triage.parseFailures > 0 ? 'text-rose-400' : 'text-foreground'}
              />
            </div>
          </div>

          {/* Proactive economy */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-amber-400" />
              <h4 className="typo-heading text-foreground">{a.proactive_title}</h4>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <Stat label={a.proactive_delivered} value={fmt(proactive.delivered)} />
              <Stat label={a.proactive_engaged} value={fmt(proactive.engaged)} accent="text-emerald-400" />
              <Stat label={a.proactive_dismissed} value={fmt(proactive.dismissed)} />
              <Stat label={a.proactive_expired} value={fmt(proactive.expired)} />
              <Stat label={a.proactive_engaged_rate} value={`${engagedRate.toFixed(0)}%`} accent="text-emerald-400" />
              <Stat
                label={a.proactive_budget}
                value={`${fmt(proactive.budgetUsedToday)} / ${fmt(proactive.budgetCap)}`}
              />
            </div>
          </div>

          {/* Jobs + errors */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label={a.jobs_completed} value={fmt(jobs.completed)} accent="text-emerald-400" />
            <Stat
              label={a.jobs_failed}
              value={fmt(jobs.failed)}
              accent={jobs.failed > 0 ? 'text-rose-400' : 'text-foreground'}
            />
            <Stat
              label={a.errors}
              value={fmt(errors)}
              accent={errors > 0 ? 'text-rose-400' : 'text-foreground'}
            />
          </div>
        </>
      )}
    </div>
  );
});
