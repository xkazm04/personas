// PROTOTYPE ROUND (spark council-readout), direction B - Scorecards.
//
// A stack of cards floating at the right of the field, each led by the
// council's own figure: a small rose whose petals are the members (width =
// weight, reach = score), with each floor as an arc and the bar as a ring.
// The reader's eye goes rose, title, verdict chip; the selected card grows in
// place into the council's one-line reading and the figures a decision needs,
// while the rest stay compact so six and more fit at 1080.
import { CheckCircle2 } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { interpolate as tx, useTranslation } from '@/i18n/useTranslation';
import { formatCount } from '@/lib/utils/formatters';

import { FEATURE_V1 } from '../../table/rubrics';
import type { PanelVariantProps } from '../PanelHost';
import type { QueueFilter } from '../protoModel';
import { PROTO } from '../protoStrings';
import { CardRose } from './cards/CardRose';
import { cardId, EMPTY, S } from './cards/cardsModel';
import { ScoreCard } from './cards/ScoreCard';
import { useCardKeys } from './cards/useCardKeys';
import './cards/cards.css';

const FILTERS: QueueFilter[] = ['waiting', 'machine', 'decided'];
const GHOSTS = 6;
const TABS = 'council-cards-filter';

export function Scorecards({
  rows,
  filter,
  counts,
  onFilter,
  selectedId,
  onSelect,
  onOpen,
  rootRef,
  loading,
}: PanelVariantProps) {
  const { language } = useTranslation();
  const onKeyDown = useCardKeys(rows, selectedId, onSelect, onOpen, cardId);
  const threshold = rows[0]?.rubric.threshold ?? FEATURE_V1.threshold;
  const active = selectedId && rows.some((r) => r.subject.id === selectedId) ? cardId(selectedId) : undefined;

  return (
    <section ref={rootRef} className="sc" data-proto-panel="Scorecards" aria-label={S.listLabel}>
      <header className="sc-head">
        <SegmentedTabs<QueueFilter>
          tabs={FILTERS.map((id) => ({
            id,
            testId: `${TABS}-${id}`,
            label: (
              <span className="sc-tab">
                <span className={`typo-data-lg ${id === 'waiting' && counts.waiting ? 'text-status-warning' : 'text-foreground'}`}>
                  {formatCount(counts[id], { language })}
                </span>
                <span className="typo-label text-foreground">{PROTO.filter[id]}</span>
              </span>
            ),
          }))}
          activeTab={filter}
          onTabChange={onFilter}
          ariaLabel={S.filterLabel}
          idPrefix={TABS}
          size="sm"
          fullWidth={false}
          className="sc-tabs"
        />
        <p className="m-0 typo-caption sc-advisory">
          <i aria-hidden="true" className="sc-ring" />
          {tx(S.advisory, { threshold: formatCount(threshold, { precision: 2, language }) })}
        </p>
      </header>
      <div role="tabpanel" id={`${TABS}-panel-${filter}`} aria-labelledby={`${TABS}-tab-${filter}`} className="sc-panel">
        {loading ? (
          <ul className="sc-list" aria-busy="true" aria-label={PROTO.loading}>
            {Array.from({ length: GHOSTS }, (_, i) => (
              <li key={i} className="sc-card ghost" aria-hidden="true">
                <CardRose seats={null} threshold={threshold} size={72} lite={false} />
                <div className="sc-body">
                  <span className="sc-ghost-title" />
                  <span className="sc-ghost-meta" />
                </div>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={PROTO.empty} subtitle={EMPTY[filter]} className="sc-empty" />
        ) : (
          <ul
            className="sc-list"
            role="listbox"
            tabIndex={0}
            aria-label={PROTO.filter[filter]}
            aria-activedescendant={active}
            onKeyDown={onKeyDown}
          >
            {rows.map((row) => (
              <ScoreCard
                key={row.subject.id}
                row={row}
                filter={filter}
                selected={row.subject.id === selectedId}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default Scorecards;
