/**
 * The control laid over a history drawing: ONE listbox whose options are the
 * Measures, each option a whole column of the drawing (every row under it and
 * its axis label), so a press anywhere in a column picks that Measure. The
 * rows passed as children are drawn parts; this is what a reader hears.
 *
 * - The PLAYHEAD is the band behind the picked column. On the newest Measure
 *   (now) it is a quiet band; on a past one it is a ringed band, and it
 *   slides between columns (a shared layout id) so travel reads as movement.
 * - The keyboard: one tab stop. Left / Right / Home / End move the cursor (and,
 *   while a past Measure is picked, the pick with it); Enter or Space picks
 *   the cursor's Measure; Esc, when the caller can clear, returns to now. The
 *   keys it uses are marked handled, so Layer 2's own Left / Right walk and
 *   Esc do not also fire.
 * - The PEEK (`ColumnPeek`) shows the column under the pointer, or the
 *   cursor's column while the listbox has keyboard focus.
 */
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';

import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';

import { lcShape } from '../../system/lcSurface';
import { HIST_ROW_GAP, plotStyle } from '../historyGeometry';
import { Axis } from './Axis';
import { ColumnPeek } from './ColumnPeek';
import { useColumnLabel } from './useColumnLabel';

interface ColumnPickerProps {
  columns: LifecycleMeasureColumn[];
  /** The picked column: the viewed Measure, or the newest one for now. */
  at: number;
  onPick: (index: number) => void;
  /** Back to now (Esc); absent where Esc belongs to the surface. */
  onClear?: () => void;
  label: string;
  stepIds: string[];
  /** Prefix of each column's test id (`<prefix>-col-<i>`, oldest = 0). */
  testId: string;
  children: ReactNode;
}

/** Whether focus arrived by keyboard (`:focus-visible`); a DOM that cannot answer counts it as keyboard. */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export function ColumnPicker({ columns, at, onPick, onClear, label, stepIds, testId, children }: ColumnPickerProps) {
  const base = useId();
  const n = columns.length;
  const newest = n - 1;
  const travelling = at !== newest;
  const [cursor, setCursor] = useState(at);
  const [keyboard, setKeyboard] = useState(false);
  const [hover, setHover] = useState<{ i: number; rect: DOMRect } | null>(null);
  const optionLabel = useColumnLabel(stepIds);

  useEffect(() => { if (travelling) setCursor(at); }, [at, travelling]);
  const cur = Math.min(Math.max(0, cursor), newest);

  const move = (to: number) => {
    const i = Math.min(Math.max(0, to), newest);
    setCursor(i);
    if (travelling) onPick(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(cur - 1),
      ArrowRight: () => move(cur + 1),
      Home: () => move(0),
      End: () => move(newest),
      Enter: () => onPick(cur),
      ' ': () => onPick(cur),
    };
    if (onClear && travelling) keys.Escape = onClear;
    const act = keys[e.key];
    if (!act || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    act();
  };

  const peekIndex = hover?.i ?? (keyboard ? cur : null);
  const peekEl = peekIndex != null ? document.getElementById(`${base}-${peekIndex}`) : null;
  const anchor = hover?.rect ?? (peekEl ? peekEl.getBoundingClientRect() : null);

  return (
    <div
      role="listbox"
      aria-label={label}
      aria-orientation="horizontal"
      aria-activedescendant={`${base}-${cur}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={(e) => setKeyboard(keyboardFocus(e.currentTarget))}
      onBlur={() => setKeyboard(false)}
      className="relative isolate w-full outline-none"
      style={{ maxWidth: plotStyle(n).maxWidth }}
      data-testid={`${testId}-picker`}
      data-travelling={travelling || undefined}
    >
      <div aria-hidden className="absolute inset-0 -z-10 grid" style={plotStyle(n)}>
        {columns.map((c, i) => (
          <span key={c.measureId} className="relative">
            {i === at && (
              <motion.span
                layoutId={`${testId}-playhead`}
                className={`absolute -inset-y-1 inset-x-0 ${lcShape('card')} ${travelling ? 'bg-primary/15 ring-2 ring-primary/55' : 'bg-primary/8'}`}
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                data-playhead={travelling ? 'past' : 'now'}
              />
            )}
          </span>
        ))}
      </div>
      <div className={`flex flex-col ${HIST_ROW_GAP}`}>{children}</div>
      <Axis columns={columns} at={at} />
      <div className="absolute inset-0 z-10 grid" style={plotStyle(n)}>
        {columns.map((c, i) => (
          <div
            key={c.measureId}
            id={`${base}-${i}`}
            role="option"
            aria-selected={i === at}
            aria-label={optionLabel(c, i === newest)}
            onClick={() => { setCursor(i); onPick(i); }}
            onPointerEnter={(e) => setHover({ i, rect: e.currentTarget.getBoundingClientRect() })}
            onPointerLeave={() => setHover(null)}
            className={`-my-1 cursor-pointer ${lcShape('card')} transition-colors duration-150 hover:bg-primary/6 motion-reduce:transition-none ${keyboard && i === cur ? 'ring-2 ring-primary/70' : ''}`}
            data-testid={`${testId}-col-${i}`}
            data-measure={c.measureId}
          />
        ))}
      </div>
      <AnchoredTooltip
        anchor={anchor}
        content={peekIndex != null && columns[peekIndex] ? <ColumnPeek column={columns[peekIndex]!} stepIds={stepIds} now={peekIndex === newest} /> : null}
        placement="top"
      />
    </div>
  );
}
