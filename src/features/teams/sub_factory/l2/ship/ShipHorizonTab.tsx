// Ship variant (round 3) — HORIZON. The editorial mission-brief: optimized
// for READING the plan. The roadmap is a band of proper milestone cards
// joined by fill segments (not dots on a hairline); the selected milestone
// unfolds below as a brief — goal headline, exit criteria as evidence tiles,
// and the scope as full-width grouped sections. Typography leads: typo-title /
// typo-body everywhere, nothing truncates, controls are quiet but always
// visible. Answers "can I get the overview easily?"
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Inbox, Rocket, Telescope } from 'lucide-react';

import { INK } from '../../passport/passportInk';
import {
  BUCKET_META, CRIT_HUE, FEATURE_STATE_META, MOCK_MILESTONE, SHIP_ROADMAP, shipProgress,
  type ScopeBucket, type ShipFeature, type ShipMilestone,
} from './shipModel';
import { useScopeTriage } from './shipTriage';

const STATE_WORD: Record<string, string> = { go: 'clear', warn: 'partial', nogo: 'blocking', setup: 'unwired' };

function BucketPicker({ current, onPick, exclude }: {
  current?: ScopeBucket | null; onPick: (b: ScopeBucket) => void; exclude?: ScopeBucket;
}) {
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {(['core', 'later', 'never'] as const).filter((b) => b !== exclude).map((b) => {
        const on = current === b;
        return (
          <button
            key={b}
            type="button"
            onClick={() => onPick(b)}
            className={`px-2 py-0.5 rounded-interactive text-xs uppercase tracking-[0.08em] border transition-colors focus-ring ${
              on ? 'text-foreground font-semibold' : 'text-foreground/45 hover:text-foreground/80'
            }`}
            style={{ borderColor: on ? BUCKET_META[b].hue : 'rgba(148,163,184,.18)' }}
          >
            {BUCKET_META[b].label}
          </button>
        );
      })}
    </span>
  );
}

function MilestoneCard({ m, selected, onSelect, index, reduce }: {
  m: ShipMilestone; selected: boolean; onSelect: () => void; index: number; reduce: boolean | null;
}) {
  const pct = shipProgress(m);
  const hue = m.status === 'shipped' ? INK.emerald : m.status === 'active' ? INK.teal : 'rgba(148,163,184,.6)';
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      className="flex-1 min-w-0 text-left rounded-card px-3.5 py-3 transition-shadow focus-ring"
      style={{
        border: `1px solid ${selected ? `${hue}88` : `${hue}30`}`,
        background: selected ? `color-mix(in srgb, ${hue} 6%, transparent)` : 'rgba(148,163,184,.03)',
        boxShadow: selected ? `0 4px 24px -8px ${hue}55` : undefined,
      }}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.09, duration: 0.35 }}
      aria-pressed={selected}
      data-testid={`ship-horizon-card-${m.id}`}
    >
      <span className="flex items-center gap-2">
        <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
          style={m.status === 'shipped' ? { background: hue } : { border: `1.5px ${m.status === 'planned' ? 'dashed' : 'solid'} ${hue}` }}>
          {m.status === 'shipped'
            ? <Check className="w-3 h-3 text-background" strokeWidth={3.5} aria-hidden />
            : m.status === 'active'
              ? <Rocket className="w-3 h-3" style={{ color: hue }} aria-hidden />
              : <Telescope className="w-3 h-3" style={{ color: hue }} aria-hidden />}
        </span>
        <span className="typo-title truncate">{m.name}</span>
        <span className="ml-auto typo-data shrink-0" style={{ color: hue }}>{m.status === 'planned' ? '—' : `${pct}%`}</span>
      </span>
      <span className="block mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(148,163,184,.12)' }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: hue, boxShadow: `0 0 6px ${hue}66` }} />
      </span>
      <span className="typo-caption block mt-1.5">{m.targetLabel}</span>
    </motion.button>
  );
}

function CriteriaTiles({ m }: { m: ShipMilestone }) {
  return (
    <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
      {m.criteria.map((c) => {
        const hue = CRIT_HUE[c.state];
        return (
          <div key={c.id} className="rounded-card px-3 py-2.5 min-w-0" style={{ borderLeft: `2px solid ${hue}`, background: 'rgba(148,163,184,.04)' }}>
            <span className="flex items-baseline gap-2">
              <span className="typo-title min-w-0">{c.label}</span>
              <span className="ml-auto typo-data shrink-0" style={{ color: hue }}>{c.done}/{c.total} · {STATE_WORD[c.state]}</span>
            </span>
            <p className="typo-caption mt-1">{c.evidence}</p>
          </div>
        );
      })}
    </div>
  );
}

