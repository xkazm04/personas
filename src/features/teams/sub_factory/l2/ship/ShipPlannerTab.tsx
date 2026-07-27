// Ship variant (round 3) — PLANNER. The split-pane scope manager: optimized
// for WORKING the plan. Left: the roadmap as a vertical timeline of generous
// milestone cards (the navigation spine, always in view). Right: the selected
// milestone's workspace — "In the cut" as spacious feature cards, and
// everything outside the cut as ONE readable ledger table (full names, no
// columns fighting for width) whose bucket cell is the triage control.
// Answers "can I manage the scope easily?"
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, Check, Rocket, Sparkles, Telescope } from 'lucide-react';

import { INK } from '../../passport/passportInk';
import {
  BUCKET_META, CRIT_HUE, FEATURE_STATE_META, MOCK_MILESTONE, SHIP_ROADMAP, shipProgress,
  type ShipMilestone,
} from './shipModel';
import { useScopeTriage } from './shipTriage';

const STATUS_META: Record<ShipMilestone['status'], { hue: string; icon: typeof Check }> = {
  shipped: { hue: INK.emerald, icon: Check },
  active: { hue: INK.teal, icon: Rocket },
  planned: { hue: 'rgba(148,163,184,.6)', icon: Telescope },
};

function TimelineCard({ m, selected, onSelect, index, reduce }: {
  m: ShipMilestone; selected: boolean; onSelect: () => void; index: number; reduce: boolean | null;
}) {
  const { hue, icon: Icon } = STATUS_META[m.status];
  const pct = shipProgress(m);
  return (
    <motion.li
      className="relative pl-7"
      initial={reduce ? false : { opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.09, duration: 0.3 }}
    >
      {/* node on the spine */}
      <span className="absolute left-[5px] top-4 w-3 h-3 rounded-full flex items-center justify-center"
        style={m.status === 'shipped' ? { background: hue } : { border: `1.5px ${m.status === 'planned' ? 'dashed' : 'solid'} ${hue}`, background: 'var(--background)' }} />
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left rounded-card px-3 py-2.5 mb-2.5 transition-shadow focus-ring"
        style={{
          border: `1px solid ${selected ? `${hue}88` : 'rgba(148,163,184,.14)'}`,
          background: selected ? `color-mix(in srgb, ${hue} 6%, transparent)` : 'rgba(148,163,184,.03)',
          boxShadow: selected ? `0 4px 20px -8px ${hue}55` : undefined,
        }}
        aria-pressed={selected}
        data-testid={`ship-planner-node-${m.id}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: hue }} aria-hidden />
          <span className="typo-title truncate">{m.name}</span>
        </span>
        <span className="flex items-center gap-2 mt-1.5">
          <span className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(148,163,184,.12)' }}>
            <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: hue }} />
          </span>
          <span className="typo-data shrink-0" style={{ color: hue }}>{m.status === 'planned' ? '—' : `${pct}%`}</span>
        </span>
        <span className="typo-caption block mt-1">{m.targetLabel}</span>
      </button>
    </motion.li>
  );
}

export function ShipPlannerTab() {
  const reduce = useReducedMotion();
  const [selectedId, setSelectedId] = useState(() => SHIP_ROADMAP.find((m) => m.status === 'active')?.id ?? '');
  const m = SHIP_ROADMAP.find((x) => x.id === selectedId) ?? MOCK_MILESTONE;
  const triage = useScopeTriage(m);
  const outside = [
    ...triage.inbox.map((f) => ({ f, fresh: true })),
    ...triage.buckets.later.map((f) => ({ f, fresh: false })),
    ...triage.buckets.never.map((f) => ({ f, fresh: false })),
  ];
  const coreDone = triage.buckets.core.filter((f) => f.state === 'done').length;

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(230px, 270px) minmax(0, 1fr)' }} data-testid="factory-ship-planner">
      {/* the roadmap spine */}
      <div className="relative">
        <span className="absolute left-[10px] top-5 bottom-5 w-px" style={{ background: `linear-gradient(${INK.emerald}66, ${INK.teal}66, rgba(148,163,184,.2))` }} aria-hidden />
        <ul>
          {SHIP_ROADMAP.map((ms, i) => (
            <TimelineCard key={ms.id} m={ms} selected={ms.id === m.id} onSelect={() => setSelectedId(ms.id)} index={i} reduce={reduce} />
          ))}
        </ul>
      </div>

      {/* the workspace */}
      <motion.div key={m.id} className="min-w-0" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <p className="typo-title-lg">{m.goal}</p>
        <div className="flex items-center gap-2 flex-wrap mt-2 mb-4">
          {m.criteria.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption tabular-nums" style={{ borderColor: `${CRIT_HUE[c.state]}55`, color: CRIT_HUE[c.state] }} title={c.evidence}>
              {c.label} {c.done}/{c.total}
            </span>
          ))}
        </div>

        {/* in the cut */}
        <div className="flex items-baseline gap-2 mb-2">
          <h3 className="typo-title">In the cut</h3>
          <span className="typo-data text-foreground/40">{coreDone}/{triage.buckets.core.length} done</span>
          <span className="typo-caption">— what “{m.name}” means, nothing more</span>
        </div>
        <ul className="grid gap-2 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }}>
          {triage.buckets.core.map((f) => {
            const st = FEATURE_STATE_META[f.state];
            return (
              <li key={f.id} className="rounded-card px-3 py-2.5 min-w-0" style={{ background: 'rgba(148,163,184,.045)', border: `1px solid ${f.blocker ? `${INK.amber}44` : 'rgba(148,163,184,.12)'}` }}>
                <span className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0 mt-[7px]" style={{ background: st.hue, boxShadow: f.state === 'done' ? undefined : `0 0 5px ${st.hue}77` }} />
                  <span className="typo-body font-medium text-foreground/95 min-w-0">{f.name}</span>
                  <span className="ml-auto typo-caption shrink-0" style={{ color: st.hue }}>{st.label}</span>
                </span>
                <span className="typo-caption block mt-1 pl-4">{f.contexts.join(' · ')}</span>
                {f.blocker && <p className="typo-caption mt-1 pl-4" style={{ color: INK.amber }}>{f.blocker}</p>}
              </li>
            );
          })}
          {triage.buckets.core.length === 0 && (
            <li className="rounded-card border border-dashed px-3 py-4 typo-caption text-center" style={{ borderColor: `${INK.blue}55`, color: INK.blue }}>
              No cut yet — promote from the ledger below to define this milestone.
            </li>
          )}
        </ul>

        {/* outside the cut — the ledger */}
        <div className="flex items-baseline gap-2 mb-1.5">
          <h3 className="typo-title" style={{ color: 'var(--foreground)', opacity: 0.8 }}>Outside the cut</h3>
          <span className="typo-data text-foreground/40">{outside.length}</span>
          <span className="typo-caption">— the bucket cell is the decision</span>
        </div>
        <ul className="rounded-card border border-foreground/[0.07] overflow-hidden" style={{ background: 'rgba(148,163,184,.02)' }}>
          {outside.map(({ f, fresh }) => {
            const current = fresh ? null : triage.bucketOf(f);
            return (
              <li key={f.id} className="flex items-center gap-3 px-3.5 py-2 border-b border-foreground/[0.05] last:border-0 min-w-0">
                {fresh
                  ? <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: INK.violet }} aria-hidden />
                  : <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(148,163,184,.4)' }} />}
                <span className="min-w-0 flex-1">
                  <span className={`typo-body font-medium block ${current === 'never' ? 'text-foreground/50' : 'text-foreground/90'}`}>
                    {f.name}
                    {fresh && <span className="typo-caption ml-2" style={{ color: INK.violet }}>proposed since the cut</span>}
                  </span>
                  <span className="typo-caption block">{f.contexts.join(' · ')}</span>
                </span>
                <span className="inline-flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => (fresh ? triage.triageNew(f.id, 'core') : triage.move(f.id, 'core'))}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring"
                    style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
                    title="Promote into the cut"
                  >
                    <ArrowUp className="w-3 h-3" aria-hidden />
                    Cut
                  </button>
                  {(['later', 'never'] as const).map((b) => {
                    const on = current === b;
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => (fresh ? triage.triageNew(f.id, b) : triage.move(f.id, b))}
                        className={`px-2 py-1 rounded-interactive typo-caption border transition-colors focus-ring ${on ? 'text-foreground font-semibold' : 'text-foreground/45 hover:text-foreground/80'}`}
                        style={{ borderColor: on ? BUCKET_META[b].hue : 'rgba(148,163,184,.16)' }}
                      >
                        {BUCKET_META[b].label}
                      </button>
                    );
                  })}
                </span>
              </li>
            );
          })}
          {outside.length === 0 && <li className="typo-caption px-3.5 py-2.5">Everything is in the cut — suspiciously disciplined.</li>}
        </ul>
      </motion.div>
    </div>
  );
}
