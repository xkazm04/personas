// The Ship BASELINE (round-4 fusion): Planner's split-pane layout survives —
// vertical roadmap spine left, milestone workspace right — with both scope
// sections now the SAME list style ("In the cut" matches "Outside the cut"),
// each row carrying the Board variant's kept Core-card theme via LedgerRow.
// Horizon and the original Board were retired in this round.
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, Check, Rocket, Sparkles, Telescope } from 'lucide-react';

import { INK } from '../../passport/passportInk';
import {
  BUCKET_META, CRIT_HUE, FEATURE_STATE_META, MOCK_MILESTONE, SHIP_ROADMAP, shipProgress,
  type ScopeBucket, type ShipMilestone,
} from './shipModel';
import { LedgerHeader, LedgerList, LedgerRow } from './shipRows';
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

function BucketBtn({ b, on, onClick, hue }: { b: string; on?: boolean; onClick: () => void; hue?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded-interactive typo-caption border transition-colors focus-ring ${on ? 'text-foreground font-semibold' : 'text-foreground/45 hover:text-foreground/80'}`}
      style={{ borderColor: on && hue ? hue : 'rgba(148,163,184,.16)' }}
    >
      {b}
    </button>
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

  const moveBtns = (id: string, fresh: boolean, current: ScopeBucket | null) => (
    <>
      <button
        type="button"
        onClick={() => (fresh ? triage.triageNew(id, 'core') : triage.move(id, 'core'))}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-caption border transition-colors hover:bg-foreground/[0.05] focus-ring"
        style={{ color: INK.teal, borderColor: `${INK.teal}55` }}
        title="Promote into the cut"
      >
        <ArrowUp className="w-3 h-3" aria-hidden />
        Cut
      </button>
      {(['later', 'never'] as const).map((b) => (
        <BucketBtn key={b} b={BUCKET_META[b].label} on={current === b} hue={BUCKET_META[b].hue}
          onClick={() => (fresh ? triage.triageNew(id, b) : triage.move(id, b))} />
      ))}
    </>
  );

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

      {/* the workspace — one ledger language for both sections */}
      <motion.div key={m.id} className="min-w-0" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <p className="typo-title-lg">{m.goal}</p>
        <div className="flex items-center gap-2 flex-wrap mt-2 mb-4">
          {m.criteria.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption tabular-nums" style={{ borderColor: `${CRIT_HUE[c.state]}55`, color: CRIT_HUE[c.state] }} title={c.evidence}>
              {c.label} {c.done}/{c.total}
            </span>
          ))}
        </div>

        <LedgerHeader title="In the cut" count={`${coreDone}/${triage.buckets.core.length} done`} aside={`what “${m.name}” means, nothing more`} />
        <div className="mb-5">
          <LedgerList testid="ship-cut-list">
            {triage.buckets.core.map((f) => {
              const st = FEATURE_STATE_META[f.state];
              return (
                <LedgerRow
                  key={f.id}
                  name={f.name}
                  contexts={f.contexts}
                  stateLabel={st.label}
                  stateHue={st.hue}
                  blocker={f.blocker}
                  actions={m.status !== 'shipped' && (
                    <>
                      {(['later', 'never'] as const).map((b) => (
                        <BucketBtn key={b} b={BUCKET_META[b].label} onClick={() => triage.move(f.id, b)} />
                      ))}
                    </>
                  )}
                />
              );
            })}
            {triage.buckets.core.length === 0 && (
              <li className="rounded-card border border-dashed px-3 py-4 typo-caption text-center" style={{ borderColor: `${INK.blue}55`, color: INK.blue }}>
                No cut yet — promote from the ledger below to define this milestone.
              </li>
            )}
          </LedgerList>
        </div>

        <LedgerHeader title="Outside the cut" count={outside.length} aside="the row's buttons are the decision" muted />
        <LedgerList testid="ship-outside-list">
          {outside.map(({ f, fresh }) => {
            const current = fresh ? null : triage.bucketOf(f);
            return (
              <LedgerRow
                key={f.id}
                name={f.name}
                contexts={f.contexts}
                dim={current === 'never'}
                marker={fresh ? <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: INK.violet }} aria-hidden /> : undefined}
                meta={fresh ? <span className="typo-caption shrink-0" style={{ color: INK.violet }}>proposed since the cut</span> : undefined}
                actions={m.status !== 'shipped' && moveBtns(f.id, fresh, current)}
              />
            );
          })}
          {outside.length === 0 && <li className="typo-caption px-3.5 py-2.5">Everything is in the cut — suspiciously disciplined.</li>}
        </LedgerList>
      </motion.div>
    </div>
  );
}
