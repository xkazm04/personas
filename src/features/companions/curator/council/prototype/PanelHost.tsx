// PROTOTYPE ROUND (spark council-readout). Mounts the chosen decisions-panel
// direction inside the fused stage, in place of `DecisionsPanel`.
//
// The host owns the data and the selection; a variant owns ONLY how the rows
// read and where on the stage it sits. A variant attaches `rootRef` to its
// outermost element: the stage reserves that box so the camera frames the
// field beside it, not under it.
import { useEffect, useMemo, type ComponentType, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { effectiveSubject } from '../bench/queueModel';
import { useCouncilStore } from '../councilStore';
import { filterCounts, panelRows, type PanelRow, type QueueFilter } from './protoModel';
import { useProtoStore } from './protoStore';
import type { PanelVariant } from './protoVariant';
import { BulletTable } from './panel/BulletTable';
import { LedgerStrip } from './panel/LedgerStrip';
import { ProjectLanes } from './panel/ProjectLanes';
import { Scorecards } from './panel/Scorecards';

export interface PanelVariantProps {
  rows: PanelRow[];
  filter: QueueFilter;
  counts: Record<QueueFilter, number>;
  onFilter: (filter: QueueFilter) => void;
  selectedId: string | null;
  /** Select a row: lights its stars and arms the header CTA. Selecting the selected row clears it. */
  onSelect: (subject: CouncilSubjectState) => void;
  /** Open the council full page (double click / Enter). Only for a subject with a run. */
  onOpen: (subject: CouncilSubjectState) => void;
  rootRef: RefObject<HTMLElement | null>;
  /** True while the subjects themselves are loading (draw a ghost under the chrome). */
  loading: boolean;
}

const VARIANTS: Record<Exclude<PanelVariant, 'current'>, ComponentType<PanelVariantProps>> = {
  ledger: LedgerStrip,
  cards: Scorecards,
  table: BulletTable,
  lanes: ProjectLanes,
};

export function PanelHost({
  variant,
  rootRef,
}: {
  variant: Exclude<PanelVariant, 'current'>;
  rootRef: RefObject<HTMLElement | null>;
}) {
  const raw = useCouncilStore((s) => s.subjects);
  const fixtureDecisions = useCouncilStore((s) => s.fixtureDecisions);
  const status = useCouncilStore((s) => s.subjectsStatus);
  const focusCouncil = useCouncilStore((s) => s.focusCouncil);
  const clearCouncilFocus = useCouncilStore((s) => s.clearCouncilFocus);
  const { selectedId, filter, details, select, open, setFilter, loadDetails } = useProtoStore(
    useShallow((s) => ({
      selectedId: s.selectedId,
      filter: s.filter,
      details: s.details,
      select: s.select,
      open: s.open,
      setFilter: s.setFilter,
      loadDetails: s.loadDetails,
    })),
  );

  const subjects = useMemo(() => raw.map((s) => effectiveSubject(s, fixtureDecisions)), [raw, fixtureDecisions]);
  const counts = useMemo(() => filterCounts(subjects), [subjects]);
  const rows = useMemo(() => panelRows(subjects, details, filter), [subjects, details, filter]);

  useEffect(() => {
    void loadDetails(rows.flatMap((r) => (r.subject.latestRunId ? [r.subject.latestRunId] : [])));
  }, [rows, loadDetails]);

  const Variant = VARIANTS[variant];
  return (
    <Variant
      rows={rows}
      filter={filter}
      counts={counts}
      onFilter={setFilter}
      selectedId={selectedId}
      onSelect={(s) => {
        if (s.id === selectedId) {
          select(null);
          clearCouncilFocus();
          return;
        }
        select(s.id);
        focusCouncil(s, null);
      }}
      onOpen={(s) => {
        if (!s.latestRunId) return;
        select(s.id);
        open(s.id);
      }}
      rootRef={rootRef}
      loading={status === 'loading' && subjects.length === 0}
    />
  );
}

export default PanelHost;
