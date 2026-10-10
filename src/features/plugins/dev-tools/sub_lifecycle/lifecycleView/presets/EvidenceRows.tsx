/**
 * Changes that passed through a step (tasks, commits, pull requests), one row
 * each: the outcome on the spine and as the module's pill, the change's title,
 * where it came from, when, and the step's own note for it in full readable
 * text under the row (a null note shows nothing). Rows with `onPress` open the
 * change.
 */
import { Fragment, type ReactNode } from 'react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ListRow, Rows, type Glyph, type Tone } from '@/features/shared/components/kit';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { outcomeLabel, sourceKindLabel } from '../../journey/journeyLabels';
import type { EvidenceRow } from '../blocks/evidenceRows';
import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { OutcomePill } from '../system/Pill';

/** The spine mark per outcome (the kit's own vocabulary; the pill beside it is the module's). */
export const OUTCOME_MARK: Record<LifecycleOutcome, { tone: Tone; glyph: Glyph }> = {
  done: { tone: 'success', glyph: 'solid' },
  skipped: { tone: 'warning', glyph: 'hollow' },
  unknown: { tone: 'neutral', glyph: 'empty' },
  failed: { tone: 'error', glyph: 'solid' },
};

interface EvidenceRowsProps {
  rows: EvidenceRow[];
  empty: string;
  onPress?: (row: EvidenceRow) => void;
  testId: string;
}

export function EvidenceRows({ rows, empty, onPress, testId }: EvidenceRowsProps) {
  const { dl } = useLifecycleViewModel();
  return (
    <div data-testid={testId}>
      <Rows count={rows.length} cap={10} empty={{ title: empty }}>
        {rows.map((r): ReactNode => (
          <Fragment key={r.key}>
            <ListRow
              name={r.item.title}
              meta={<><span>{sourceKindLabel(dl, r.item.sourceKind)}</span><span className={LT.code}>{r.item.sourceRef}</span></>}
              mark={{ ...OUTCOME_MARK[r.outcome], label: outcomeLabel(dl, r.outcome) }}
              figures={<OutcomePill outcome={r.outcome} />}
              time={<RelativeTime timestamp={r.item.occurredAt} />}
              onPress={onPress ? () => onPress(r) : undefined}
              testId={`${testId}-row-${r.key}`}
            />
            {r.detail && <p className={`pb-3 pl-14 pr-4 ${LT.row}`} data-testid={`${testId}-detail-${r.key}`}>{r.detail}</p>}
          </Fragment>
        ))}
      </Rows>
    </div>
  );
}
