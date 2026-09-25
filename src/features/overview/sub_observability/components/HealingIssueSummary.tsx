import { useMemo } from 'react';
import { Dot, Meta } from '@/features/shared/components/kit';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { ObservabilityWords } from '../libs/useObservabilityWords';

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * The health issues' one-line summary, as the Section's meta: open count, auto-fixes this week,
 * the week-over-week trend (a Dot in its tone) and the categories recurring in the last 7 days.
 */
export function HealingIssueSummary({ issues, w }: { issues: PersonaHealingIssue[]; w: ObservabilityWords }) {
  const { o } = w;
  const stats = useMemo(() => {
    const now = Date.now();
    const at = (i: PersonaHealingIssue) => new Date(i.created_at).getTime();
    const thisWeek = issues.filter((i) => at(i) >= now - WEEK);
    const lastWeek = issues.filter((i) => at(i) >= now - 2 * WEEK && at(i) < now - WEEK).length;
    const byCat = new Map<string, number>();
    for (const i of thisWeek) byCat.set(i.category, (byCat.get(i.category) ?? 0) + 1);
    return {
      open: issues.filter((i) => i.status !== 'resolved').length,
      autoFixed: thisWeek.filter((i) => i.auto_fixed).length,
      trend: thisWeek.length < lastWeek ? 'improving' : thisWeek.length > lastWeek ? 'degrading' : 'stable',
      recurring: [...byCat.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]),
    } as const;
  }, [issues]);

  const trend = {
    improving: { tone: 'success' as const, label: o.health_extra.improving },
    degrading: { tone: 'error' as const, label: o.health_extra.degrading },
    stable: { tone: 'neutral' as const, label: o.health_extra.stable },
  }[stats.trend];
  return (
    <Meta parts={[
      w.tx(o.health_extra.open, { count: stats.open }),
      `${stats.autoFixed} ${o.healing_summary.auto_fixed_this_week}`,
      <span key="trend" className="inline-flex items-center gap-1.5"><Dot tone={trend.tone} />{trend.label}</span>,
      ...stats.recurring.map(([cat, n]) => `${n} ${cat} ${o.healing_summary.issues_in_7d}`),
    ]} />
  );
}
