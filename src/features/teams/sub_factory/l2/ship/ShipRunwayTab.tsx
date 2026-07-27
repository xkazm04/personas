// Ship variant 1 — RUNWAY. The journey metaphor: shipping is a takeoff roll.
// One horizontal flightpath from the Cut to Ship; exit criteria are gates on
// the runway, the craft sits at the DERIVED progress position, and the only
// list below is "what stands between you and ship" — done work recedes to a
// single counter line. Convergence reads as forward motion toward a fixed end.
import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Flag, Rocket, Scissors, Sparkles } from 'lucide-react';

import { INK } from '../../passport/passportInk';
import {
  CRIT_HUE, FEATURE_STATE_META, MOCK_MILESTONE,
  coreFeatures, creepItems, shipProgress,
  type CritState, type ShipFeature,
} from './shipModel';

const CRIT_WORD: Record<CritState, string> = {
  go: 'clear', warn: 'partial', nogo: 'blocking', setup: 'unwired',
};

function Gate({ x, state, label, done, total, reduce, delay }: {
  x: number; state: CritState; label: string; done: number; total: number;
  reduce: boolean | null; delay: number;
}) {
  const hue = CRIT_HUE[state];
  const open = state === 'go';
  return (
    <motion.div
      className="absolute top-0 flex flex-col items-center w-32 -translate-x-1/2"
      style={{ left: `${x}%` }}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
    >
      <span
        className={`w-3 h-3 rounded-full mt-[23px] ${open ? '' : 'border-2'}`}
        style={open
          ? { background: hue, boxShadow: `0 0 6px ${hue}88` }
          : { borderColor: hue, borderStyle: state === 'setup' ? 'dashed' : 'solid', background: 'var(--background)' }}
      />
      <span className="typo-caption text-foreground/80 font-medium mt-1.5 text-center leading-tight">{label}</span>
      <span className="text-[10px] tabular-nums mt-0.5" style={{ color: hue }}>
        {done}/{total} · {CRIT_WORD[state]}
      </span>
    </motion.div>
  );
}

function RemainRow({ hue, icon, title, detail, tail }: {
  hue: string; icon?: React.ReactNode; title: string; detail: string | null; tail?: string;
}) {
  return (
    <li className="flex items-center gap-2.5 py-1.5 border-b border-foreground/[0.05] last:border-0 min-w-0">
      {icon ?? <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: `0 0 5px ${hue}66` }} />}
      <span className="typo-caption text-foreground/90 font-medium truncate">{title}</span>
      {detail && <span className="typo-caption text-foreground/50 truncate min-w-0">{detail}</span>}
      {tail && <span className="ml-auto text-[10px] uppercase tracking-[0.1em] shrink-0" style={{ color: hue }}>{tail}</span>}
    </li>
  );
}