function ScopeSection({ bucket, features, triage, defaultOpen }: {
  bucket: ScopeBucket; features: ShipFeature[]; triage: ReturnType<typeof useScopeTriage>; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const meta = BUCKET_META[bucket];
  return (
    <div className="rounded-card border border-foreground/[0.07] overflow-hidden" style={{ background: 'rgba(148,163,184,.02)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3.5 py-2.5 focus-ring" aria-expanded={open}>
        <span className="typo-title" style={bucket !== 'core' ? { color: 'var(--foreground)', opacity: 0.75 } : undefined}>{meta.label}</span>
        <span className="typo-data text-foreground/40">{features.length}</span>
        {bucket === 'core' && (
          <span className="typo-caption">— {features.filter((f) => f.state === 'done').length} done, the cut that ships the milestone</span>
        )}
        <ChevronDown className={`w-4 h-4 ml-auto text-foreground/40 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <ul className="border-t border-foreground/[0.06]">
          {features.map((f) => {
            const st = FEATURE_STATE_META[f.state];
            return (
              <li key={f.id} className="flex items-start gap-3 px-3.5 py-2.5 border-b border-foreground/[0.05] last:border-0 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0 mt-2" style={{ background: st.hue, boxShadow: f.state === 'done' ? undefined : `0 0 5px ${st.hue}77` }} />
                <span className="min-w-0 flex-1">
                  <span className={`typo-body font-medium block ${bucket === 'never' ? 'text-foreground/50 line-through decoration-foreground/25' : 'text-foreground/95'}`}>{f.name}</span>
                  <span className="typo-caption block">{f.contexts.join(' · ')}{f.blocker ? ' — ' : ''}{f.blocker && <span style={{ color: INK.amber }}>{f.blocker}</span>}</span>
                </span>
                <span className="typo-caption shrink-0 mt-0.5 w-20 text-right" style={{ color: st.hue }}>{bucket === 'core' ? st.label : ''}</span>
                <span className="mt-0.5"><BucketPicker current={triage.bucketOf(f)} onPick={(b) => triage.move(f.id, b)} exclude={bucket} /></span>
              </li>
            );
          })}
          {features.length === 0 && <li className="typo-caption px-3.5 py-2.5">Nothing here.</li>}
        </ul>
      )}
    </div>
  );
}

export function ShipHorizonTab() {
  const reduce = useReducedMotion();
  const [selectedId, setSelectedId] = useState(() => SHIP_ROADMAP.find((m) => m.status === 'active')?.id ?? '');
  const m = SHIP_ROADMAP.find((x) => x.id === selectedId) ?? MOCK_MILESTONE;
  const triage = useScopeTriage(m);

  return (
    <div data-testid="factory-ship-horizon">
      {/* the roadmap band — cards joined by fill segments */}
      <div className="flex items-stretch gap-2.5 mb-5">
        {SHIP_ROADMAP.map((ms, i) => (
          <MilestoneCard key={ms.id} m={ms} selected={ms.id === m.id} onSelect={() => setSelectedId(ms.id)} index={i} reduce={reduce} />
        ))}
      </div>

      {/* the brief for the selected milestone */}
      <motion.div key={m.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <p className="typo-title-lg mb-3">{m.goal}</p>
        <CriteriaTiles m={m} />

        {triage.inbox.length > 0 && (
          <div className="rounded-card px-3.5 py-2.5 mb-2.5" style={{ border: `1px dashed ${INK.violet}66`, background: `${INK.violet}0a` }}>
            <p className="flex items-center gap-1.5 typo-caption mb-1" style={{ color: INK.violet }}>
              <Inbox className="w-3.5 h-3.5" aria-hidden />
              Proposed since the cut — decide before it becomes silent scope
            </p>
            <ul>
              {triage.inbox.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-1.5 min-w-0">
                  <span className="typo-body font-medium text-foreground/95 min-w-0">{f.name}</span>
                  <span className="typo-caption shrink-0">{f.contexts.join(' · ')}</span>
                  <span className="ml-auto"><BucketPicker onPick={(b) => triage.triageNew(f.id, b)} /></span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-2.5">
          <ScopeSection bucket="core" features={triage.buckets.core} triage={triage} defaultOpen />
          <ScopeSection bucket="later" features={triage.buckets.later} triage={triage} />
          <ScopeSection bucket="never" features={triage.buckets.never} triage={triage} />
        </div>
      </motion.div>
    </div>
  );
}
