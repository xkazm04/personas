/**
 * The ledger rail — P2's constant spine, drawn as a recessed well. Every card
 * type carries the same rail in the same order: who raised it (monogram), the
 * two read-outs every card answers first as figures (waiting · cost — glyph
 * and figure, the word in a tooltip), at most two tags, scored facts as
 * instrument meters, a type section (contents for a report, people for a
 * chat), and at its foot the DOCK — every action, with its key inside it.
 *
 * Plain facts (first seen, occurrences, saves…) and scored meters move to the
 * body (its Record and Score rows) where the body has the width; only the
 * reader cards, whose body is the document, keep them here.
 */
import type { CSSProperties, ReactNode } from 'react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DecisionItem } from '../../../model/decisionModel';
import { CLOCK_ICON, COST_ICON, LAMP_TONE, costParts, visibleTags } from './deckMeta';
import { Mono } from './Mono';
import { ScoreMeter } from './ScoreMeter';

export function metersOf(item: DecisionItem) {
  return item.facts.filter((f): f is typeof f & { score: NonNullable<typeof f.score> } => !!f.score);
}

export function plainFactsOf(item: DecisionItem) {
  // A fact that restates the spine (the waiting time, the source's own name) is noise.
  return item.facts.filter((f) => !f.score && f.id !== 'waiting' && f.value !== item.source.label);
}

function Stat({ tip, icon, children }: { tip: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Tooltip content={tip}>
      <div className="r2b-stat" tabIndex={0} aria-label={tip}>
        <span className="r2b-stat-icon">{icon}</span>
        <span className="r2b-stat-value">{children}</span>
      </div>
    </Tooltip>
  );
}

export function LedgerRail({ item, extra, dock, plainInRail }: { item: DecisionItem; extra?: ReactNode; dock: ReactNode; plainInRail: boolean }) {
  const meters = plainInRail ? metersOf(item) : [];
  const plain = plainInRail ? plainFactsOf(item) : [];
  const tags = visibleTags(item);
  const cost = costParts(item);
  const Clock = CLOCK_ICON;
  const Cost = COST_ICON;
  return (
    <aside className="r2b-rail" aria-label="Ledger" data-testid="r2b-ledger-rail">
      <div className="r2b-rail-scroll">
        <div className="r2b-rail-sec flex items-center gap-3">
          <Mono label={item.source.label} color={item.source.color} size="lg" />
          <span className="flex min-w-0 flex-col">
            <span className="typo-heading text-foreground">{item.source.label}</span>
            {item.source.sublabel && <span className="typo-caption">{item.source.sublabel}</span>}
          </span>
        </div>
        <div className="r2b-rail-sec r2b-stats">
          <Stat tip="Waiting — how long this has been held for you" icon={<Clock className="h-4 w-4" aria-hidden />}>
            <RelativeTime timestamp={item.createdAt} format="elapsed" className="r2b-figure" />
          </Stat>
          <Stat tip="Cost to clear it" icon={<Cost className="h-4 w-4" aria-hidden />}>
            <span className="r2b-figure">{cost.value}</span>
            <span className="typo-caption r2b-caps">{cost.unit}</span>
          </Stat>
        </div>
        {tags.length > 0 && (
          <div className="r2b-rail-sec r2b-tags">
            {tags.map((t) => (
              <span key={t.id} className="r2b-tag typo-caption" style={{ '--r2b-tag-tone': LAMP_TONE[t.tone] } as CSSProperties}>{t.label}</span>
            ))}
          </div>
        )}
        {meters.length > 0 && (
          <div className="r2b-rail-sec">
            {meters.map((f) => <ScoreMeter key={f.id} fact={f} />)}
          </div>
        )}
        {plain.length > 0 && (
          <div className="r2b-rail-sec flex flex-col gap-2">
            {plain.map((f) => (
              <div key={f.id} className="flex items-baseline justify-between gap-3">
                <span className="typo-caption">{f.label}</span>
                <span className="typo-data r2b-num text-foreground">{f.value}</span>
              </div>
            ))}
          </div>
        )}
        {extra && <div className="r2b-rail-sec">{extra}</div>}
      </div>
      <div className="r2b-dock" data-testid="r2b-dock">{dock}</div>
    </aside>
  );
}
