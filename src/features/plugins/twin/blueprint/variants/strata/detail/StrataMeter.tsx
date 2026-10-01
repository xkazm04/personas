/**
 * L2 building blocks. `StrataMeter` is a bar on a DECLARED domain (`fullAt`):
 * a solid share, an optional hatched "awaiting" share after it, an overflow
 * mark past the end; `null` draws the hatched not-measured track, never an
 * empty one. `PressRow` is one L2 item that opens L3: the whole row is the
 * control (Tab, Enter/Space), named by `label`.
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { clamp01 } from '../strataModel';

interface StrataMeterProps {
  value: number | null;
  fullAt: number;
  /** A hatched share drawn after the solid one (awaiting review). */
  extra?: number;
  dashed?: boolean;
  className?: string;
}

export function StrataMeter({ value, fullAt, extra = 0, dashed, className }: StrataMeterProps) {
  if (value === null) {
    return <span className={`strata-meter is-unmeasured ${className ?? ''}`} data-measured="false" aria-hidden />;
  }
  const solid = clamp01(value / fullAt);
  const withExtra = clamp01((value + extra) / fullAt);
  const style = { '--solid': solid, '--extra': withExtra - solid } as CSSProperties;
  return (
    <span
      className={`strata-meter ${dashed ? 'is-dashed' : ''} ${className ?? ''}`}
      style={style}
      data-measured="true"
      data-overflow={value > fullAt ? 'true' : undefined}
      aria-hidden
    >
      <span className="strata-meter-solid" />
      {withExtra > solid && <span className="strata-meter-extra" />}
    </span>
  );
}

interface PressRowProps {
  label: string;
  onPress: () => void;
  className?: string;
  testId?: string;
  children: ReactNode;
}

export function PressRow({ label, onPress, className, testId, children }: PressRowProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      className={`strata-row focus-ring ${className ?? ''}`}
      onClick={onPress}
      onKeyDown={onKeyDown}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
