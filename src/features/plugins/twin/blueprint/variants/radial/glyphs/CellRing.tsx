/**
 * A band cut into cells, each filled outward from the inner edge by a 0..1
 * share on a declared domain: the six topics (approved solid, awaiting hatched
 * after it), the plan's goals, the readiness slots, the per-channel Voice
 * credit. `solid: null` is a hatched "not measured" cell; `dashed` is a cell
 * that exists but does not count (a dropped goal). `lit` lights a tick on top
 * of one cell's stack (the stage's instant delta).
 */
import { Chevrons, type RadialIds } from './primitives';
import { DEG_PER_PX } from './chevron';
import { type Band, arcPath, sectorPath } from '../radialGeometry';

export interface Cell {
  key: string;
  /** 0..1; `null` = not measured. */
  solid: number | null;
  /** A hatched share stacked after `solid` (awaiting review). */
  extra?: number;
  overflow?: boolean;
  dashed?: boolean;
}

interface CellRingProps {
  band: Band;
  cells: readonly Cell[];
  ids: RadialIds;
  /** Gap between cells, px at the band's middle radius. */
  gapPx?: number;
  hot?: string | null;
  lit?: string | null;
  onHot?: (key: string | null) => void;
  onPick?: (key: string) => void;
  testId?: string;
}

export function CellRing({ band, cells, ids, gapPx = 4, hot, lit, onHot, onPick, testId }: CellRingProps) {
  const { cx, cy, r0, r1, a0, a1 } = band;
  const n = cells.length;
  if (n === 0) return null;
  const mid = (r0 + r1) / 2;
  const step = (a1 - a0) / n;
  const gap = Math.min(step * 0.3, gapPx * DEG_PER_PX(mid));
  const depth = r1 - r0;

  return (
    <g data-testid={testId}>
      {cells.map((cell, i) => {
        const s0 = a0 + i * step + gap / 2;
        const s1 = s0 + step - gap;
        const measured = cell.solid !== null;
        const solid = cell.solid ?? 0;
        const extra = cell.extra ?? 0;
        const top = r0 + (solid + extra) * depth;
        const track = sectorPath(cx, cy, r0, r1, s0, s1);
        return (
          <g
            key={cell.key}
            className="rd-cell"
            data-key={cell.key}
            data-hot={hot === cell.key ? 'true' : undefined}
            data-measured={measured ? 'true' : 'false'}
            data-dashed={cell.dashed ? 'true' : undefined}
            onPointerEnter={onHot ? () => onHot(cell.key) : undefined}
            onPointerLeave={onHot ? () => onHot(null) : undefined}
            onClick={onPick ? () => onPick(cell.key) : undefined}
          >
            {measured ? (
              <path className={cell.dashed ? 'rd-track rd-dash' : 'rd-track'} d={track} />
            ) : (
              <>
                <path d={track} fill={`url(#${ids.hatch})`} />
                <path className="rd-dash" d={track} />
              </>
            )}
            {measured && !cell.dashed && solid > 0 && <path className="rd-fill" d={sectorPath(cx, cy, r0, r0 + solid * depth, s0, s1)} />}
            {measured && !cell.dashed && extra > 0 && (
              <path className="rd-await" fill={`url(#${ids.await})`} d={sectorPath(cx, cy, r0 + solid * depth, top, s0, s1)} />
            )}
            {measured && !cell.dashed && top > r0 && <path className="rd-cap" d={arcPath(cx, cy, top, s0, s1)} />}
            {cell.overflow && <Chevrons cx={cx} cy={cy} r={r1 + Math.min(7, depth / 4)} deg={(s0 + s1) / 2} size={Math.min(7, depth / 4)} dir="out" />}
            {lit === cell.key && <path className="rd-lit" data-testid="radial-lit" d={arcPath(cx, cy, Math.min(r1, top + 3), s0, s1)} />}
            <path className="rd-cell-outline" d={track} />
          </g>
        );
      })}
    </g>
  );
}
