/**
 * One milestone on the open sheet: the terminal block (number hex, name,
 * done / total and rail average, the plan / cut / ship ladder) and the rail
 * that leaves its right edge. The rail IS the progress bar - it is energised
 * up to the rail's average - and the goal cards hang from it in rows; a row
 * that does not fit hangs from a sub-rail on a riser, as in the winner.
 *
 * The whole band is the drop target for its milestone (the open bus for
 * `lane === null`), and the terminal is the right-click door to the shared
 * milestone menu. Clicking the terminal marks every goal on the rail.
 */
import { useRef, type CSSProperties } from 'react';

import { useElementSize } from '@/hooks/utility/interaction/useElementSize';
import { useTranslation } from '@/i18n/useTranslation';

import { useProgressView } from '../../canvasHost';
import { useMenuKey, type LaneDrop } from '../../rowCanvas';
import { railInk, type BusBand, type BusProject } from './busbarModel';
import { BusbarGoalCard } from './BusbarGoalCard';
import { Hex } from './busbarParts';
import type { BusbarState } from './useBusbarState';

const CARD_W = 232;
const CARD_GAP = 10;
const LADDER = ['planned', 'active', 'shipped'] as const;

export function BusbarBand({
  band,
  project,
  s,
  drop,
}: {
  band: BusBand;
  project: BusProject;
  s: BusbarState;
  drop: LaneDrop;
}) {
  const { tx } = useTranslation();
  const { canvas, dl } = useProgressView();
  const busRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(busRef);
  const lane = band.lane;
  const ink = railInk(band.number);
  const open = lane === null;
  const shipped = lane?.status === 'shipped';
  const fill = shipped ? 100 : band.avg;
  const { onKeyDown, onContextMenu } = useMenuKey((e) => {
    if (lane) canvas.openMenu(e, { kind: 'milestone', milestoneId: lane.id, name: lane.name });
  });

  const perRow = Math.max(1, Math.floor((Math.max(width, CARD_W) + CARD_GAP) / (CARD_W + CARD_GAP)));
  const rows: BusBand['goals'][] = [];
  for (let i = 0; i < band.goals.length; i += perRow) rows.push(band.goals.slice(i, i + perRow));

  const name = lane?.name ?? dl.busbar_open_bus;
  const where = open ? dl.busbar_no_milestone : tx(dl.busbar_rail_label, { index: band.number, name });
  const step = LADDER.indexOf((lane?.status ?? 'planned') as (typeof LADDER)[number]);
  const cls = [
    'bb-band',
    open && 'is-open',
    shipped && 'is-shipped',
    band.goals.length === 0 && 'is-empty',
    drop.overKey === band.key && 'is-over',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      {...drop.propsFor(band.key, lane?.id ?? null)}
      className={cls}
      style={{ '--h': ink } as CSSProperties}
      data-testid={open ? `busbar-open-bus-${project.row.projectId}` : `busbar-rail-${lane.id}`}
    >
      <span className="bb-rail" aria-hidden="true">
        {!open && (
          <>
            <span className={`bb-rail-on ${fill === 0 ? 'is-zero' : ''}`} style={{ width: `${fill}%` }} />
            {band.total > 0 && !shipped && (
              <span className="bb-rail-pct bb-mono typo-data tabular-nums" style={{ left: `${fill}%` }}>
                {band.avg}%
              </span>
            )}
          </>
        )}
      </span>

      <div
        className="bb-tb"
        role="button"
        tabIndex={0}
        aria-label={tx(dl.busbar_terminal_aria, { index: band.number, name, done: band.done, total: band.total })}
        onClick={() => s.markAll(band.goals.map((g) => g.node.goal.id))}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        <Hex ink={ink} size={30} dashed={open}>
          <span className="bb-mono typo-data">{open ? '-' : band.number}</span>
        </Hex>
        <div className="min-w-0">
          <div className={`typo-heading text-foreground ${open ? 'bb-mono uppercase' : ''} [overflow-wrap:anywhere]`}>
            {name}
          </div>
          {open && <div className="typo-caption">{dl.busbar_open_bus_sub}</div>}
          <div className="bb-mono typo-data text-foreground tabular-nums mt-0.5">
            {open ? (
              tx(dl.busbar_unwired_n, { count: band.total })
            ) : (
              <>
                {band.done}/{band.total}
                <span className="ml-2">{band.avg}%</span>
              </>
            )}
          </div>
          {lane && (
            <span className="bb-ladder bb-mono typo-data uppercase">
              {LADDER.map((st, i) => (
                <span key={st} className="contents">
                  {i > 0 && <i aria-hidden="true" />}
                  <span className={i === step ? 'on' : i < step ? 'past' : undefined}>
                    {st === 'planned' ? dl.busbar_state_planned : st === 'active' ? dl.busbar_state_cut : dl.busbar_state_shipped}
                  </span>
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      <div ref={busRef} className="bb-bus">
        {band.goals.length === 0 ? (
          !open && <span className="bb-dim bb-mono typo-data uppercase">
            {tx(dl.busbar_rail_empty, { key: band.number })}
          </span>
        ) : (
          rows.map((row, ri) => (
            <div key={ri} className="bb-brow">
              {row.map((g) => (
                <BusbarGoalCard
                  key={g.node.goal.id}
                  bus={g}
                  projectId={project.row.projectId}
                  ink={ink}
                  onOpenBus={open}
                  where={where}
                  isCursor={s.cursor === g.node.goal.id}
                  isMarked={s.marks.has(g.node.goal.id)}
                  flash={s.flash.get(g.node.goal.id)}
                  navTick={s.navTick}
                  onCursor={s.setCursor}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
