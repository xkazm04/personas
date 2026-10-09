// PROTOTYPE ROUND (spark council-readout), direction A - Ledger strip.
//
// A docked right column, typographic and calm, read top to bottom like a
// column of accounts: each council's name in large type, its five members as
// one segmented bar on a shared scale (fill = score, notch = floor, tick =
// the bar, hatched = nobody measured it), its coverage as a rule under the
// bar, and its overall as the account's figure in the right-hand column,
// toned by distance to the bar - never red for merely being under it, since
// the instrument is uncalibrated and the bar only orders the queue.
import { CheckCircle2 } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { FEATURE_V1 } from '../../table/rubrics';
import type { PanelVariantProps } from '../PanelHost';
import type { QueueFilter } from '../protoModel';
import { PROTO } from '../protoStrings';
import { LedgerKey, LedgerTotal } from './ledger/LedgerHeader';
import { LedgerRow } from './ledger/LedgerRow';
import { EMPTY, optionId, S } from './ledger/ledgerModel';
import { useLedgerKeys } from './ledger/useLedgerKeys';
import './ledger/ledger.css';

const GHOSTS = 7;
const FILTERS: QueueFilter[] = ['waiting', 'machine', 'decided'];
const TABS = 'council-ledger-filter';

export function LedgerStrip({
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
  const onKeyDown = useLedgerKeys(rows, selectedId, onSelect, onOpen, optionId);
  const threshold = rows[0]?.rubric.threshold ?? FEATURE_V1.threshold;
  const active = selectedId && rows.some((r) => r.subject.id === selectedId) ? optionId(selectedId) : undefined;

  return (
    <section ref={rootRef} className="lg" data-proto-panel="LedgerStrip" aria-label={S.listLabel}>
      <header className="lg-head">
        <SegmentedTabs<QueueFilter>
          tabs={FILTERS.map((id) => ({ id, testId: `${TABS}-${id}`, label: <LedgerTotal id={id} count={counts[id]} /> }))}
          activeTab={filter}
          onTabChange={onFilter}
          ariaLabel={S.filterLabel}
          idPrefix={TABS}
          size="sm"
          fullWidth={false}
          className="lg-tabs"
        />
        <LedgerKey threshold={threshold} />
      </header>
      <div role="tabpanel" id={`${TABS}-panel-${filter}`} aria-labelledby={`${TABS}-tab-${filter}`} className="lg-panel">
        {loading ? (
          <ul className="lg-list" aria-busy="true" aria-label={PROTO.loading}>
            {Array.from({ length: GHOSTS }, (_, i) => (
              <li key={i} className="lg-row ghost" aria-hidden="true">
                <span className="lg-ghost-title" />
                <span className="lg-ghost-fig" />
                <span className="lg-ghost-bar" />
                <span className="lg-ghost-meta" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={PROTO.empty} subtitle={EMPTY[filter]} className="lg-empty" />
        ) : (
          <ul
            className="lg-list"
            role="listbox"
            tabIndex={0}
            aria-label={PROTO.filter[filter]}
            aria-activedescendant={active}
            onKeyDown={onKeyDown}
          >
            {rows.map((row) => (
              <LedgerRow
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

export default LedgerStrip;
