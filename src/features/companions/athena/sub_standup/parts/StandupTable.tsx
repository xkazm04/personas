import { memo, useCallback, useEffect, useRef } from 'react';

import { GhostRows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { StandupSource } from '../data/types';
import type { StandupView } from '../model/types';
import type { StandupController } from './pageTypes';
import { clockLabel } from '../model/timeAxis';
import { useAxes } from './axis';
import { ColumnHead } from './ColumnHead';
import { DecisionModal } from './DecisionModal';
import { MachineRow } from './MachineRow';
import { StandupRow } from './StandupRow';
import { useRowActions } from './rowActions';

interface Props {
  view: StandupView;
  source: StandupSource;
  c: StandupController;
  loading: boolean;
}

/**
 * The page body: one scroller holding the sticky column head, the pinned
 * machine row and the grouped rows, all on the same column grid. Group heads
 * are quiet sticky separators; the cursor (`c.ui.sel`) is kept in view and
 * its decision opens in a modal (Enter or a click).
 */
export const StandupTable = memo(function StandupTable({ view, source, c, loading }: Props) {
  const { t } = useTranslation();
  const { sel, zoom, typing, decide } = c.ui;
  const axes = useAxes(view, zoom);
  const act = useRowActions(c, source);
  const editable = view.life === 'decide';
  const selectedKey = view.rows[sel]?.key;
  const { set, select } = c;
  const onOpen = useCallback((index: number) => { select(index); set({ decide: true }); }, [select, set]);

  // Follow the cursor, but never on mount: the page opens at its top, not scrolled to row 0's detail.
  const lastKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selectedKey) return;
    const first = lastKey.current === undefined;
    lastKey.current = selectedKey;
    if (!first) document.getElementById(`sc-row-${selectedKey}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  let flat = 0;
  return (
    <div className="sc-scroll">
      <ColumnHead axes={axes} zoom={zoom} clock={clockLabel(view.nowMs)} />
      <MachineRow
        view={view}
        zoom={zoom}
        axes={axes}
        utilizationLong={source.utilizationLong}
        loading={source.loading.machine}
        error={source.errors.machine}
        onZoom={() => set({ zoom: zoom === 'today' ? '12d' : 'today' })}
      />
      {loading && view.rows.length === 0 ? (
        <div className="sc-ghosts"><GhostRows count={7} size="l" label={t.athena.standup.loading} /></div>
      ) : (
        <div
          role="listbox"
          tabIndex={0}
          className="sc-list"
          aria-label={t.athena.standup.table_label}
          aria-activedescendant={selectedKey ? `sc-row-${selectedKey}` : undefined}
          data-testid="standup-table"
        >
          {view.groups.map((g) => (
            <div key={g.id} role="group" aria-label={t.athena.standup.groups[g.id].title}>
              <div className="sc-group" role="presentation">
                <span className="sc-group__title">{t.athena.standup.groups[g.id].title}</span>
                <span className="sc-group__count">{String(g.rows.length).padStart(2, '0')}</span>
                <i className="sc-group__rule" aria-hidden="true" />
              </div>
              {g.rows.map((row) => {
                const index = flat++;
                return (
                  <StandupRow
                    key={row.key}
                    row={row}
                    index={index}
                    selected={index === sel}
                    axes={axes}
                    rug={zoom === 'today'}
                    onOpen={onOpen}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
      <DecisionModal
        row={view.rows[sel]}
        open={decide}
        index={sel}
        total={view.rows.length}
        editable={editable}
        typing={typing === selectedKey}
        act={act}
        onClose={() => set({ decide: false, typing: null })}
      />
    </div>
  );
});
