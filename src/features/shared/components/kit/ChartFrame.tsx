import type { CSSProperties, ReactNode } from 'react';
import { emptyBand, Ghost, type EmptySpec } from './states';
import { cx, kitAttrs, stateClass, type KitState, type Tone } from './types';

/**
 * ChartFrame: the plot area of a chart inside a Section. It starts on the reading line, holds a
 * fixed height so a loading or empty chart keeps the chart's geometry, and renders the kit's
 * ghost or empty band in its place. The chart itself (recharts or SVG) is the caller's child;
 * its colours come from `toneColor`, so a series reads in the same tones as the marks.
 * @catalog ChartFrame - a chart's plot area on the reading line, fixed height, with its loading ghost and empty band. Kit.
 */
export function ChartFrame({ height, label, state, empty, children }: {
  height: number;
  /** Accessible name of the figure. */
  label: string;
  state?: KitState;
  empty?: EmptySpec;
  children: ReactNode;
}) {
  const st: KitState = state ?? 'default';
  const style = { '--chart-h': `${height}px` } as CSSProperties;
  return (
    <figure className={cx('k-chart', stateClass(st))} {...kitAttrs('ChartFrame', st)} aria-label={label} aria-busy={st === 'loading' || undefined} style={style}>
      {st === 'loading'
        ? <Ghost width="100%" height={`${height}px`} />
        : st === 'empty'
          ? emptyBand(empty ?? { title: '' })
          : <div className="k-chart__plot">{children}</div>}
    </figure>
  );
}

const TONE_VAR: Record<Tone, string> = {
  primary: 'var(--primary)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  error: 'var(--status-error)',
  info: 'var(--status-info)',
  neutral: 'var(--status-neutral)',
  pending: 'var(--status-pending)',
  agent: 'var(--role-agent)',
  human: 'var(--role-human)',
  external: 'var(--role-external)',
  highlight: 'var(--role-highlight)',
};

/** The CSS colour of a Tone, for chart series and SVG strokes (the same variable a Mark reads). */
export function toneColor(tone: Tone): string {
  return TONE_VAR[tone];
}
