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

const RING_SIZES: Record<'lg' | 'md' | 'sm', RingSizeConfig> = {
  lg: { wrapperClass: 'w-24 h-24', viewBox: '0 0 80 80', cx: 40, radius: 36, strokeWidth: 4, fontClass: 'typo-heading-lg' },
  md: { wrapperClass: 'w-16 h-16', viewBox: '0 0 64 64', cx: 32, radius: 28, strokeWidth: 3, fontClass: 'typo-heading' },
  sm: { wrapperClass: 'w-12 h-12', viewBox: '0 0 40 40', cx: 20, radius: 18, strokeWidth: 3, fontClass: 'typo-caption' },
};

/**
 * Circular SVG progress indicator for a HealthScore.
 *
 * Uses {@link GRADE_COLORS}'s strokeHex palette so the colour stays in sync
 * with the score badge / other health surfaces. When `animated` is true the
 * ring transitions its `strokeDashoffset` to reflect `score.value`; when
 * false (default) the ring renders at full circumference (legacy behaviour
 * for `lg` / `sm` consumers that pre-dated animation support).
 *
 * Sizes: `lg` (96px, dashboard hero), `md` (64px, panel embedded), `sm`
 * (48px, sidebar / digest row).
 */
export function ScoreRing({
  score,
  size = 'lg',
  animated = false,
}: {
  score: HealthScore;
  size?: 'lg' | 'md' | 'sm';
  animated?: boolean;
}) {
  const cfg = RING_SIZES[size];
  const circumference = 2 * Math.PI * cfg.radius;
  const dashOffset = animated ? circumference * (1 - score.value / 100) : undefined;

  return (
    <div className={`relative ${cfg.wrapperClass} flex-shrink-0`}>
      <svg className="w-full h-full -rotate-90" viewBox={cfg.viewBox} aria-hidden="true" role="presentation">
        <circle cx={cfg.cx} cy={cfg.cx} r={cfg.radius} fill="none" stroke="currentColor" strokeWidth={cfg.strokeWidth} className="text-primary/10" />
        <circle
          className={animated ? 'transition-all duration-700' : 'animate-fade-in'}
          cx={cfg.cx} cy={cfg.cx} r={cfg.radius} fill="none" stroke={GRADE_COLORS[score.grade].strokeHex} strokeWidth={cfg.strokeWidth}
          strokeLinecap="round" strokeDasharray={circumference}
          {...(dashOffset !== undefined ? { strokeDashoffset: dashOffset } : {})}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`${cfg.fontClass} font-bold text-foreground/90`}>{score.value}</span>
      </div>
    </div>
  );
}
