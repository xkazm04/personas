import { Activity } from 'lucide-react';
import type { HealthScore } from './types';
import { useTranslation } from '@/i18n/useTranslation';
import { GRADE_COLORS } from './gradeColors';

// -- Score badge --------------------------------------------------

export function ScoreBadge({ score }: { score: HealthScore }) {
  const { t } = useTranslation();
  const gradeLabels = {
    healthy: t.agents.health_score.healthy,
    degraded: t.agents.health_score.degraded,
    unhealthy: t.agents.health_score.unhealthy,
  };

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-modal typo-heading font-semibold border ${GRADE_COLORS[score.grade].badgeClass}`}>
      <Activity className="w-4 h-4" aria-hidden="true" />
      <span>{score.value}</span>
      <span className="typo-caption font-normal opacity-70">{gradeLabels[score.grade]}</span>
    </div>
  );
}

// -- Score ring visualization -------------------------------------

export function ScoreRing({ score }: { score: HealthScore }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80" aria-hidden="true" role="presentation">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="currentColor" strokeWidth="4" className="text-primary/10" />
        <circle className="animate-fade-in"
          cx="40" cy="40" r={radius} fill="none" stroke={GRADE_COLORS[score.grade].strokeHex} strokeWidth="4"
          strokeLinecap="round" strokeDasharray={circumference}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="typo-heading-lg font-bold text-foreground/90">{score.value}</span>
      </div>
    </div>
  );
}
