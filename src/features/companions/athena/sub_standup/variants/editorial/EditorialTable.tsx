import { memo, useEffect, useRef } from 'react';

import { GhostRows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { StandupSource } from '../../data/types';
import type { GroupId, StandupView } from '../../model/types';
import type { StandupController } from '../types';
import { useAxes } from './axis';
import { ColumnHead } from './ColumnHead';
import { ED_COPY } from './copy';
import { EditorialRow } from './EditorialRow';
import { MachineRow } from './MachineRow';
import { useRowActions } from './rowActions';

/** A section's running head: TITLE ....... n, then the group's own column subheads where they differ. */
function GroupHead({ id, n }: { id: GroupId; n: number }) {
  const { t } = useTranslation();
  const g = t.athena.standup.groups[id];
  const col = ED_COPY.col;
  const sub = (text: string, same: string) => (text.toLowerCase() === same.toLowerCase() ? null : <span className="se-group__sub">{text}</span>);
  return (
    <div className="se-group se-grid" role="presentation">
      <div className="se-cell se-c1 se-group__head">
        <span className="se-sc">{g.title}</span>
        <span className="se-leader" aria-hidden="true" />
        <span className="se-group__n se-num">{n}</span>
      </div>
      <div className="se-cell se-c2">{sub(g.past, col.today)}</div>
      <div className="se-cell se-c3">{sub(g.now, col.decision)}</div>
      <div className="se-cell se-c4">{sub(g.night, col.tonight)}</div>
    </div>
  );
}

interface Props {
  view: StandupView;
  source: StandupSource;
  c: StandupController;
  loading: boolean;
}

/**
 * The body: one scroller holding the sticky column head, the pinned machine
 * row and the grouped rows, all on the same column grid. Each group opens with
 * a running head (small caps, a dotted leader to its count, the group's own
 * column subheads in italic); the cursor (`c.ui.sel`) is kept in view.
 */
export const EditorialTable = memo(function EditorialTable({ view, source, c, loading }: Props) {
  const { t } = useTranslation();
  const { sel, zoom, typing } = c.ui;
  const axes = useAxes(view, zoom);
  const act = useRowActions(c, source);
  const editable = view.life === 'decide';
  const selectedKey = view.rows[sel]?.key;
  const { set, select } = c;

  // Follow the cursor, but never on mount: the page opens at its top, not scrolled to row 0's detail.
  const lastKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selectedKey) return;
    const first = lastKey.current === undefined;
    lastKey.current = selectedKey;
    if (!first) document.getElementById(`se-row-${selectedKey}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  let flat = 0;
  return (
    <div className="se-scroll">
      <ColumnHead axes={axes} zoom={zoom} />
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
        <div className="se-ghosts"><GhostRows count={7} size="l" label={t.athena.standup.loading} /></div>
      ) : (
        <div
          role="listbox"
          tabIndex={0}
          className="se-list"
          aria-label={t.athena.standup.table_label}
          aria-activedescendant={selectedKey ? `se-row-${selectedKey}` : undefined}
          data-testid="standup-table"
        >
          {view.groups.map((g) => (
            <div key={g.id} role="group" aria-label={t.athena.standup.groups[g.id].title}>
              <GroupHead id={g.id} n={g.rows.length} />
              {g.rows.map((row) => {
                const index = flat++;
                return (
                  <EditorialRow
                    key={row.key}
                    row={row}
                    index={index}
                    selected={index === sel}
                    editable={editable}
                    typing={typing === row.key}
                    proposing={source.proposing}
                    axes={axes}
                    rug={zoom === 'today'}
                    act={act}
                    onSelect={select}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
