// PROTOTYPE ROUND (spark council-readout), direction D - Project lanes.
//
// The queue as a HEATMAP grouped by project: one lane per project (its name,
// its count, and its mean per member on the same columns), one row per
// council with a heat cell per member - colour = score on a sequential ramp
// from the theme's primary, hatched = not measured, a red corner = floor hit -
// and the overall figure. Every lane shares the columns, so "which project is
// weakest at robustness" is one column read down the lane heads.
import { useId, useMemo, useRef, type CSSProperties } from 'react';
import { CheckCircle2 } from 'lucide-react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Ghost } from '@/features/shared/components/kit';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import type { PanelVariantProps } from '../PanelHost';
import type { QueueFilter } from '../protoModel';
import { PROTO } from '../protoStrings';
import { HeatCell } from './lanes/HeatCell';
import { lanesOf, memberColumns } from './lanes/laneModel';
import { LaneHead } from './lanes/LaneHead';
import { LaneRow } from './lanes/LaneRow';
import { LanesHead, LanesKey } from './lanes/LanesLegend';
import { useLaneKeys } from './lanes/useLaneKeys';
import './lanes/lanes.css';

const S = {
  label: 'Councils by project',
  filterLabel: 'Which councils',
  emptyTitle: { waiting: 'Nothing waits on you', machine: 'No machine passes', decided: 'Nothing decided yet' } satisfies Record<QueueFilter, string>,
  emptySub: 'Councils land here as their rounds finish.',
};

const FILTERS: QueueFilter[] = ['waiting', 'machine', 'decided'];

export function ProjectLanes({ rows, filter, counts, onFilter, selectedId, onSelect, onOpen, rootRef, loading }: PanelVariantProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  // The filter tabs own the scroller as their panel (one panel, re-filled per tab).
  const tabs = `ln-${idBase}`;
  const members = useMemo(() => memberColumns(rows), [rows]);
  const lanes = useMemo(() => lanesOf(rows, members), [rows, members]);
  // The order on screen (lane by lane) is the order the arrows walk.
  const flat = useMemo(() => lanes.flatMap((l) => l.rows), [lanes]);
  const onKey = useLaneKeys({ rows: flat, selectedId, onSelect, onOpen, listRef });
  const tabStop = flat.some((r) => r.subject.id === selectedId) ? selectedId : (flat[0]?.subject.id ?? null);
  const threshold = rows[0]?.rubric.threshold ?? 0.7;
  const style = { '--ln-members': String(members.length) } as CSSProperties;
  const empty = !loading && rows.length === 0;

  return (
    <section ref={rootRef} className={`ln${empty ? ' is-empty' : ''}`} style={style} aria-label={S.label} data-proto-panel="ProjectLanes">
      <header className="ln-head">
        <SegmentedTabs
          ariaLabel={S.filterLabel}
          idPrefix={tabs}
          fullWidth={false}
          activeTab={filter}
          onTabChange={onFilter}
          tabs={FILTERS.map((f) => ({
            id: f,
            label: (
              <>
                {PROTO.filter[f]}
                <b className="ln-count typo-heading font-data">{counts[f]}</b>
              </>
            ),
          }))}
        />
      </header>
      <div role="tabpanel" id={`${tabs}-panel-${filter}`} aria-labelledby={`${tabs}-tab-${filter}`} className="ln-scroll">
        {empty ? (
          <ScenarioEmptyState icon={CheckCircle2} title={S.emptyTitle[filter]} subtitle={S.emptySub} />
        ) : (
          <>
            <LanesHead members={members} threshold={threshold} />
            <div ref={listRef} role="listbox" aria-label={S.label} aria-busy={loading || undefined} className="ln-list">
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

export default ProjectLanes;
