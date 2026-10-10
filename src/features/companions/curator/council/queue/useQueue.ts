// The queue's one read: the councils as the page should see them right now
// (fixture decisions folded in), the rows of the active filter and the count
// behind each filter. The lanes draw it; `W` walks it in the lanes' order.
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { effectiveSubject } from '../bench/queueModel';
import { useCouncilStore, type CouncilStore } from '../councilStore';
import { filterCounts, laneOrder, queueRows, type LaneRow, type QueueFilter } from './laneModel';

export interface QueueView {
  rows: LaneRow[];
  counts: Record<QueueFilter, number>;
  filter: QueueFilter;
  /** The councils themselves are loading: a ghost under the chrome. */
  loading: boolean;
}

export function useQueue(): QueueView {
  const { raw, fixtureDecisions, status, filter } = useCouncilStore(
    useShallow((s) => ({
      raw: s.subjects,
      fixtureDecisions: s.fixtureDecisions,
      status: s.subjectsStatus,
      filter: s.queueFilter,
    })),
  );
  const subjects = useMemo(() => raw.map((s) => effectiveSubject(s, fixtureDecisions)), [raw, fixtureDecisions]);
  const counts = useMemo(() => filterCounts(subjects), [subjects]);
  const rows = useMemo(() => queueRows(subjects, filter), [subjects, filter]);
  return { rows, counts, filter, loading: status === 'loading' && subjects.length === 0 };
}

/** The rows of the active filter in the order the lanes draw them, read outside render. */
export function laneWalk(s: Pick<CouncilStore, 'subjects' | 'fixtureDecisions' | 'queueFilter'>): LaneRow[] {
  const subjects = s.subjects.map((x) => effectiveSubject(x, s.fixtureDecisions));
  return laneOrder(queueRows(subjects, s.queueFilter));
}
