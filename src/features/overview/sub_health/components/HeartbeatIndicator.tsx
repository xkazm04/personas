import { useMemo } from 'react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { HealthGrade } from '@/stores/slices/overview/personaHealthSlice';

interface HeartbeatIndicatorProps {
  score: number;
  grade: HealthGrade;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
  /** When provided, renders the persona icon in the center instead of the score number. */
  personaIcon?: string | null;
  personaColor?: string | null;
}

const GRADE_COLORS: Record<HealthGrade, { ring: string; pulse: string; bg: string }> = {
  healthy: { ring: 'border-emerald-400', pulse: 'bg-emerald-400', bg: 'bg-emerald-400/20' },
  degraded: { ring: 'border-amber-400', pulse: 'bg-amber-400', bg: 'bg-amber-400/20' },
  critical: { ring: 'border-red-400', pulse: 'bg-red-400', bg: 'bg-red-400/20' },
  unknown: { ring: 'border-zinc-500', pulse: 'bg-zinc-500', bg: 'bg-zinc-500/20' },
};

const SIZE_MAP = {
  sm: { outer: 'w-8 h-8', inner: 'w-3 h-3', text: 'text-[9px]', iconSize: 'w-4 h-4' },
  md: { outer: 'w-12 h-12', inner: 'w-4 h-4', text: 'text-xs', iconSize: 'w-6 h-6' },
  lg: { outer: 'w-16 h-16', inner: 'w-5 h-5', text: 'text-sm', iconSize: 'w-8 h-8' },
};

export function HeartbeatIndicator({ score, grade, size = 'md', animate = true, personaIcon, personaColor }: HeartbeatIndicatorProps) {
  const colors = GRADE_COLORS[grade];
  const dims = SIZE_MAP[size];

  const pulseSpeed = useMemo(() => {
    if (!animate || grade === 'unknown') return 'none';
    if (grade === 'critical') return '1s';
    if (grade === 'degraded') return '2s';
    return '3s';
  }, [animate, grade]);

  return (
    <div className={`relative ${dims.outer} flex items-center justify-center`}>
      {/* Pulse ring */}
      {pulseSpeed !== 'none' && (
        <span
          className={`absolute inset-0 rounded-full ${colors.bg} animate-ping`}
          style={{ animationDuration: pulseSpeed }}
        />
      )}
      {/* Score circle with icon or number */}
      <div className={`relative ${dims.outer} rounded-full border-2 ${colors.ring} ${colors.bg} flex items-center justify-center`}>
        {personaIcon !== undefined ? (
          <PersonaIcon icon={personaIcon} color={personaColor ?? null} size={dims.iconSize} display='framed' frameSize={"lg"} />
        ) : (
          <span className={`${dims.text} font-bold text-foreground/90`}>{score}</span>
        )}
      </div>
    </div>
  );
}
