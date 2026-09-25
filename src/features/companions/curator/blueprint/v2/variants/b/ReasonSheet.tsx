/**
 * THE DESCENT: one measure resolving into nine.
 *
 * The row above states a dominant reason and a weight. This is what that
 * withheld - and it is drawn so that nothing the row said moves. The strip at
 * the top of the sheet is the SAME strip the row draws, at the same scale and
 * in the same order, with the row's grey remainder split into the real
 * channels it was standing in for. The dominant segment is first in both,
 * because the list below is in the registry's own dominance order. So the
 * transition is a split, never a swap: the reader can see that the resting
 * state summarised rather than hid.
 *
 * Then the nine, all of them, always, each in its own ink. Six that can score
 * in this corpus, and three that measure zero across all 471 subjects - which
 * this sheet states as a measured zero, not as an omission.
 */
import type { CSSProperties } from 'react';

import { Dot, KeyValueGrid, Section, UnitStrip, type UnitSegment } from '@/features/shared/components/kit';

import type { BlueprintRow } from '../../../model/types';
import { useWords } from '../../../words';
import { AbsentFact, Fact, inkOfCell } from './facts';
import { dominantOf, NINE, pointsOf, QUANTUM, scoredOf, type Reason } from './reasons';
import { carries, EN, scoreOfNine } from './strings';

/** The nine names, as the shipped page says them. */
function nameOf(w: ReturnType<typeof useWords>['w'], reason: Reason): string {
  return w.channel[`c${String(reason.channel)}` as keyof typeof w.channel];
}

/** The strip the row draws, resolved: one segment per scoring channel. */
export function resolvedSegments(row: BlueprintRow): UnitSegment[] {
  return scoredOf(row).map(({ reason, points }) => ({ n: points / QUANTUM, tone: reason.tone }));
}

/** The strip at rest: the dominant, then everything else unnamed. */
export function restingSegments(row: BlueprintRow): UnitSegment[] {
  const dominant = dominantOf(row);
  const lead = dominant ? pointsOf(dominant.cell) : 0;
  const rest = row.points - lead;
  const segments: UnitSegment[] = [{ n: lead / QUANTUM, tone: dominant?.reason.tone ?? 'neutral' }];
  if (rest > 0) segments.push({ n: rest / QUANTUM, tone: 'neutral', glyph: 'hollow' });
  return segments;
}

function Line({ row, reason, dominant, index }: { row: BlueprintRow; reason: Reason; dominant: boolean; index: number }) {
  const { w, tx } = useWords();
  const cell = row.cells[reason.channel];
  const ink = inkOfCell(cell);
  const name = nameOf(w, reason);
  const weight = reason.spec.multiplied ? tx(w.weight_each, { n: reason.spec.weight }) : String(reason.spec.weight);
  return (
    <div
      className={`v2b-nine__line${dominant ? ' is-dominant' : ''}`}
      data-ink={ink}
      style={{ '--i': index } as CSSProperties}
    >
      <span className="v2b-nine__name typo-body">
        <Dot tone={reason.tone} glyph={ink === 'value' ? 'solid' : 'hollow'} />
        <span className="k-ellipsis">{name}</span>
        <span className="typo-caption k-quiet k-nowrap">{weight}</span>
      </span>
      <span className="v2b-nine__say typo-caption">
        <span className="k-ellipsis">
          {cell.kind === 'scored'
          ? cell.mark.detail
          : cell.kind === 'unknown'
            ? tx(w.cell_unknown, { name, domain: row.domain })
            : cell.kind === 'unmeasurable'
              ? tx(w.cell_unmeasurable, { name })
              : tx(w.cell_measured_zero, { name })}
        </span>
        {dominant && <span className="v2b-nine__tag typo-label k-regular">{EN.onTheRow}</span>}
      </span>
      <span className="v2b-nine__fig">
        {cell.kind === 'scored' ? (
          <Fact kind="value" label={tx(w.cell_scored, { detail: cell.mark.detail, points: cell.mark.points })}>
            {cell.mark.points}
          </Fact>
        ) : (
          <AbsentFact kind={ink === 'value' ? 'none' : ink} />
        )}
      </span>
    </div>
  );
}

export function ReasonSheet({ row, total, id }: { row: BlueprintRow; total: number; id: string }) {
  const { w, tx } = useWords();
  const dominant = dominantOf(row);
  const lead = dominant ? pointsOf(dominant.cell) : 0;
  const scored = scoredOf(row);
  const leadName = dominant ? nameOf(w, dominant.reason) : w.not_measured;
  return (
    <div className="v2b-sheet" id={id}>
      <Section
        level={2}
        eyebrow={scoreOfNine(scored.length)}
        title={<span className="k-ellipsis">{row.slug}</span>}
        meta={<span>{carries(leadName, lead, row.points)}</span>}
      >
        <div className="v2b-sheet__strip">
          <UnitStrip
            segments={resolvedSegments(row)}
            size="m"
            label={tx(w.row_total_tip, { points: row.points, total: row.points })}
          />
          <span className="typo-caption k-quiet">
            {row.points} {tx(w.deep_points_rank, { rank: row.rank, total })}
          </span>
        </div>
        <div className="v2b-nine">
          {NINE.map((reason, i) => (
            <Line
              key={reason.code}
              row={row}
              reason={reason}
              index={i}
              dominant={reason.code === dominant?.reason.code}
            />
          ))}
        </div>
        <div className="v2b-sheet__facts">
          <KeyValueGrid
            min="112px"
            items={[
              { k: w.side_techniques, v: row.techniques },
              { k: w.side_applications, v: row.applications },
              { k: w.side_stacks, v: row.stacks.length > 0 ? row.stacks.join(', ') : null, none: w.side_none },
              { k: w.side_last_swept, v: row.lastSwept, none: w.side_never },
              { k: w.deep_engine, v: w.engine[row.engine] },
            ]}
          />
        </div>
      </Section>
    </div>
  );
}
