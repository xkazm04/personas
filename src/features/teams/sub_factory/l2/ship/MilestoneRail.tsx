// The roadmap rail — the element fused OUT of the Runway variant (round 2):
// milestones as navigation. One horizontal flightpath, one node per milestone
// (shipped = filled, active = ringed + derived %, planned = dashed); the craft
// flies the segment INTO the active milestone at its derived progress, and
// clicking a node scopes the board below to that milestone's record or pool.
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Rocket } from 'lucide-react';

import { INK } from '../../passport/passportInk';
import { shipProgress, type ShipMilestone } from './shipModel';

const STATUS_HUE: Record<ShipMilestone['status'], string> = {
  shipped: INK.emerald,
  active: INK.teal,
  planned: 'rgba(148,163,184,.55)',
};

export function MilestoneRail({ roadmap, selectedId, onSelect }: {
  roadmap: ShipMilestone[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const n = roadmap.length;
  const x = (i: number) => (n === 1 ? 50 : 8 + (i * 84) / (n - 1));

  const activeIdx = Math.max(0, roadmap.findIndex((m) => m.status === 'active'));
  const active = roadmap[activeIdx];
  const progress = active ? shipProgress(active) : 0;
  // The craft flies the segment INTO the active node: previous node → active.
  const fromX = activeIdx === 0 ? 2 : x(activeIdx - 1);
  const craftX = fromX + ((x(activeIdx) - fromX) * progress) / 100;

  return (
    <div className="relative h-[92px]" data-testid="ship-milestone-rail">
      <svg className="absolute inset-x-0 top-[26px] w-full h-2" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden>
        <line x1="2" y1="2" x2="98" y2="2" stroke="rgba(148,163,184,.16)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeDasharray="0.7 1" />
        <motion.line
          x1="2" y1="2" x2="98" y2="2"
          stroke={INK.teal} strokeWidth="1.8" vectorEffect="non-scaling-stroke"
          initial={reduce ? { pathLength: craftX / 100 } : { pathLength: 0 }}
          animate={{ pathLength: craftX / 100 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 3px ${INK.teal}55)` }}
        />
      </svg>

      {roadmap.map((m, i) => {
        const hue = STATUS_HUE[m.status];
        const on = m.id === selectedId;
        const pct = m.status === 'active' ? `${shipProgress(m)}%` : null;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            className="absolute top-0 flex flex-col items-center w-40 -translate-x-1/2 focus-ring rounded-interactive"
            style={{ left: `${x(i)}%` }}
            aria-pressed={on}
            data-testid={`ship-rail-node-${m.id}`}
          >
            <span
              className="w-3.5 h-3.5 rounded-full mt-[22px] flex items-center justify-center"
              style={
                m.status === 'shipped'
                  ? { background: hue, boxShadow: `0 0 6px ${hue}77` }
                  : {
                      border: `2px ${m.status === 'planned' ? 'dashed' : 'solid'} ${hue}`,
                      background: 'var(--background)',
                      boxShadow: on ? `0 0 8px ${hue}66` : undefined,
                    }
              }
            >
              {m.status === 'shipped' && <Check className="w-2 h-2 text-background" strokeWidth={4} aria-hidden />}
            </span>
            <span className={`typo-caption mt-1.5 text-center leading-tight transition-colors ${on ? 'text-foreground font-semibold' : 'text-foreground/60 font-medium'}`}>
              {m.name}
            </span>
            <span className="text-[10px] tabular-nums mt-0.5" style={{ color: hue }}>
              {pct ? `${pct} · ${m.targetLabel ?? ''}` : m.targetLabel}
            </span>
            {on && <span className="mt-1 h-[2px] w-8 rounded-full" style={{ background: hue }} />}
          </button>
        );
      })}

      <motion.div
        className="absolute top-[16px] -translate-x-1/2 pointer-events-none"
        initial={reduce ? false : { left: `${fromX}%`, opacity: 0 }}
        animate={{ left: `${craftX}%`, opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        <Rocket className="w-3.5 h-3.5 rotate-45" style={{ color: INK.teal, filter: `drop-shadow(0 0 4px ${INK.teal}88)` }} aria-hidden />
      </motion.div>
    </div>
  );
}
