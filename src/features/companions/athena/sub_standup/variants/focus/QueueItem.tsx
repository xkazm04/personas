import { memo, useCallback } from 'react';

import { ListRow } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../../model/types';
import { StateChip } from '../../parts/StateChip';
import { FOCUS_COPY as F } from './copy';
import { MARK } from './model';

/** The one line under the name: what was decided, or what is waiting to be. */
function useHeadline(row: RowView, proposing: boolean): string {
  const { t, tx } = useTranslation();
  const r = t.athena.standup.row;
  if (row.kind === 'agent') return row.state === 'proposed' ? (row.agentVerb === 'create' ? F.meta_agent_create : F.meta_agent_retune) : row.evidence;
  if (row.state === 'refused') return r.refused;
  if (row.state === 'waits') return row.headline;
  if (row.state === 'blank') return proposing && !row.evidence ? r.proposing : F.type_now;
  if (row.state === 'filler') return r.filler;
  if (row.state === 'skipped') return r.skipped;
  if (row.state === 'proposed') return tx(F.meta_directions, { n: row.proposals.length });
  return row.headline || row.name;
}

interface Props {
  row: RowView;
  index: number;
  selected: boolean;
  proposing: boolean;
  onSelect: (index: number) => void;
}

/**
 * One queue line: a kit ListRow (name, one-line headline, the state's mark
 * on the spine, the state chip as its figure) inside the listbox option the
 * keymap and the harness address. The option is the click target; the row
 * itself stays inert, so the listbox keeps one tab stop.
 */
export const QueueItem = memo(function QueueItem({ row, index, selected, proposing, onSelect }: Props) {
  const select = useCallback(() => onSelect(index), [onSelect, index]);
  const { t } = useTranslation();
  const headline = useHeadline(row, proposing);
  const mark = MARK[row.state];
  return (
    <div
      id={`sf-row-${row.key}`}
      role="option"
      aria-selected={selected}
      data-testid={`standup-row-${row.key}`}
      data-state={row.state}
      className="sf-item"
      onClick={select}
    >
      <ListRow
        size="l"
        name={row.name}
        meta={headline}
        mark={{ ...mark, label: t.athena.standup.state[row.state] }}
        figures={<StateChip row={row} />}
        state={selected ? 'selected' : undefined}
        nameClass={selected ? 'typo-body k-strong' : undefined}
      />
    </div>
  );
});
