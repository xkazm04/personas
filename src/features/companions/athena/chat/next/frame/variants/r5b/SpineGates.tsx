/**
 * Gates on the time spine. A gate is the one thing the eye must find from
 * across the room, so it is carried by SHAPE as well as colour: a notched tab
 * that breaks the instrument's left edge at the moment the gate opened, an arm
 * from that edge to the lane it blocks, and a pivot on the lane. On the board
 * the tab gives way to a labelled key beside the lane that says what it waits
 * for. Either one opens the gate's decision.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { R5B_COPY as C } from './copy';
import { spread, type Geometry } from './spineGeometry';
import { depth, minutesAgo, type Lane, type Mark } from './timeModel';

interface Placed { mark: Mark; lane: Lane; x: number; y: number }

export function SpineGates({
  geom,
  now,
  focusId,
  onOpen,
}: {
  geom: Geometry;
  now: number;
  focusId: string | null;
  onOpen: (mark: Mark, lane: Lane) => void;
}) {
  const board = geom.mode === 'board';
  const placed: Placed[] = geom.shown.flatMap((lane, i) =>
    lane.marks.filter((m) => m.gate).map((mark) => ({ mark, lane, x: geom.xs[i] ?? 0, y: depth(now, mark.at) * geom.axis })),
  );
  // Slim: every tab shares the one edge, so they keep clear of each other
  // across lanes. Board: each lane's keys stack in that lane's own column.
  const rows = board
    ? geom.shown.flatMap((lane) => spread(placed.filter((p) => p.lane.id === lane.id), 30, geom.axis - 16))
    : spread(placed, 15, geom.axis - 6);

  return (
    <>
      {rows.map(({ mark, lane, x, y }) => {
        const label = C.gateKind[mark.kind];
        const who = lane.project === null ? C.athena : lane.name;
        const age = C.ago(minutesAgo(now, mark.at));
        const focused = mark.id === focusId;
        return (
          <div key={mark.id}>
            <span className="r5b-arm" style={board ? { top: y, left: x, width: 12 } : { top: y, left: 0, width: x }} aria-hidden />
            <span className="r5b-pivot" style={{ top: y, left: x }} aria-hidden />
            {board ? (
              <div className="absolute" style={{ top: y - 14, left: x + 12, maxWidth: geom.col - 26 }}>
                <Button
                  variant="accent"
                  tone="warning"
                  size="xs"
                  onClick={() => onOpen(mark, lane)}
                  aria-label={`${label}: ${who}, ${age}`}
                  data-testid={`companion-r5b-gate-${mark.id}`}
                  className="!rounded-interactive whitespace-nowrap"
                >
                  <span className="r5b-glyph shrink-0" aria-hidden />
                  <span className="typo-label">{label}</span>
                </Button>
              </div>
            ) : (
              <div className="absolute -translate-y-1/2" style={{ top: y, left: focused ? -17 : -13 }}>
                <Tooltip content={`${label} · ${who} · ${age}`} placement="left">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => onOpen(mark, lane)}
                    aria-label={`${label}: ${who}, ${age}`}
                    data-testid={`companion-r5b-gate-${mark.id}`}
                    className="!p-0.5 !-m-0.5 !bg-transparent"
                  >
                    <span className={`r5b-tab block${focused ? ' focus' : ''}`} aria-hidden />
                  </Button>
                </Tooltip>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
