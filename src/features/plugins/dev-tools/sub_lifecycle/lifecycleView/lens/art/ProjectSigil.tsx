/**
 * A project's own mark (from the Lens winner's `art.rosette`): its steps as
 * petals around a monogram disc in the project's own hue. The petals are
 * DATA - each one is that project's verdict at that step - so the artwork is
 * also the practice's signature. The hue is kept off the status band, so a
 * mark never reads as a verdict.
 *
 * `lit` outlines the petal of the step under attention.
 */
import { memo, useId } from 'react';

import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

/** Hues away from red and green, so identity never reads as a verdict. */
const HUES = [190, 205, 220, 245, 265, 285, 300, 320, 175, 35];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function projectHue(id: string): number {
  return HUES[hash(id) % HUES.length]!;
}

const PETAL: Record<LifecycleHealth, { fill: string; stroke?: string; dash?: string; glow?: boolean }> = {
  red: { fill: 'var(--status-error)', glow: true },
  amber: { fill: 'var(--status-warning)' },
  stale: { fill: 'none', stroke: 'var(--status-info)', dash: '1 2' },
  green: { fill: 'var(--status-success)' },
  unmeasured: { fill: 'none', stroke: 'var(--muted-foreground)', dash: '2.6 2.2' },
  instructed: { fill: 'color-mix(in srgb, var(--foreground) 20%, transparent)' },
};

export interface SigilStep { id: string; phase: 'before' | 'after'; health: LifecycleHealth }

export const ProjectSigil = memo(function ProjectSigil({ id, name, sub, steps, size, lit, label, monogram }: {
  id: string;
  name: string;
  /** A short tag under the monogram (a repo owner, an id fragment) when two projects share a name. */
  sub?: string | null;
  steps: SigilStep[];
  size: number;
  lit?: string | null;
  label: string;
  /** Replaces the name's initial in the disc (the portfolio draws its project count). */
  monogram?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const hue = projectHue(id);
  const gap = 15;
  const span = steps.length ? Math.min(33, (360 - gap * 2) / steps.length) : 33;
  const before = steps.filter((s) => s.phase === 'before').length;
  // The before lane is centred on the top.
  let a = -90 - (before * span + gap) / 2 + span / 2;
  const petals = steps.map((s, i) => {
    if (i === before && i > 0) a += gap;
    const angle = a;
    a += span;
    const long = s.health !== 'instructed';
    const r0 = long ? 28 : 31;
    const r1 = long ? 45 : 40;
    const look = PETAL[s.health];
    const isLit = lit === s.id;
    return (
      <rect
        key={s.id}
        x={r0} y={-4.2} width={r1 - r0} height={8.4} rx={4.2}
        transform={`rotate(${angle})`}
        fill={look.fill}
        filter={look.glow ? `url(#${uid}g)` : undefined}
        stroke={isLit ? 'var(--foreground)' : look.stroke}
        strokeWidth={isLit ? 1.8 : look.stroke ? 1.6 : undefined}
        strokeDasharray={isLit ? undefined : look.dash}
      />
    );
  });
  const letter = monogram ?? (name.replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '?').toUpperCase();
  const showSub = !!sub && size >= 64;
  return (
    <svg className="lens-sigil" width={size} height={size} viewBox="-50 -50 100 100" role="img" aria-label={label}>
      <defs>
        <radialGradient id={`${uid}d`} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor={`hsl(${hue} 70% 46%)`} />
          <stop offset="1" stopColor={`hsl(${hue} 65% 16%)`} />
        </radialGradient>
        <filter id={`${uid}g`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle r={48} fill="none" stroke="color-mix(in srgb, var(--foreground) 9%, transparent)" />
      {petals}
      <circle r={23} fill={`url(#${uid}d)`} />
      <circle r={23} fill="none" stroke={`hsl(${hue} 80% 70% / .45)`} />
      <text
        y={showSub ? 3 : 9} textAnchor="middle" fontFamily="var(--font-sans)" fontWeight={700}
        fontSize={showSub ? 21 : 25} fill="white"
      >
        {letter}
      </text>
      {showSub && (
        <text y={15} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={9} fill={`hsl(${hue} 90% 88%)`}>{sub}</text>
      )}
    </svg>
  );
});

/** The steps of a project as sigil petals. */
export function sigilSteps(steps: { node: { id: string; phase: 'before' | 'after' }; health: LifecycleHealth }[]): SigilStep[] {
  return steps.map((s) => ({ id: s.node.id, phase: s.node.phase, health: s.health }));
}
