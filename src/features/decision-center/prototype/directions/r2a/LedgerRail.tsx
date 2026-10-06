/**
 * The ledger well — P2's constant spine, recessed into the card. Every card
 * type carries it in the same order: who raised it (avatar monogram), the
 * universal facts as ICON + value (waiting, cost, project, occurrences — the
 * label lives in a tooltip), at most two tags as small caps, scores as real
 * meters, the item's own facts in words, a type section (contents for a
 * report, participants for a chat), and at the foot the DOCK.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DecisionItem } from '../../../model/decisionModel';
import { FACT_ICON, costOf, tagsOf } from './deckMeta';
import { ArcGauge, ScoreMeter, type ScoredFact } from './ScoreMeter';

function IconFact({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <span className="r2a-fact" tabIndex={0}>
        <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
        <span className="sr-only">{label}: </span>
        <span className="min-w-0 typo-data tabular-nums text-foreground">{children}</span>
      </span>
    </Tooltip>
  );
}

function SourceBadge({ item }: { item: DecisionItem }) {
  // By codepoint, not code unit: an emoji-initial name must not split a surrogate pair.
  const initial = ([...item.source.label][0] ?? '?').toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <span className="r2a-avatar h-10 w-10 typo-heading" style={{ borderColor: item.source.color ?? undefined }} aria-hidden>{initial}</span>
      <span className="flex min-w-0 flex-col">
        <span className="typo-heading text-foreground">{item.source.label}</span>
        {item.source.sublabel && <span className="typo-caption">{item.source.sublabel}</span>}
      </span>
    </div>
  );
}

export function LedgerRail({ item, extra, dock }: { item: DecisionItem; extra?: ReactNode; dock: ReactNode }) {
  const meters = item.facts.filter((f): f is ScoredFact => !!f.score);
  // A fact that restates the spine (the waiting time / first seen, the source's own name) is noise in the ledger.
  const rest = item.facts.filter((f) => !f.score && f.id !== 'waiting' && f.id !== 'first' && f.value !== item.source.label);
  const iconFacts = rest.filter((f) => FACT_ICON[f.id]);
  const named = rest.filter((f) => !FACT_ICON[f.id]);
  const tags = tagsOf(item);
  return (
    <aside className="r2a-ledger r2a-well" aria-label="Ledger" data-testid="r2a-ledger-rail">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-3 pt-4">
        <SourceBadge item={item} />
        <div className="r2a-facts">
          <IconFact icon={FACT_ICON.waiting!} label="Waiting since"><RelativeTime timestamp={item.createdAt} className="typo-data text-foreground" /></IconFact>
          <IconFact icon={FACT_ICON.cost!} label="What it costs you">{costOf(item)}</IconFact>
          {iconFacts.map((f) => <IconFact key={f.id} icon={FACT_ICON[f.id]!} label={f.label}>{f.value}</IconFact>)}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {tags.map((t) => <span key={t.id} className="r2a-tag typo-eyebrow" data-r2a-say={t.tone}>{t.label}</span>)}
          </div>
        )}
        {meters.length === 1 && <ArcGauge fact={meters[0]!} />}
        {meters.length > 1 && <div className="flex flex-col gap-1.5">{meters.map((f) => <ScoreMeter key={f.id} fact={f} />)}</div>}
        {named.length > 0 && (
          <dl className="r2a-named">
            {named.map((f) => (
              <div key={f.id} className="contents">
                <dt className="typo-label">{f.label}</dt>
                <dd className={`typo-data tabular-nums ${f.tone === 'success' ? 'text-status-success' : 'text-foreground'}`}>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {extra}
      </div>
      <div className="r2a-dock" data-testid="r2a-dock">
        {dock}
      </div>
    </aside>
  );
}
