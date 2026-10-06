/**
 * A project that is not the open sheet, drawn compact as a bus strip: its
 * letter hex and counts, then one group per milestone - a numbered terminal
 * with its rail segment and a hexagon per goal pinned under it - and the open
 * bus dashed at the end; its average and a five-light bar on the right.
 *
 * Clicking the strip opens it as the sheet (clicking a hexagon also puts the
 * cursor on that goal). Each milestone group is a drop target, so a goal dragged off the
 * open sheet can be wired onto a rail of a strip - within its own project
 * only; the drop refuses a goal from another project rather than binding it
 * across.
 */
import type { CSSProperties, MouseEvent } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { isComplete } from '../../../goalStatus';
import { useProgressView } from '../../canvasHost';
import type { LaneDrop } from '../../rowCanvas';
import { railInk, statusInk, type BusBand, type BusProject } from './busbarModel';
import { Hex } from './busbarParts';
import type { BusbarState } from './useBusbarState';

export function BusbarStrip({ project, s, drop }: { project: BusProject; s: BusbarState; drop: LaneDrop }) {
  const { tx } = useTranslation();
  const { canvas, dl } = useProgressView();
  const { row } = project;

  const onPick = (e: MouseEvent) => {
    const goalId = (e.target as HTMLElement).closest<HTMLElement>('[data-busbar-cell]')?.dataset.busbarCell;
    s.focusProject(row.projectId, goalId);
  };
  const lit = project.avg / 20;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={tx(dl.busbar_strip_aria, { name: row.name })}
      data-testid={`busbar-strip-${row.projectId}`}
      className="bb-strip"
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          s.focusProject(row.projectId);
        }
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Hex ink="var(--primary)" size={24}>
          <span className="bb-mono typo-data">{project.letter || '-'}</span>
        </Hex>
        <div className="min-w-0">
          <div className="typo-heading text-foreground truncate">{row.name}</div>
          <div className="bb-mono typo-data bb-dim truncate">
            {tx(dl.busbar_strip_counts, { live: row.activeCount, done: row.doneCount, milestones: project.laneCount })}
          </div>
        </div>
      </div>

      <div className="bb-strip-bus">
        {project.bands.map((band) => (
          <StripGroup key={band.key} band={band} drop={drop} draggingId={canvas.drag.draggingId} />
        ))}
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <span className="bb-mono typo-data text-foreground tabular-nums">{project.avg}%</span>
        <span className="bb-led" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <i key={i} className={i < Math.floor(lit) ? 'on' : i < lit ? 'half' : undefined} />
          ))}
        </span>
      </div>
    </div>
  );
}

function StripGroup({
  band,
  drop,
  draggingId,
}: {
  band: BusBand;
  drop: LaneDrop;
  draggingId: string | null;
}) {
  const { canvas } = useProgressView();
  const ink = railInk(band.number);
  const open = band.lane === null;
  if (band.goals.length === 0 && open) return null;
  return (
    <div
      {...(band.lane ? drop.propsFor(`strip:${band.key}`, band.lane.id) : {})}
      className={`bb-grp ${open ? 'is-open' : ''} ${drop.overKey === `strip:${band.key}` ? 'is-over' : ''}`}
      style={{ '--h': ink } as CSSProperties}
    >
      <span className="bb-gt" aria-hidden="true">
        <Hex ink={ink} size={21} dashed={open}>
          <span className="bb-mono typo-data">{open ? '' : band.number}</span>
        </Hex>
      </span>
      {band.goals.map(({ node, sub }) => {
        const done = isComplete(node.goal.status);
        return (
          <span
            key={node.goal.id}
            data-busbar-cell={node.goal.id}
            className={`bb-cell ${sub ? 'is-sub' : ''} ${draggingId === node.goal.id ? 'opacity-40' : ''}`}
            draggable
            onDragStart={(e) => canvas.drag.onDragStart(e, node.goal.id)}
            onDragEnd={canvas.drag.onDragEnd}
            aria-hidden="true"
          >
            <span className="bb-cell-pin" />
            <Hex ink={statusInk(node.goal.status)} size={sub ? 15 : 24} fill={done ? 0.5 : 0.16} />
          </span>
        );
      })}
    </div>
  );
}
