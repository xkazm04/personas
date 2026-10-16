/**
 * The Lens field: the practice's steps as columns of lit cells, the same
 * object on every plane. On the portfolio a cell is a project's verdict at
 * the step; on a project it is one change's outcome there.
 *
 * - One column is LIT (the step under attention): the lens light, a little
 *   wider, its watermark icon behind the cells. It never opens a panel over
 *   the strip; opening is a move to the next plane (owner, 2026-10-16).
 * - A click on a cell opens what the cell is (a project, a step's detail).
 *   A click on a column selects it; on the lit one it opens it.
 * - Pointing writes the shared pointer (`lensPointer`): the header's readout
 *   line says what is under it, and a project's cells outline in every column.
 *
 * Keyboard lives with the page (`useLensKeys`); the columns are options of one
 * listbox, the lit one `aria-selected`.
 */
import { memo, useCallback, type CSSProperties, type ReactNode } from 'react';

import { StepIcon } from '../art/StepIcon';
import { useLensPointer, useProjectHighlighted, type LensPointer } from './lensPointer';

export interface FieldCell {
  key: string;
  /** A verdict (`red`, `green`, ...), an outcome (`done`, `skipped`, ...) or `none` for an empty slot. */
  tone: string;
  /** The project a portfolio cell stands for; its cells outline together. */
  projectId?: string;
  pointer: LensPointer | null;
  label: string;
}

export interface FieldColumn {
  id: string;
  name: string;
  phase: 'before' | 'after';
  lit: boolean;
  fault: boolean;
  foot: { text: string; tone: string };
  /** Bottom first. */
  cells: FieldCell[];
  label: string;
  /** A mark after the step's name (the Overseer's, when he owes an item on it). */
  badge?: ReactNode;
  /** A running Measure is measuring this step (its verdict is held); or the one that ended changed it. */
  measure?: 'measuring' | 'settled';
}

const Cell = memo(function Cell({ cell, col, row, cursor, onOpen }: {
  cell: FieldCell;
  col: number;
  row: number;
  cursor: boolean;
  onOpen: (cell: FieldCell) => void;
}) {
  const lit = useProjectHighlighted(cell.projectId);
  const setHover = useLensPointer((s) => s.setHover);
  const style = { '--c': col, '--r': row } as CSSProperties;
  return (
    <span
      className={`lens-cell is-${cell.tone}${lit ? ' is-hl' : ''}${cursor ? ' is-cursor' : ''}`}
      style={style}
      aria-label={cell.label}
      onMouseEnter={cell.pointer ? () => setHover(cell.pointer) : undefined}
      onClick={cell.pointer ? (e) => { e.stopPropagation(); onOpen(cell); } : undefined}
      data-testid={`lens-cell-${cell.key}`}
    />
  );
});

/** A rest on a column (pointer or focus) and its end: the project plane warms that step's screen. */
export interface FieldIntent {
  start: (stepId: string) => void;
  end: () => void;
}

const Column = memo(function Column({ column, index, cursor, onSelect, onOpenColumn, onOpenCell, intent }: {
  column: FieldColumn;
  index: number;
  cursor: number;
  onSelect: (id: string) => void;
  onOpenColumn: (id: string) => void;
  onOpenCell: (stepId: string, cell: FieldCell) => void;
  intent?: FieldIntent;
}) {
  const setHover = useLensPointer((s) => s.setHover);
  const openCell = useCallback((cell: FieldCell) => onOpenCell(column.id, cell), [onOpenCell, column.id]);
  const cls = `lens-col${column.lit ? ' is-lit' : ''}${column.fault ? ' is-fault' : ''}`;
  return (
    <div
      className={cls}
      role="option"
      aria-selected={column.lit}
      aria-label={column.label}
      tabIndex={column.lit ? 0 : -1}
      id={`lens-col-${column.id}`}
      data-testid={`lens-col-${column.id}`}
      data-measuring={column.measure === 'measuring' || undefined}
      data-settle={column.measure === 'settled' || undefined}
      onMouseEnter={() => { setHover({ kind: 'step', stepId: column.id }); intent?.start(column.id); }}
      onMouseLeave={intent?.end}
      onFocus={intent ? () => intent.start(column.id) : undefined}
      onBlur={intent?.end}
      onClick={() => (column.lit ? onOpenColumn(column.id) : onSelect(column.id))}
    >
      {column.lit && <StepIcon stepId={column.id} className="lens-watermark" strokeWidth={0.7} />}
      <span className="lens-col-head">
        <span className="lens-disc"><StepIcon stepId={column.id} /></span>
        <span className="lens-col-name typo-label">{column.name}{column.badge}</span>
      </span>
      <span className="lens-bar">
        {column.cells.map((c, r) => (
          <Cell
            key={c.key}
            cell={c}
            col={index}
            row={r}
            cursor={cursor === r}
            onOpen={openCell}
          />
        ))}
      </span>
      <span className={`lens-foot typo-label is-${column.foot.tone}`}>{column.foot.text}</span>
    </div>
  );
});

export const Field = memo(function Field({ columns, intro, label, lanes, onSelect, onOpenColumn, onOpenCell, intent, testId = 'lens-field' }: {
  columns: FieldColumn[];
  intro: boolean;
  label: string;
  lanes: { before: string; after: string };
  onSelect: (id: string) => void;
  onOpenColumn: (id: string) => void;
  onOpenCell: (stepId: string, cell: FieldCell) => void;
  intent?: FieldIntent;
  testId?: string;
}) {
  const cursor = useLensPointer((s) => s.cursor);
  const setHover = useLensPointer((s) => s.setHover);
  const firstAfter = columns.findIndex((c) => c.phase === 'after');
  const grow = (phase: 'before' | 'after') =>
    columns.filter((c) => c.phase === phase).reduce((n, c) => n + (c.lit ? 1.6 : 1), 0);
  return (
    <>
      <div className="lens-lanes" aria-hidden>
        <div className="lens-lane typo-label" style={{ flexGrow: grow('before') }}>{lanes.before}</div>
        <div className="lens-lane typo-label" style={{ flexGrow: grow('after') }}>{lanes.after}</div>
      </div>
      <div
        className={`lens-field${intro ? ' is-intro' : ''}`}
        role="listbox"
        aria-label={label}
        aria-orientation="horizontal"
        onMouseLeave={() => setHover(null)}
        data-testid={testId}
      >
        {columns.map((c, i) => (
          <ColumnSlot key={c.id} gapBefore={i === firstAfter && i > 0}>
            <Column
              column={c}
              index={i}
              cursor={c.lit ? cursor : -1}
              onSelect={onSelect}
              onOpenColumn={onOpenColumn}
              onOpenCell={onOpenCell}
              intent={intent}
            />
          </ColumnSlot>
        ))}
      </div>
    </>
  );
});

function ColumnSlot({ gapBefore, children }: { gapBefore: boolean; children: ReactNode }) {
  return (
    <>
      {gapBefore && <div className="lens-gap" aria-hidden />}
      {children}
    </>
  );
}
