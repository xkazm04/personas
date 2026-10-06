/**
 * The ledger rail — P2's constant spine, sunk into a well (darker, inset
 * shadow) instead of a bordered column. Same order on every card: who raised
 * it (a monogram), how long it has waited and what it costs (two hero tiles:
 * icon + value, label in a tooltip), up to two tags as small caps with a tone
 * dot, the type section, scored facts as capsule meters, the remaining facts
 * as icon + value lines — and at the foot, the DOCK.
 */
import type { ReactNode } from 'react';
import { Clock, Gauge, type LucideIcon } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DecisionItem } from '../../../model/decisionModel';
import { cardTags, costOf } from './deckMeta';
import { FactLine } from './FactLine';
import { Monogram } from './parts';
import { ScoreMeter } from './ScoreMeter';

const TAG_DOT = { neutral: 'bg-muted-foreground', accent: 'bg-primary', success: 'bg-status-success', warning: 'bg-status-warning', danger: 'bg-status-error' } as const;

function HeroTile({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <div className="au-hero-tile flex min-w-0 items-center gap-2 rounded-input px-2.5 py-2" tabIndex={0} aria-label={label}>
        <Icon className="h-4 w-4 au-quiet flex-shrink-0" aria-hidden />
        <span className="min-w-0 typo-heading tabular-nums text-foreground">{children}</span>
      </div>
    </Tooltip>
  );
}

export function LedgerRail({ item, extra, dock }: { item: DecisionItem; extra?: ReactNode; dock: ReactNode }) {
  const meters = item.facts.filter((f): f is typeof f & { score: NonNullable<typeof f.score> } => !!f.score);
  // A fact that restates the spine (the waiting time, the source's own name) is noise in the ledger.
  const plainFacts = item.facts.filter((f) => !f.score && f.id !== 'waiting' && f.value !== item.source.label);
  const tags = cardTags(item);
  return (
    <aside className="au-well flex w-[340px] flex-shrink-0 flex-col overflow-hidden rounded-card" aria-label="Ledger" data-testid="p2-ledger-rail">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <Monogram item={item} />
          <span className="flex min-w-0 flex-col">
            <span className="typo-heading text-foreground [overflow-wrap:anywhere]">{item.source.label}</span>
            {item.source.sublabel && <span className="typo-caption">{item.source.sublabel}</span>}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <HeroTile icon={Clock} label="Waiting since"><RelativeTime timestamp={item.createdAt} className="typo-heading text-foreground" /></HeroTile>
          <HeroTile icon={Gauge} label="What it costs to clear">{costOf(item)}</HeroTile>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {tags.map((t) => (
              <span key={t.id} className="flex items-center gap-1.5 typo-eyebrow text-foreground">
                <span className={`h-1.5 w-1.5 rounded-pill ${TAG_DOT[t.tone]}`} aria-hidden />
                {t.label}
              </span>
            ))}
          </div>
        )}
        {extra}
        {meters.length > 0 && (
          <div className="flex flex-col gap-2.5 pt-1">
            {meters.map((f) => <ScoreMeter key={f.id} fact={f} />)}
          </div>
        )}
        {plainFacts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {plainFacts.map((f) => <FactLine key={f.id} fact={f} />)}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-primary/10 px-3 pb-3 pt-3" data-testid="p2-dock">
        {dock}
      </div>
    </aside>
  );
}
