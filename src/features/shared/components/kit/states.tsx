import type { CSSProperties, ReactNode } from 'react';
import { Mark } from './Mark';
import type { Tone } from './types';

export interface EmptySpec {
  title: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  action?: ReactNode;
  /** Accessible name of the mark; defaults to the title when it is a string. */
  markLabel?: string;
  testId?: string;
}

/**
 * The empty state every composition renders (API.md: empty and loading are states of a part, not
 * parts). A hollow mark on the spine and a dashed band that starts where the rows do, so an empty
 * list keeps the list's geometry. A render helper, not a component: callers reach it through a
 * composition's `state="empty"` / `empty` prop.
 */
export function emptyBand({ title, hint, tone = 'neutral', action, markLabel, testId }: EmptySpec): ReactNode {
  return (
    <div className="k-empty" data-empty="1" data-testid={testId}>
      <Mark tone={tone} glyph="hollow" label={markLabel ?? (typeof title === 'string' ? title : '')} />
      <div className="k-empty__text">
        <span className="typo-body k-strong">{title}</span>
        {hint && <span className="typo-caption">{hint}</span>}
      </div>
      {action}
    </div>
  );
}

/** A ghost bar; width and height are the only things a caller varies. */
export function Ghost({ width, height, inline }: { width: string; height?: string; inline?: boolean }) {
  const style: CSSProperties = { width, ...(height ? { height } : null), ...(inline ? { display: 'inline-block' } : null) };
  return <span className="k-ghost" style={style} />;
}

const WIDTHS = [58, 44, 66, 38, 52];

/** Loading rows at the list's own height: a ghost under the chrome, never a spinner. */
export function GhostRows({ count = 3, size = 'm', label }: { count?: number; size?: 's' | 'm' | 'l'; label?: string }) {
  return (
    <div className="k-rows" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`k-row k-row--${size} is-loading`} aria-hidden="true">
          <span className="k-mark g-solid" style={{ '--tone': 'var(--ghost)' } as CSSProperties} />
          <div className="k-row__main" style={{ gap: 8 }}>
            <Ghost width={`${WIDTHS[i % 5]}%`} />
            <Ghost width={`${WIDTHS[(i + 2) % 5]! / 2}%`} height="8px" />
          </div>
          <div className="k-row__trail">
            <Ghost width="72px" />
            <Ghost width="28px" />
          </div>
        </div>
      ))}
    </div>
  );
}
