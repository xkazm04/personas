/**
 * Changes that passed through a step (tasks, commits, pull requests), one row
 * each: the outcome on the spine and as a chip, the change's title, where it
 * came from, when, and the step's own note for it in full readable text under
 * the row (a null note shows nothing). Rows with `onPress` open the change.
 */
import { Fragment, type ReactNode } from 'react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ListRow, Rows, type Glyph, type Tone } from '@/features/shared/components/kit';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { outcomeLabel, sourceKindLabel } from '../../journey/journeyLabels';
import { OUTCOME_TEXT } from '../../journey/journeyStyles';
import type { EvidenceRow } from '../blocks/evidenceRows';
import { useLifecycleViewModel } from '../context';

export const OUTCOME_MARK: Record<LifecycleOutcome, { tone: Tone; glyph: Glyph }> = {
  done: { tone: 'success', glyph: 'solid' },
  skipped: { tone: 'warning', glyph: 'hollow' },
  unknown: { tone: 'neutral', glyph: 'empty' },
  failed: { tone: 'error', glyph: 'solid' },
};

export function OutcomeChip({ outcome }: { outcome: LifecycleOutcome }) {
  const { dl } = useLifecycleViewModel();
  return (
    <span className={`rounded-pill border border-current px-2.5 py-0.5 typo-label ${OUTCOME_TEXT[outcome]}`} data-outcome={outcome}>
      {outcomeLabel(dl, outcome)}
    </span>
  );
}

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
              meta={<><span>{sourceKindLabel(dl, r.item.sourceKind)}</span><span className="typo-code">{r.item.sourceRef}</span></>}
              mark={{ ...OUTCOME_MARK[r.outcome], label: outcomeLabel(dl, r.outcome) }}
              figures={<OutcomeChip outcome={r.outcome} />}
              time={<RelativeTime timestamp={r.item.occurredAt} />}
              onPress={onPress ? () => onPress(r) : undefined}
              testId={`${testId}-row-${r.key}`}
            />
            {r.detail && <p className="pb-3 pl-14 pr-4 typo-body text-foreground" data-testid={`${testId}-detail-${r.key}`}>{r.detail}</p>}
          </Fragment>
        ))}
      </Rows>
    </div>
  );
}