export function ShipRunwayTab() {
  const reduce = useReducedMotion();
  const m = MOCK_MILESTONE;
  const progress = shipProgress(m);
  const creep = creepItems(m);
  const core = coreFeatures(m);
  const doneCount = core.filter((f) => f.state === 'done').length;

  // Everything still on the runway, worst-first: blocking criteria, then
  // in-flight core features. Done never appears here — it recedes.
  const remaining = useMemo(() => {
    const feats = core.filter((f) => f.state !== 'done');
    const order: Record<ShipFeature['state'], number> = { todo: 0, building: 1, verify: 2, done: 3 };
    return feats.sort((a, b) => order[a.state] - order[b.state]);
  }, [core]);
  const openCriteria = m.criteria.filter((c) => c.state !== 'go');

  // Gates spread over the middle of the strip; Cut and Ship anchor the ends.
  const gateX = (i: number) => 14 + (i * 72) / Math.max(1, m.criteria.length - 1);

  return (
    <div data-testid="factory-ship-runway">
      {/* header — the destination and the derived position */}
      <div className="flex items-end gap-4 flex-wrap mb-1">
        <div className="min-w-0">
          <h3 className="typo-caption font-semibold text-foreground/90">{m.name}</h3>
          <p className="typo-caption text-foreground/55 max-w-xl">{m.goal}</p>
        </div>
        <div className="ml-auto text-right shrink-0">
          <span className="text-2xl font-semibold tabular-nums" style={{ color: INK.teal }}>{progress}%</span>
          <p className="text-[10px] uppercase tracking-[0.12em] text-foreground/40">
            cut {m.cutAgeDays}d ago{m.targetLabel ? ` · target ${m.targetLabel}` : ''}
          </p>
        </div>
      </div>

      {/* the runway */}
      <div className="relative h-[104px] mb-3" data-testid="ship-runway-strip">
        <svg className="absolute inset-x-0 top-6 w-full h-4" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden>
          <line x1="2" y1="4" x2="98" y2="4" stroke="rgba(148,163,184,.18)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeDasharray="0.8 1.1" />
          <motion.line
            x1="2" y1="4" x2="98" y2="4"
            stroke={INK.teal} strokeWidth="2" vectorEffect="non-scaling-stroke"
            initial={reduce ? { pathLength: progress / 100 } : { pathLength: 0 }}
            animate={{ pathLength: progress / 100 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            style={{ filter: `drop-shadow(0 0 3px ${INK.teal}66)` }}
          />
        </svg>
        {/* endpoints */}
        <div className="absolute left-[2%] top-0 flex flex-col items-center -translate-x-1/2">
          <Scissors className="w-3.5 h-3.5 mt-[21px]" style={{ color: 'rgba(148,163,184,.7)' }} aria-hidden />
          <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 mt-1.5">Cut</span>
        </div>
        <div className="absolute left-[98%] top-0 flex flex-col items-center -translate-x-1/2">
          <Flag className="w-3.5 h-3.5 mt-[21px]" style={{ color: INK.emerald }} aria-hidden />
          <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/40 mt-1.5">Ship</span>
        </div>
        {/* gates */}
        {m.criteria.map((c, i) => (
          <Gate key={c.id} x={gateX(i)} state={c.state} label={c.label} done={c.done} total={c.total} reduce={reduce} delay={0.25 + i * 0.12} />
        ))}
        {/* the craft at derived progress */}
        <motion.div
          className="absolute top-[13px] -translate-x-1/2"
          initial={reduce ? false : { left: '2%', opacity: 0 }}
          animate={{ left: `${2 + (progress / 100) * 96}%`, opacity: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        >
          <Rocket className="w-4 h-4 rotate-45" style={{ color: INK.teal, filter: `drop-shadow(0 0 4px ${INK.teal}88)` }} aria-hidden />
        </motion.div>
      </div>

      {/* between you and ship — the convergent list */}
      <div className="rounded-card border border-foreground/[0.07] px-3.5 py-2" style={{ background: 'rgba(148,163,184,.03)' }}>
        <p className="text-[10px] uppercase tracking-[0.14em] text-foreground/40 mb-1">Between you and ship</p>
        <ul>
          {openCriteria.map((c) => (
            <RemainRow
              key={c.id}
              hue={CRIT_HUE[c.state]}
              title={c.label}
              detail={c.evidence}
              tail={c.dispatch ? `${c.dispatch} →` : CRIT_WORD[c.state]}
            />
          ))}
          {remaining.map((f) => {
            const meta = FEATURE_STATE_META[f.state];
            return (
              <RemainRow
                key={f.id}
                hue={meta.hue}
                icon={<ChevronRight className="w-3 h-3 shrink-0" style={{ color: meta.hue }} aria-hidden />}
                title={f.name}
                detail={f.blocker ?? f.contexts.join(' · ')}
                tail={meta.label}
              />
            );
          })}
        </ul>
        {/* done recedes to one counter line */}
        <p className="typo-caption text-foreground/35 mt-1.5">
          {doneCount} of {core.length} core features done — behind the craft, out of the list.
        </p>
      </div>

      {/* scope-creep ticker — the anti-infinite-development line */}
      {creep.length > 0 && (
        <p className="flex items-center gap-1.5 typo-caption mt-2" style={{ color: INK.violet }}>
          <Sparkles className="w-3 h-3 shrink-0" aria-hidden />
          +{creep.length} proposed since the cut ({creep.map((f) => f.name).join(' · ')}) — triage keeps the runway honest.
        </p>
      )}
    </div>
  );
}
