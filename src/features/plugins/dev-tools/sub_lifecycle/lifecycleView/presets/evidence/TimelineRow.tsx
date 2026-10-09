/**
 * One change on the timeline: its outcome on the spine, its title (the row's
 * one press, which opens the change), where it came from with the reference
 * copyable, the outcome pill and the time of day (the day is the sticky head
 * above it), and the step's note for it in full under the row.
 */
import { CopyButton } from '@/features/shared/components/buttons';
import { ListRow } from '@/features/shared/components/kit';

import { outcomeLabel, sourceKindGlyph, sourceKindLabel } from '../../../journey/journeyLabels';
import type { EvidenceRow } from '../../blocks/evidenceRows';
import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { OutcomePill } from '../../system/Pill';
import { GLYPH } from '../../system/scales';
import { OUTCOME_MARK } from '../EvidenceRows';

export const TIMELINE_TEST_ID = 'lc2-evidence';

export function TimelineRow({ row, time, onOpen }: { row: EvidenceRow; time: string; onOpen: (row: EvidenceRow) => void }) {
  const { dl } = useLifecycleViewModel();
  const { item } = row;
  const Glyph = sourceKindGlyph(item.sourceKind);
  return (
    <div className="pb-1" data-outcome-row={row.outcome}>
      <ListRow
        name={item.title}
        meta={(
          <>
            <span className="inline-flex items-center gap-1.5">
              <Glyph className={`${GLYPH.sm} shrink-0`} aria-hidden />
              {sourceKindLabel(dl, item.sourceKind)}
            </span>
            <span className={`truncate ${LT.code}`}>{item.sourceRef}</span>
          </>
        )}
        mark={{ ...OUTCOME_MARK[row.outcome], label: outcomeLabel(dl, row.outcome) }}
        figures={(
          <>
            <CopyButton text={item.sourceRef} tooltip={dl.lcx8_copy_ref} />
            <OutcomePill outcome={row.outcome} />
          </>
        )}
        time={time}
        onPress={() => onOpen(row)}
        testId={`${TIMELINE_TEST_ID}-row-${row.key}`}
      />
      {row.detail && (
        <p className={`k-in pb-2 break-words ${LT.row}`} data-testid={`${TIMELINE_TEST_ID}-detail-${row.key}`}>{row.detail}</p>
      )}
    </div>
  );
}
