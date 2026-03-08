import { useMemo } from 'react';
import { TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

export function HealingIssueSummary({ issues }: { issues: PersonaHealingIssue[] }) {
  const stats = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    const openIssues = issues.filter((i) => i.status !== 'resolved');
    const autoFixedThisWeek = issues.filter(
      (i) => i.auto_fixed && new Date(i.created_at).getTime() >= weekAgo,
    );

    const recentCategoryCounts = new Map<string, number>();
    for (const issue of issues) {
      if (new Date(issue.created_at).getTime() >= weekAgo) {
        recentCategoryCounts.set(issue.category, (recentCategoryCounts.get(issue.category) || 0) + 1);
      }
    }
    const recurring = Array.from(recentCategoryCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);

    const thisWeekCount = issues.filter(
      (i) => new Date(i.created_at).getTime() >= weekAgo,
    ).length;
    const lastWeekCount = issues.filter((i) => {
      const t = new Date(i.created_at).getTime();
      return t >= twoWeeksAgo && t < weekAgo;
    }).length;

    let trend: 'improving' | 'worsening' | 'stable' = 'stable';
    if (thisWeekCount < lastWeekCount) trend = 'improving';
    else if (thisWeekCount > lastWeekCount) trend = 'worsening';

    return { openIssues: openIssues.length, autoFixedThisWeek: autoFixedThisWeek.length, recurring, trend, thisWeekCount, lastWeekCount };
  }, [issues]);

  const TrendIcon = stats.trend === 'improving' ? TrendingDown : stats.trend === 'worsening' ? TrendingUp : ArrowRight;
  const trendColor = stats.trend === 'improving' ? 'text-emerald-400' : stats.trend === 'worsening' ? 'text-red-400' : 'text-muted-foreground/90';
  const trendBg = stats.trend === 'improving' ? 'bg-emerald-500/10' : stats.trend === 'worsening' ? 'bg-red-500/10' : 'bg-secondary/40';
  const trendLabel = stats.trend === 'improving' ? 'Improving' : stats.trend === 'worsening' ? 'Worsening' : 'Stable';

  return (
    <div className="px-4 py-3 border-b border-primary/10 bg-secondary/20">
      <div className="flex items-center gap-4 flex-wrap text-sm">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground/90">{stats.openIssues}</span>
          <span className="text-muted-foreground/90">open</span>
        </div>

        <span className="text-primary/15">|</span>

        <div className="flex items-center gap-1.5">
          <span className="font-medium text-emerald-400">{stats.autoFixedThisWeek}</span>
          <span className="text-muted-foreground/90">auto-fixed this week</span>
        </div>

        <span className="text-primary/15">|</span>

        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg ${trendBg}`}>
          <TrendIcon className={`w-3 h-3 ${trendColor}`} />
          <span className={`font-medium ${trendColor}`}>{trendLabel}</span>
        </div>

        {stats.recurring.length > 0 && (
          <>
            <span className="text-primary/15">|</span>
            {stats.recurring.map(([category, count]) => (
              <span key={category} className="text-amber-400/80">
                {count} {category} issues in 7d
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
