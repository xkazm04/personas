/**
 * KpiSteeringPanel — "what the system is doing about this KPI" (cockpit
 * direction D3). The KPI drawer/console shows *sense* (value, trend) and lets
 * the user *calibrate*; this is the missing *act + outcome* half:
 *
 *   · in-flight derived goals — status, progress, advancing team, ETA;
 *   · the OUTCOME TRACE for shipped goals — the KPI's measured delta around the
 *     goal's completion, drawn as the §10 honesty: a goal finishing is NOT
 *     success, so a shipped goal with no measurement after it reads "awaiting
 *     the next measurement", and one that DID re-measure shows whether the line
 *     actually moved (improved / slipped / no change).
 *
 * Pure read-projection over data the drawer already has (`linkedGoals`,
 * `measurements`) + one `goalAdvancingTeams` fetch — no new backend. Built
 * self-contained in `sub_kpis/` so the Factory console can adopt it too.
 */
import { useEffect, useMemo, useState } from 'react';
import { GitBranch, Clock, Users, TrendingUp, TrendingDown, Minus } from 'lucide-react';

import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import { goalAdvancingTeams } from '@/api/devTools/devTools';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import { GoalStatusBadge } from '../sub_goals/GoalStatusBadge';
import { kpiTrack } from './kpiMath';

const ts = (s: string) => new Date(s.replace(' ', 'T')).getTime();
const round = (v: number) => Math.round(v * 100) / 100;

type Verdict = 'improved' | 'regressed' | 'flat' | 'pending';
interface Outcome {
  pre: number | null;
  post: number | null;
  verdict: Verdict;
}

/** The measured delta around a shipped goal: pre = the value at/just before it
 *  completed, post = the FIRST measurement strictly after (the "next
 *  measurement" the derivation doctrine defers the verdict to). `null` post =
 *  not re-measured yet → pending. */
function outcomeFor(goal: DevGoal, kpi: DevKpi, measurements: DevKpiMeasurement[]): Outcome | null {
  if (!goal.completed_at) return null;
  const cT = ts(goal.completed_at);
  const pts = measurements
    .map((m) => ({ t: ts(m.measured_at), v: m.value }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const pre = [...pts].reverse().find((p) => p.t <= cT)?.v ?? kpi.baseline_value ?? null;
  const post = pts.find((p) => p.t > cT)?.v ?? null;
  if (post == null) return { pre, post: null, verdict: 'pending' };
  if (pre == null || post === pre) return { pre, post, verdict: 'flat' };
  const improved = kpi.direction === 'down' ? post < pre : post > pre;
  return { pre, post, verdict: improved ? 'improved' : 'regressed' };
}

export function KpiSteeringPanel({
  kpi,
  linkedGoals,
  measurements,
}: {
  kpi: DevKpi;
  linkedGoals: DevGoal[];
  measurements: DevKpiMeasurement[];
}) {
  const { t, tx } = useTranslation();
  const [teams, setTeams] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    goalAdvancingTeams()
      .then((rows) => { if (!cancelled) setTeams(new Map(rows)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const { open, done } = useMemo(() => {
    const open: DevGoal[] = [];
    const done: DevGoal[] = [];
    for (const g of linkedGoals) (g.completed_at ? done : open).push(g);
    done.sort((a, b) => ts(b.completed_at!) - ts(a.completed_at!));
    return { open, done };
  }, [linkedGoals]);

  const offTrack = kpiTrack(kpi) === 'off-track';
  // Nothing to say when the KPI is fine and no goal ever touched it.
  if (linkedGoals.length === 0 && !offTrack) return null;

  return (
    <div data-testid="kpi-steering-panel">
      <h3 className="typo-overline text-foreground mb-1.5 flex items-center gap-1.5">
        <GitBranch className="w-3.5 h-3.5" /> {t.kpis.steering_title}
      </h3>

      {linkedGoals.length === 0 && offTrack && (
        <p className="typo-caption text-foreground opacity-80">{t.kpis.steering_none_offtrack}</p>
      )}

      <div className="space-y-2">
        {open.map((g) => {
          const team = teams.get(g.id);
          const overdue = g.target_date != null && ts(g.target_date) < Date.now();
          return (
            <div key={g.id} className="rounded-card border border-primary/15 bg-secondary/15 px-3 py-2">
              <div className="flex items-center gap-2">
                <GoalStatusBadge status={g.status} />
                <span className="flex-1 typo-body text-foreground truncate">{g.title}</span>
                <span className="typo-caption text-foreground tabular-nums">{g.progress}%</span>
              </div>
              {(team || g.target_date) && (
                <div className="flex items-center gap-3 mt-1 typo-caption text-foreground opacity-80">
                  {team && (
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3 h-3" /> {team}
                    </span>
                  )}
                  {g.target_date && (
                    <span className={`inline-flex items-center gap-1 ${overdue ? 'text-status-error' : ''}`}>
                      <Clock className="w-3 h-3" /> {tx(t.kpis.due_by, { date: g.target_date.slice(0, 10) })}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {done.map((g) => {
          const o = outcomeFor(g, kpi, measurements);
          return (
            <div key={g.id} className="rounded-card border border-primary/10 bg-secondary/10 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 typo-body text-foreground truncate">{g.title}</span>
                <span className="typo-caption text-foreground opacity-70 inline-flex items-center gap-1">
                  {t.kpis.goal_marker_done} <RelativeTime timestamp={g.completed_at!} />
                </span>
              </div>
              {o && <OutcomeLine o={o} kpi={kpi} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OutcomeLine({ o, kpi }: { o: Outcome; kpi: DevKpi }) {
  const { t, tx } = useTranslation();
  const unit = kpi.unit || '';
  if (o.verdict === 'pending') {
    return <p className="typo-caption text-foreground opacity-70 mt-1">{t.kpis.steering_outcome_pending}</p>;
  }
  if (o.verdict === 'flat') {
    return (
      <p className="typo-caption mt-1 inline-flex items-center gap-1" style={{ color: 'var(--muted-foreground)' }}>
        <Minus className="w-3 h-3" /> {tx(t.kpis.steering_outcome_flat, { value: round(o.post ?? 0), unit })}
      </p>
    );
  }
  const improved = o.verdict === 'improved';
  const Icon = improved ? TrendingUp : TrendingDown;
  const color = improved ? 'var(--status-success)' : 'var(--status-error)';
  const key = improved ? t.kpis.steering_outcome_improved : t.kpis.steering_outcome_regressed;
  return (
    <p className="typo-caption mt-1 inline-flex items-center gap-1" style={{ color }}>
      <Icon className="w-3 h-3" /> {tx(key, { from: round(o.pre ?? 0), to: round(o.post ?? 0), unit })}
    </p>
  );
}
