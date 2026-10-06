/**
 * The ledger rail — P2's constant spine. Every card type, whatever its body,
 * carries the same right-hand rail in the same order (BacklogDetailLedger's
 * margin rail, generalised): who raised it, how long it has waited and what
 * it costs (its tier rides in the card head), its tags, its facts (scores metered), then a type-specific
 * section (contents for a report, participants for a chat), and at the foot
 * the DOCK — every action the card supports, with its key.
 */
import type { ReactNode } from 'react';
import { Chip } from '@/features/shared/triage/triageFocusBridge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DecisionItem } from '../../../model/decisionModel';
import { costOf } from './deckMeta';
import { ScoreMeter } from './ScoreMeter';

/** The three numbers every card answers first: how long, how urgent, how much work. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-input bg-background/50 px-2 py-1.5">
      <span className="typo-label">{label}</span>
      <span className="truncate typo-body text-foreground">{children}</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="typo-label">{label}</span>
      <span className="min-w-0 truncate text-right typo-body text-foreground">{children}</span>
    </div>
  );
}

function SourceBadge({ item }: { item: DecisionItem }) {
  // By codepoint, not code unit: an emoji-initial name must not split a surrogate pair.
  const initial = ([...item.source.label][0] ?? '?').toUpperCase();
  return (
    <div className="flex items-center gap-2.5 pb-2">
      <span
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-card border-2 bg-secondary/60 typo-heading text-foreground"
        style={{ borderColor: item.source.color ?? 'var(--primary)' }}
        aria-hidden
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="typo-body truncate text-foreground">{item.source.label}</span>
        {item.source.sublabel && <span className="typo-caption truncate">{item.source.sublabel}</span>}
      </span>
    </div>
  );
}

export function LedgerRail({ item, extra, dock }: { item: DecisionItem; extra?: ReactNode; dock: ReactNode }) {
  const meters = item.facts.filter((f): f is typeof f & { score: NonNullable<typeof f.score> } => !!f.score);
  // A fact that restates the spine (the waiting time, the source's own name) is noise in the ledger.
  const plainFacts = item.facts.filter((f) => !f.score && f.id !== 'waiting' && f.value !== item.source.label);
  return (
    <aside className="flex w-[320px] flex-shrink-0 flex-col border-l border-primary/10 bg-secondary/20" aria-label="Ledger" data-testid="p2-ledger-rail">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        <SourceBadge item={item} />
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Waiting"><RelativeTime timestamp={item.createdAt} className="typo-body text-foreground" /></Stat>
          <Stat label="Cost">{costOf(item)}</Stat>
        </div>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {item.tags.map((t) => <Chip key={t.id} label={t.label} tone={t.tone} />)}
          </div>
        )}
        {extra}
        {meters.length > 0 && (
          <div className="flex flex-col pt-2">
            {meters.map((f) => <ScoreMeter key={f.id} fact={f} />)}
          </div>
        )}
        {plainFacts.length > 0 && (
          <div className="mt-2 divide-y divide-primary/10">
            {plainFacts.map((f) => <Row key={f.id} label={f.label}>{f.value}</Row>)}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-primary/10 bg-background/40 px-4 py-3" data-testid="p2-dock">
        {dock}
      </div>
    </aside>
  );
}
