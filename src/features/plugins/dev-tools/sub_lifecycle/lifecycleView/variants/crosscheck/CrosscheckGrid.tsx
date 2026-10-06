/**
 * The crosscheck figure: the practice as a RECORD. Steps are rows in journey
 * order, the last twenty changes are columns oldest-to-newest, and a cell is
 * that change's outcome for that step. Nothing is hidden behind a selection -
 * the whole snapshot is one rectangle, so a hole in the practice is a visible
 * gap in a column and a step nobody observes is a pale row.
 *
 * This is a FIGURE, not a kit surface (doctrine 6c): replacing it with a
 * labelled list of the same numbers loses the alignment, and the alignment is
 * the point. Its furniture - the plate, the section heads, the legend, the
 * ledger below - is ordinary chrome and is not hand-rolled.
 *
 * Each row carries its own denominator (`kept / observed`) at the right edge, on
 * the figure, where the eye already is. `observed` excludes `unknown`, so the
 * ratio never claims a step held when no change looked at it.
 *
 * A row is the selection control, with one tab stop for the whole grid and the
 * shared roving model walking it vertically; the cells are `aria-hidden` because
 * the ledger below is the accessible record and a 220-cell alt text is not one.
 */
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { bindingStateLabel, stepGlyph, stepLabel } from '../../../journey/journeyLabels';
import { STATE_CHIP, STATE_TEXT } from '../../../journey/journeyStyles';
import { useLifecycleViewModel } from '../../context';
import { useStepRoving } from '../../blocks/useStepRoving';
import type { CrosscheckMatrix, CrosscheckRow } from './crosscheck.model';

/** label | the record | the ratio. One template for the head and every row. */
const COLS = 'grid grid-cols-[9.5rem_1fr_4rem] items-center gap-x-3';
/** A cell: tall enough that a column reads as a column, narrow enough for twenty. */
const CELL = 'w-2.5 h-4 rounded-interactive shrink-0';

const OUTCOME_CELL = {
  done: 'bg-status-success/75',
  skipped: 'bg-foreground/25',
  unknown: 'bg-foreground/[0.07]',
  failed: 'bg-status-error/80',
} as const;

export function CrosscheckGrid({ matrix }: { matrix: CrosscheckMatrix }) {
  const { dl, t, tx, order, selected, select } = useLifecycleViewModel();
  const { activeIndex, bind, onKeyDown } = useStepRoving(order, selected?.id ?? null, select);

  const renderRow = (row: CrosscheckRow, index: number) => {
    const label = stepLabel(dl, row.node.id, row.node.label);
    const Glyph = stepGlyph(row.node.id);
    const state = row.node.strongestState;
    const on = row.node.id === selected?.id;
    const tally = tx(dl.lc_detail_tally, {
      done: row.node.tally.done, skipped: row.node.tally.skipped,
      unknown: row.node.tally.unknown, failed: row.node.tally.failed,
    });
    return (
      <Button
        key={row.node.id}
        ref={bind(index)}
        variant="ghost"
        tabIndex={index === activeIndex ? 0 : -1}
        aria-pressed={on}
        onClick={() => select(row.node.id)}
        aria-label={`${tx(dl.lc_node_label, { step: label, state: bindingStateLabel(dl, state) })} ${tally}`}
        data-testid={`lc-node-${row.node.id}`}
        data-state={state}
        data-selected={on ? 'true' : undefined}
        className={`${COLS} w-full h-7 px-2 border-l-2 rounded-none ${
          on ? 'border-l-primary bg-primary/[0.07]' : 'border-l-transparent'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className={`shrink-0 w-3 h-3 rounded-interactive ${STATE_CHIP[state]}`} aria-hidden />
          <Glyph className={`w-3.5 h-3.5 shrink-0 ${STATE_TEXT[state]}`} aria-hidden />
          <span className={`typo-caption truncate ${on ? 'font-semibold text-primary' : 'text-foreground'}`}>
            {label}
          </span>
        </span>
        <span className="flex items-center gap-0.5 min-w-0 overflow-hidden" aria-hidden>
          {row.cells.map((outcome, i) => (
            <span
              key={matrix.columns[i]?.key ?? i}
              data-outcome={outcome}
              className={`${CELL} ${OUTCOME_CELL[outcome]}`}
            />
          ))}
        </span>
        <span className="typo-data text-foreground tabular-nums text-right">
          {row.observed === 0 ? '--' : `${row.kept}/${row.observed}`}
        </span>
      </Button>
    );
  };

  const renderLane = (title: string, lane: CrosscheckRow[], offset: number, testId: string) => (
    <div role="group" aria-label={title} data-testid={testId}>
      <div className={`${COLS} h-6 px-2 border-l-2 border-l-transparent`}>
        <span className="typo-eyebrow text-primary/80 truncate">{title}</span>
        <span />
        <span />
      </div>
      {lane.map((row, i) => renderRow(row, offset + i))}
    </div>
  );

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={dl.lc_journey_label}
      onKeyDown={onKeyDown}
      data-testid="lc-journey-track"
    >
      <div className={`${COLS} h-6 px-2 border-l-2 border-l-transparent border-b border-primary/15`}>
        <span />
        <Tooltip content={dl.lc_legend_evidence}>
          <span className="typo-eyebrow text-foreground">{dl.lc_detail_evidence}</span>
        </Tooltip>
        <span className="typo-eyebrow text-foreground text-right">{t.overview.cockpit.fact_outcome}</span>
      </div>
      {renderLane(dl.lc_lane_before, matrix.before, 0, 'lc-lane-before')}
      {renderLane(dl.lc_lane_after, matrix.after, matrix.before.length, 'lc-lane-after')}
    </div>
  );
}
