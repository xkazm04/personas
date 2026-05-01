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

interface RingSizeConfig {
  wrapperClass: string;
  viewBox: string;
  cx: number;
  radius: number;
  strokeWidth: number;
  fontClass: string;
}

const RING_SIZES: Record<'lg' | 'sm', RingSizeConfig> = {
  lg: { wrapperClass: 'w-24 h-24', viewBox: '0 0 80 80', cx: 40, radius: 36, strokeWidth: 4, fontClass: 'typo-heading-lg' },
  sm: { wrapperClass: 'w-12 h-12', viewBox: '0 0 40 40', cx: 20, radius: 18, strokeWidth: 3, fontClass: 'typo-caption' },
};

export function ScoreRing({ score, size = 'lg' }: { score: HealthScore; size?: 'lg' | 'sm' }) {
  const cfg = RING_SIZES[size];
  const circumference = 2 * Math.PI * cfg.radius;

  return (
    <div className={`relative ${cfg.wrapperClass} flex-shrink-0`}>
      <svg className="w-full h-full -rotate-90" viewBox={cfg.viewBox} aria-hidden="true" role="presentation">
        <circle cx={cfg.cx} cy={cfg.cx} r={cfg.radius} fill="none" stroke="currentColor" strokeWidth={cfg.strokeWidth} className="text-primary/10" />
        <circle className="animate-fade-in"
          cx={cfg.cx} cy={cfg.cx} r={cfg.radius} fill="none" stroke={GRADE_COLORS[score.grade].strokeHex} strokeWidth={cfg.strokeWidth}
          strokeLinecap="round" strokeDasharray={circumference}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`${cfg.fontClass} font-bold text-foreground/90`}>{score.value}</span>
      </div>
    </div>
  );
}
