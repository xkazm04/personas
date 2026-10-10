// The queue - Project lanes (owner-chosen 2026-10-09, spark council-readout).
//
// A HEATMAP grouped by project: one lane per project (its name, its count,
// and its mean per member on the same columns), one row per council with a
// heat cell per member - colour = score on a sequential ramp from the theme's
// primary, hatched = not measured, a red corner = floor hit - and the overall
// figure. Every lane shares the columns, so "which project is weakest at
// robustness" is one column read down the lane heads.
//
// Every figure comes from the list projection (`dimensions`,
// `mustAddressCount`); drawing the queue reads no run. It docks on the fused
// stage and attaches `rootRef` to its outermost element so the camera frames
// the field beside it.
import { useCallback, useId, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import { CheckCircle2 } from 'lucide-react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Ghost } from '@/features/shared/components/kit';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

import { useCouncilStore } from '../councilStore';
import { HeatCell } from './HeatCell';
import { lanesOf, memberColumns, QUEUE_FILTERS, type QueueFilter } from './laneModel';
import { LaneHead } from './LaneHead';
import { LaneRow } from './LaneRow';
import { LanesHead, LanesKey } from './LanesLegend';
import { useLaneKeys } from './useLaneKeys';
import { useQueue } from './useQueue';
import './lanes.css';

export function CouncilLanes({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const w = t.council.lanes;
  const { rows, counts, filter, loading } = useQueue();
  const selectedId = useCouncilStore((s) => s.selectedId);
  const setFilter = useCouncilStore((s) => s.setQueueFilter);
  const selectCouncil = useCouncilStore((s) => s.selectCouncil);
  const openCouncil = useCouncilStore((s) => s.openCouncil);

  const listRef = useRef<HTMLDivElement | null>(null);
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  // The filter tabs own the scroller as their panel (one panel, re-filled per tab).
  const tabs = `ln-${idBase}`;
  const members = useMemo(() => memberColumns(rows), [rows]);
  const lanes = useMemo(() => lanesOf(rows, members), [rows, members]);
  // The order on screen (lane by lane) is the order the arrows walk.
  const flat = useMemo(() => lanes.flatMap((l) => l.rows), [lanes]);
  // Selecting the selected row clears it; only a council with a run opens.
  const onSelect = useCallback(
    (s: CouncilSubjectState) => selectCouncil(s.id === selectedId ? null : s),
    [selectCouncil, selectedId],
  );
  const onOpen = useCallback(
    (s: CouncilSubjectState) => {
      if (s.latestRunId) openCouncil(s.id);
    },
    [openCouncil],
  );
  const onKey = useLaneKeys({ rows: flat, selectedId, onSelect, onOpen, listRef });
  const tabStop = flat.some((r) => r.subject.id === selectedId) ? selectedId : (flat[0]?.subject.id ?? null);
  const threshold = rows[0]?.rubric.threshold ?? 0.7;
  const style = { '--ln-members': String(members.length) } as CSSProperties;
  const empty = !loading && rows.length === 0;
  const label: Record<QueueFilter, string> = { waiting: w.filter_waiting, machine: w.filter_machine, decided: w.filter_decided };
  const emptyTitle: Record<QueueFilter, string> = { waiting: w.empty_waiting, machine: w.empty_machine, decided: w.empty_decided };

  return (
    <section ref={rootRef} className={`ln${empty ? ' is-empty' : ''}`} style={style} aria-label={w.label} data-testid="council-lanes">
      <header className="ln-head">
        <SegmentedTabs
          ariaLabel={w.filter_label}
          idPrefix={tabs}
          fullWidth={false}
          activeTab={filter}
          onTabChange={setFilter}
          tabs={QUEUE_FILTERS.map((f) => ({
            id: f,
            label: (
              <>
                {label[f]}
                <b className="ln-count typo-heading font-data">{counts[f]}</b>
              </>
            ),
          }))}
        />
      </header>
      <div role="tabpanel" id={`${tabs}-panel-${filter}`} aria-labelledby={`${tabs}-tab-${filter}`} className="ln-scroll">
        {empty ? (
          <ScenarioEmptyState icon={CheckCircle2} title={emptyTitle[filter]} subtitle={w.empty_sub} />
        ) : (
          <>
            <LanesHead members={members} threshold={threshold} />
            <div ref={listRef} role="listbox" aria-label={w.label} aria-busy={loading || undefined} className="ln-list">
              {loading
                ? [0, 1, 2].map((i) => (
                    <div key={i} className="ln-row is-ghost" aria-hidden="true">
                      <span className="ln-name">
                        <Ghost width="70%" />
                        <Ghost width="40%" height="10px" />
                      </span>
                      {members.map((m) => (
                        <HeatCell key={m} kind="ghost" score={null} />
                      ))}
                      <Ghost width="40px" inline />
                    </div>
                  ))
                : lanes.map((lane, i) => (
                    <div key={lane.project} role="group" aria-labelledby={`${idBase}-lane-${i}`} className="ln-lane">
                      <LaneHead lane={lane} members={members} headId={`${idBase}-lane-${i}`} />
                      {lane.rows.map((row) => (
                        <LaneRow
                          key={row.subject.id}
                          row={row}
                          members={members}
                          selected={row.subject.id === selectedId}
                          focusable={row.subject.id === tabStop}
                          onSelect={onSelect}
                          onOpen={onOpen}
                          onKeyDown={onKey}
                        />
                      ))}
                    </div>
                  ))}
            </div>
          </>
        )}
      </div>
      {!empty && <LanesKey />}
    </section>
  );
}

export default CouncilLanes;
