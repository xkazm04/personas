/**
 * The change timeline: every change the step has a record of, by day, newest
 * first. The outcome chips over it are the filter AND the tally (each carries
 * its count and its share); pressing the chip that is on shows all again. A
 * change opens in the drawer with what it did on every step.
 */
import { useMemo, useState } from 'react';

import { ChipRow, Section, type Chip } from '@/features/shared/components/kit';

import { outcomeLabel } from '../../../journey/journeyLabels';
import type { EvidenceRow } from '../../blocks/evidenceRows';
import { useLifecycleViewModel } from '../../context';
import { RHYTHM } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { OUTCOME_MARK } from '../EvidenceRows';
import { ChangeDrawer } from './ChangeDrawer';
import { OUTCOME_ORDER, outcomeCounts } from './evidenceModel';
import { filterRows, toggleFilter, type OutcomeFilter } from './timeline';
import { TimelineList } from './TimelineList';

export function ChangeTimeline({ rows, stepId, loading }: { rows: EvidenceRow[]; stepId: string; loading: boolean }) {
  const { dl } = useLifecycleViewModel();
  const [filter, setFilter] = useState<OutcomeFilter>('all');
  const [opened, setOpened] = useState<EvidenceRow | null>(null);
  const counts = useMemo(() => outcomeCounts(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const total = rows.length;

  const chips: Chip[] = [
    { id: 'all', label: dl.lcx8_filter_all, count: total, state: filter === 'all' ? 'selected' : undefined, onPress: () => setFilter('all') },
    ...OUTCOME_ORDER.filter((o) => counts[o] > 0).map((o): Chip => ({
      id: o,
      label: outcomeLabel(dl, o),
      count: counts[o],
      share: total > 0 ? counts[o] / total : 0,
      tone: OUTCOME_MARK[o].tone,
      glyph: OUTCOME_MARK[o].glyph,
      state: filter === o ? 'selected' : undefined,
      onPress: () => setFilter((f) => toggleFilter(f, o)),
    })),
  ];

  return (
    <Section
      title={dl.lcx8_timeline_title}
      level={2}
      count={total || undefined}
      desc={total > 0 ? dl.lcx8_timeline_desc : undefined}
      state={loading ? 'loading' : total === 0 ? 'empty' : undefined}
      empty={{ title: dl.lc_detail_no_evidence }}
    >
      <div className={RHYTHM.block} data-testid="lc8-timeline" data-filter={filter}>
        <ChipRow chips={chips} label={dl.lcx8_filter_label} emptyLabel={dl.lc_detail_no_evidence} />
        {shown.length === 0
          ? <p className={`px-3 ${LT.row}`} data-testid="lc8-timeline-none">{dl.lcx8_filter_empty}</p>
          : <TimelineList key={filter} rows={shown} onOpen={setOpened} />}
      </div>
      <ChangeDrawer row={opened} stepId={stepId} onClose={() => setOpened(null)} />
    </Section>
  );
}
