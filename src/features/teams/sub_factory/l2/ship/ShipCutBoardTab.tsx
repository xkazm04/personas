// Ship variant 2 — CUT BOARD. The triage metaphor: defining v1 is the act of
// deciding what's OUT. Three buckets — Core / Later / Never — with the scope
// cut as the primary interaction (fully working locally in this prototype).
// New post-cut proposals land in an UNCUT INBOX strip that demands a decision,
// so the divergent scan output turns into triage instead of silent growth.
// Exit criteria compress into a quiet chip strip: on this surface the scope is
// the hero, certification is context.
import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Archive, Ban, Inbox, Star } from 'lucide-react';

import { INK } from '../../passport/passportInk';
import {
  BUCKET_META, CRIT_HUE, FEATURE_STATE_META, MOCK_MILESTONE,
  type ScopeBucket, type ShipFeature,
} from './shipModel';

const BUCKET_ICON: Record<ScopeBucket, typeof Star> = { core: Star, later: Archive, never: Ban };

function TriageButtons({ onPick, current }: { onPick: (b: ScopeBucket) => void; current?: ScopeBucket | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      {(['core', 'later', 'never'] as const).map((b) => {
        const Icon = BUCKET_ICON[b];
        const on = current === b;
        return (
          <button
            key={b}
            type="button"
            onClick={() => onPick(b)}
            title={BUCKET_META[b].label}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive text-[10px] uppercase tracking-[0.08em] border transition-colors focus-ring ${
              on ? 'text-foreground font-semibold' : 'text-foreground/50 hover:text-foreground/85'
            }`}
            style={{ borderColor: on ? BUCKET_META[b].hue : 'rgba(148,163,184,.2)' }}
          >
            <Icon className="w-2.5 h-2.5" aria-hidden />
            {BUCKET_META[b].label}
          </button>
        );
      })}
    </span>
  );
}

function CoreCard({ f }: { f: ShipFeature }) {
  const meta = FEATURE_STATE_META[f.state];
  const blocked = Boolean(f.blocker);
  return (
    <li
      className="rounded-card px-2.5 py-1.5 min-w-0"
      style={{
        background: 'rgba(148,163,184,.045)',
        border: `1px solid ${blocked ? `${INK.amber}44` : 'rgba(148,163,184,.12)'}`,
      }}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: meta.hue, boxShadow: f.state === 'done' ? undefined : `0 0 5px ${meta.hue}77` }} />
        <span className="typo-caption font-medium text-foreground/90 truncate">{f.name}</span>
        <span className="ml-auto text-[10px] uppercase tracking-[0.1em] shrink-0" style={{ color: meta.hue }}>{meta.label}</span>
      </span>
      <span className="flex items-center gap-1.5 mt-1 min-w-0">
        {f.contexts.map((c) => (
          <span key={c} className="text-[10px] px-1.5 py-px rounded-full border border-foreground/10 text-foreground/50 truncate">{c}</span>
        ))}
      </span>
      {blocked && <p className="text-[10.5px] mt-1 truncate" style={{ color: INK.amber }}>{f.blocker}</p>}
    </li>
  );
}

export function ShipCutBoardTab() {
  const reduce = useReducedMotion();
  const m = MOCK_MILESTONE;
  // Local triage state — the prototype's working interaction. Keyed overrides
  // on top of the mock so moves are instant and reversible.
  const [moves, setMoves] = useState<Record<string, ScopeBucket>>({});
  const [triaged, setTriaged] = useState<Record<string, ScopeBucket>>({});

  const bucketOf = (f: ShipFeature): ScopeBucket => moves[f.id] ?? f.bucket;
  const inbox = m.features.filter((f) => f.sinceCut && !triaged[f.id]);

  const buckets = useMemo(() => {
    const all = m.features.filter((f) => !f.sinceCut || triaged[f.id]);
    const of = (b: ScopeBucket) => all.filter((f) => (triaged[f.id] ?? moves[f.id] ?? f.bucket) === b);
    return { core: of('core'), later: of('later'), never: of('never') };
  }, [m.features, moves, triaged]);

  const coreDone = buckets.core.filter((f) => f.state === 'done').length;

  return (
    <div data-testid="factory-ship-cutboard">
      {/* criteria compress into a quiet chip strip — context, not hero */}
      <div className="flex items-center gap-2 flex-wrap mb-2.5">
        <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">{m.name} · exit</span>
        {m.criteria.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10.5px] tabular-nums"
            style={{ borderColor: `${CRIT_HUE[c.state]}55`, color: CRIT_HUE[c.state] }}
            title={c.evidence}
          >
            {c.label} {c.done}/{c.total}
          </span>
        ))}
      </div>

      {/* the uncut inbox — scan output demanding a decision */}
      {inbox.length > 0 && (
        <div className="rounded-card px-3 py-2 mb-3" style={{ border: `1px dashed ${INK.violet}66`, background: `${INK.violet}0a` }} data-testid="ship-uncut-inbox">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: INK.violet }}>
            <Inbox className="w-3 h-3" aria-hidden />
            Uncut — proposed since the cut ({inbox.length})
          </p>
          <ul>
            {inbox.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5 py-1 min-w-0">
                <span className="typo-caption text-foreground/90 truncate">{f.name}</span>
                <span className="typo-caption text-foreground/45 truncate">{f.contexts.join(' · ')}</span>
                <span className="ml-auto shrink-0">
                  <TriageButtons onPick={(b) => setTriaged((p) => ({ ...p, [f.id]: b }))} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* the three-bucket board */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,.8fr)' }}>
        {(['core', 'later', 'never'] as const).map((b, col) => {
          const meta = BUCKET_META[b];
          const items = buckets[b];
          const Icon = BUCKET_ICON[b];
          return (
            <motion.div
              key={b}
              className="rounded-modal p-2.5 min-w-0"
              style={{ border: `1px solid ${b === 'core' ? `${INK.teal}2e` : 'rgba(148,163,184,.1)'}`, background: 'rgba(148,163,184,.025)' }}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: col * 0.08, duration: 0.3 }}
            >
              <div className="flex items-center gap-1.5 mb-2 min-w-0">
                <Icon className="w-3 h-3 shrink-0" style={{ color: meta.hue }} aria-hidden />
                <h3 className="typo-caption font-semibold text-foreground/85 truncate">{meta.label}</h3>
                <span className="ml-auto text-[10px] tabular-nums text-foreground/40 shrink-0">
                  {b === 'core' ? `${coreDone}/${items.length} done` : items.length}
                </span>
              </div>
              {b === 'core' ? (
                <ul className="grid gap-1.5">
                  {items.map((f) => <CoreCard key={f.id} f={f} />)}
                </ul>
              ) : (
                <ul>
                  {items.map((f) => (
                    <li key={f.id} className={`group flex items-center gap-2 py-1 border-b border-foreground/[0.04] last:border-0 min-w-0 ${b === 'never' ? 'opacity-50' : 'opacity-75'}`}>
                      <span className="typo-caption text-foreground/80 truncate">{f.name}</span>
                      <span className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <TriageButtons current={bucketOf(f)} onPick={(nb) => setMoves((p) => ({ ...p, [f.id]: nb }))} />
                      </span>
                    </li>
                  ))}
                  {items.length === 0 && <li className="typo-caption text-foreground/35 py-1">Nothing here.</li>}
                </ul>
              )}
            </motion.div>
          );
        })}
      </div>

      <p className="typo-caption text-foreground/35 mt-2">
        The cut is the decision — hover a Later/Never row to re-bucket, and everything lands reversibly. Core is deliberately the narrowest column set: {buckets.core.length} features carry the whole of “{m.goal}”
      </p>
    </div>
  );
}
