import { BreakMark, Unmeasured } from './Lettering';
import { TALLY_GATE, tallyGates } from './draftingTwinModel';
import Write, { WriteNumber } from './draw/Write';

export type TallyKind = 'approved' | 'awaiting' | 'rejected';

const GATE_W = 30;
const STROKE_GAP = 5;
/** Crosses need more room than strokes to read as crosses. */
const CROSS_GAP = 5;
const H = 22;

/**
 * A count as tally marks, gates of five: approved memories in solid ink,
 * those awaiting review in dashed pencil (still pending), rejected ones as
 * crosses. One gate is exactly the readiness target for memories, so the
 * first gate closing is the section drawn in full. A count past the row's
 * capacity draws every gate and a break mark; `null` is hatched, never a 0.
 *
 * In the draw-in the row is a container: each gate is ruled first (a faint
 * construction line under it, a frame), then the label and the count are
 * lettered and the strokes are struck one by one, the fifth across the gate.
 */
export default function TallyRow({
  label,
  count,
  kind,
  gates,
  large = false,
  notMeasured,
}: {
  label: string;
  count: number | null;
  kind: TallyKind;
  /** Full gates drawn before the row breaks. */
  gates: number;
  large?: boolean;
  notMeasured: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-tally={kind} data-measured={count === null ? 'false' : 'true'} data-draw-scope="">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate typo-body text-foreground">
          <Write text={label} />
        </span>
        {count === null ? (
          <span className="typo-caption">
            <Write text={notMeasured} />
          </span>
        ) : (
          <WriteNumber value={count} className={`${large ? 'typo-data-lg' : 'typo-data'} text-foreground`} />
        )}
      </div>
      {count === null ? (
        <Unmeasured style={{ height: H - 8, width: gates * GATE_W }} className="max-w-full" />
      ) : (
        <Marks count={count} kind={kind} gates={gates} />
      )}
    </div>
  );
}

function Marks({ count, kind, gates }: { count: number; kind: TallyKind; gates: number }) {
  const { strokes, broken } = tallyGates(count, gates);
  const width = Math.max(1, strokes.length) * GATE_W;
  const stroke = kind === 'approved' ? 'var(--ink-strong)' : 'var(--ink)';
  // A dashed stroke cannot trace (its dash is its pattern): it is struck whole at its moment.
  const strike = kind === 'awaiting' ? 'mark' : 'tick';
  const dash = kind === 'awaiting' ? '3 2.5' : undefined;
  return (
    <span className="flex items-center gap-1">
      <svg aria-hidden width={width} height={H} className="shrink-0 overflow-visible">
        {count === 0 && <line x1={0} y1={H - 2} x2={GATE_W - 8} y2={H - 2} stroke="var(--ink-dim)" strokeDasharray="3 3" data-draw="mark" />}
        {strokes.map((_, g) => (
          <line key={`gate${g}`} x1={g * GATE_W} y1={H} x2={g * GATE_W + GATE_W - 6} y2={H} stroke="var(--ink-faint)" strokeWidth={1} pathLength={100} data-draw="frame" />
        ))}
        {strokes.map((n, g) => {
          const x0 = g * GATE_W + 2;
          if (kind === 'rejected') {
            return Array.from({ length: n }, (_, i) => {
              const x = x0 + 1 + i * CROSS_GAP;
              return (
                <path
                  key={`${g}-${i}`}
                  d={`M${x - 2.5} ${H / 2 - 5} L${x + 2.5} ${H / 2 + 5} M${x + 2.5} ${H / 2 - 5} L${x - 2.5} ${H / 2 + 5}`}
                  stroke={stroke}
                  strokeWidth={1.6}
                  pathLength={100}
                  data-draw="tick"
                />
              );
            });
          }
          const verticals = Math.min(n, TALLY_GATE - 1);
          return (
            <g key={g}>
              {Array.from({ length: verticals }, (_, i) => (
                <line
                  key={i}
                  x1={x0 + i * STROKE_GAP}
                  y1={2}
                  x2={x0 + i * STROKE_GAP}
                  y2={H - 2}
                  stroke={stroke}
                  strokeWidth={1.6}
                  strokeDasharray={dash}
                  pathLength={dash ? undefined : 100}
                  data-draw={strike}
                />
              ))}
              {n === TALLY_GATE && (
                <line
                  x1={x0 - 3}
                  y1={H - 4}
                  x2={x0 + 3 * STROKE_GAP + 3}
                  y2={4}
                  stroke={stroke}
                  strokeWidth={1.6}
                  strokeDasharray={dash}
                  pathLength={dash ? undefined : 100}
                  data-draw={strike}
                />
              )}
            </g>
          );
        })}
      </svg>
      {broken && <BreakMark height={H} />}
    </span>
  );
}
