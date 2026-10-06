// THE SPINE - every KPI in scope as one tick, in the estate's own ranking.
//
// A figure (doctrine 6c): 1,044 marks in four wrapped rows, where a labelled
// list of the same 1,044 names would be a page nobody reads. It carries two
// channels and no more - colour is the KPI's track in the module's existing
// ramp (`TRACK_COLOR`), hatch is "never read", which is the module's one mark
// for absence. There is no size channel: every KPI is one tick, because the
// point of the sequence is that they are COMPARABLE and individually
// addressable, not that some are bigger.
//
// Interaction, deliberately: the spine is ONE element, not 1,044 buttons. A
// thousand tab stops would bury the surface's real control (the keyboard) and
// a thousand focus rings is not a design. So the figure delegates: it reads
// the index off the pressed tick and hands it up, the cursor lives in the
// surface, and the plate is what announces the selection to a reader.
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';

import { HATCH_BG } from '../../kpiChartTheme';
import { TRACK_COLOR } from '../../kpiMeta';
import type { Spine } from './Console.model';

/** The cursor tick is drawn taller than the rest so the position is findable
 *  in four rows of ticks without hunting for a colour. */
const TICK_H = 14;
const CURSOR_H = 22;

export function ConsoleSpine({
  spine,
  at,
  onPick,
  label,
}: {
  spine: Spine;
  at: number;
  onPick: (index: number) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const o = t.kpis.overview;

  return (
    <div
      role="img"
      aria-label={label}
      className="flex flex-wrap items-end gap-px border-y border-primary/10 py-2"
      style={{ minHeight: CURSOR_H + 16 }}
      onClick={(e) => {
        const raw = (e.target as HTMLElement).dataset.tick;
        if (raw != null) onPick(Number(raw));
      }}
      data-testid="kpi-console-spine"
    >
      {spine.ticks.map((tick, i) => {
        const cursor = i === at;
        const dark = tick.track === 'unmeasured';
        const starts = spine.segments.some((s) => s.start === i);
        return (
          <span
            key={tick.kpi.id}
            data-tick={i}
            data-testid={cursor ? 'kpi-console-cursor' : undefined}
            className={`block w-[3px] shrink-0 cursor-pointer rounded-[1px] ${starts && i > 0 ? 'ml-2' : ''}`}
            style={{
              height: cursor ? CURSOR_H : TICK_H,
              background: dark ? undefined : TRACK_COLOR[tick.track],
              backgroundImage: dark ? HATCH_BG : undefined,
              // A stale reading keeps its verdict colour and takes a dashed
              // cap, the same "read, but older than its promise" mark the map
              // draws as a dashed edge.
              borderTop: tick.stale ? '2px dotted var(--status-info)' : undefined,
              outline: cursor ? '1px solid var(--foreground)' : undefined,
            }}
          />
        );
      })}
      {spine.ticks.length === 0 && <span className="typo-caption">{o.layer_no_series}</span>}
    </div>
  );
}

/** The segment rail under the spine: which project each run of ticks is, and
 *  which one the cursor is standing in. It is the spine's only text, and it
 *  is what makes a wrapped figure navigable without labelling 1,044 marks. */
export function ConsoleSegments({
  spine,
  active,
  onJump,
}: {
  spine: Spine;
  active: number;
  onJump: (index: number) => void;
}) {
  const { t, tx } = useTranslation();
  return (
    <ol className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {spine.segments.map((segment, i) => (
        <li key={segment.projectId}>
          <Button
            variant="ghost"
            size="xs"
            className={i === active ? 'bg-secondary/40' : ''}
            onClick={() => onJump(segment.start)}
            data-testid={`kpi-console-segment-${segment.projectId}`}
            aria-current={i === active ? 'true' : undefined}
          >
            <span className={i === active ? 'typo-data' : 'typo-caption'}>{segment.label}</span>{' '}
            <span className="typo-caption tabular-nums">{segment.count}</span>
          </Button>
        </li>
      ))}
      {spine.segments.length > 1 && (
        <li className="typo-caption tabular-nums ml-auto">
          {tx(t.kpis.overview.books_footer, { rows: spine.segments.length, total: spine.ticks.length })}
        </li>
      )}
    </ol>
  );
}
