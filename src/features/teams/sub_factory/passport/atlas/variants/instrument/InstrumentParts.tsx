// Passport Atlas, Instrument figure - its drawn parts, named so they can be
// lifted out on their own: a project's tile, a score dial, and a rung meter
// for one dimension. Each moves once (on mount or on a changed value), never
// on a loop, and holds still under reduced motion.
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { AtlasInk } from '../../atlasModel';
import { INK_MARK } from '../../atlasWords';
import { monogram } from './instrumentModel';

/** The `--tone` a state paints with: its kit tone's status token. */
export const inkTone = (ink: AtlasInk): CSSProperties => ({ '--tone': `var(--status-${INK_MARK[ink].tone})` } as CSSProperties);

/** The project's face: its repo favicon when one was probed, else a monogram,
 *  tinted by its worst state, with the gap count as a corner tab. */
export function ProjectTile({ title, ink, gaps, favicon }: { title: string; ink: AtlasInk; gaps: number | '?'; favicon?: string }) {
  return (
    <span className="atlas-tile typo-label" data-ink={ink} style={inkTone(ink)} role="img" aria-label={INK_MARK[ink].label}>
      {favicon ? <img src={favicon} alt="" /> : <span aria-hidden="true">{monogram(title)}</span>}
      {gaps !== 0 && <span className="atlas-tile__gaps typo-caption k-strong" aria-hidden="true">{gaps}</span>}
    </span>
  );
}

const R = 16;
const C = 2 * Math.PI * R;

/** A 0-100 score as a dial that sweeps to its value once, on mount and on change. */
export function ScoreDial({ score, label, unknown, delay }: { score: number; label: string; unknown: boolean; delay: number }) {
  const reduce = useReducedMotion();
  const frac = unknown ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <span role="gridcell" className="atlas-dial" aria-label={`${label} ${unknown ? '?' : score}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r={R} fill="none" stroke="var(--rule)" strokeWidth="3.5" strokeDasharray={unknown ? '2 3' : undefined} />
        <motion.circle
          cx="20" cy="20" r={R} fill="none" stroke="var(--primary)" strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={C}
          initial={reduce ? false : { strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - frac) }}
          transition={{ duration: 0.7, delay, ease: [0.2, 0.7, 0.2, 1] }}
        />
      </svg>
      <span className="atlas-dial__num typo-caption k-strong tabular-nums">{unknown ? '?' : score}</span>
    </span>
  );
}

/** How far one dimension climbed: one segment per rung, the reached ones filled
 *  in the state's tone, left to right. A value with no ladder prints its count. */
export function RungMeter({ ink, meter, count }: { ink: AtlasInk; meter: { reached: number; steps: number } | null; count: string }) {
  if (!meter) return <span className="atlas-count typo-data">{count}</span>;
  const steps = Math.max(1, meter.steps);
  return (
    <span className="atlas-meter" data-ink={ink} aria-hidden="true">
      {Array.from({ length: steps }, (_, i) => (
        <span
          key={i}
          className={`atlas-meter__seg${i < meter.reached && ink !== 'unknown' ? ' is-on' : ''}`}
          style={{ '--sd': `${i * 0.06}s` } as CSSProperties}
        />
      ))}
    </span>
  );
}
