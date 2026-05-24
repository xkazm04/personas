import type { HealthGrade } from './types';

interface GradeColorEntry {
  /** Tailwind classes for the grade badge background/border/text. */
  badgeClass: string;
  /** Hex stroke color for the score ring SVG. */
  strokeHex: string;
}

export const GRADE_COLORS: Record<HealthGrade, GradeColorEntry> = {
  healthy:  { badgeClass: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', strokeHex: '#10B981' },
  degraded: { badgeClass: 'text-amber-400 bg-amber-500/10 border-amber-500/30',       strokeHex: '#F59E0B' },
  unhealthy:{ badgeClass: 'text-red-400 bg-red-500/10 border-red-500/30',             strokeHex: '#EF4444' },
};
