// Instrument — the shared vocabulary of the avionics variant: state hues, the
// luminous spine, bracketed labels, mono tags and the calm ghost. Every other
// Instrument file paints with these, so a hue can never mean two things.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import type { SquareState } from '../../fleetGridModel';
import type { PendingFact } from '../shared';

/** Fill class per persona state — spines, annunciator edges, cap cells. */
export const STATE_FILL: Record<SquareState, string> = {
  running: 'bg-primary',
  attention: 'bg-status-warning',
  failed: 'bg-status-error',
  idle: 'bg-foreground/20',
};

/** Text class per persona state — the mono state word. */
export const STATE_TEXT: Record<SquareState, string> = {
  running: 'text-primary',
  attention: 'text-status-warning',
  failed: 'text-status-error',
  idle: 'text-foreground',
};

/** The CSS variable behind each hue — for glows, which are inline styles. */
const STATE_VAR: Record<SquareState, string | null> = {
  running: 'var(--primary)',
  attention: 'var(--status-warning)',
  failed: 'var(--status-error)',
  idle: null,
};

/** A soft glow in a state's hue. Only live / alarming things glow. */
export function glow(state: SquareState, px = 8): CSSProperties | undefined {
  const v = STATE_VAR[state];
  return v ? { boxShadow: `0 0 ${px}px color-mix(in srgb, ${v} 70%, transparent)` } : undefined;
}

/** The lit edge an active control or plan wears. */
export const LIT_EDGE: CSSProperties = {
  boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--primary) 80%, transparent), 0 0 14px -6px var(--primary)',
};

export const PENDING_TONE: Record<PendingFact['tone'], string> = {
  error: 'border-status-error/40 text-status-error',
  warning: 'border-status-warning/40 text-status-warning',
  info: 'border-status-info/40 text-status-info',
  processing: 'border-primary/40 text-primary',
};

/** A short mono tag: `2 reviews`, `off`, `5h 24%`. */
export function MonoTag({ children, tone = 'border-primary/15 text-foreground', className = '' }: {
  children: ReactNode; tone?: string; className?: string;
}) {
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-interactive border px-1.5 typo-code ${tone} ${className}`}>
      {children}
    </span>
  );
}

/** The 2px luminous state spine on a cell's leading edge. */
export function Spine({ state, dotted = false, className }: { state: SquareState; dotted?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`absolute inset-y-1 left-0 w-0.5 rounded-pill ${className ?? STATE_FILL[state]} ${
        dotted ? '[mask-image:linear-gradient(to_bottom,black_55%,transparent_55%)] [mask-size:100%_5px]' : ''
      }`}
      style={dotted ? undefined : glow(state, 6)}
    />
  );
}

/** `[ label ]` — the bracketed caption of an annunciator or a column. */
export function Bracketed({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1 ${className}`}>
      <span aria-hidden className="text-primary opacity-50">[</span>
      <span className="min-w-0 truncate">{children}</span>
      <span aria-hidden className="text-primary opacity-50">]</span>
    </span>
  );
}

/** Calm ghost bars — static, delayed, geometry-shaped like cells. */
export function GhostCells({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-2 animate-fade-in" style={{ animationDelay: '180ms' }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="relative flex h-12 flex-col justify-center gap-1.5 pl-3">
          <span className="absolute inset-y-1 left-0 w-0.5 rounded-pill bg-foreground/10" />
          <span className="h-2.5 w-3/4 rounded-interactive bg-primary/[0.06]" />
          <span className="h-2 w-1/3 rounded-interactive bg-primary/[0.05]" />
        </div>
      ))}
    </div>
  );
}

/**
 * A slow clock for elapsed readouts: every 10s, only while something runs and
 * the window is visible. Minute-grained labels do not need a 1s tick.
 */
export function useSlowNow(active: boolean): number {
  const visible = useDocumentVisibility();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !visible) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, [active, visible]);
  return now;
}

/** Two-digit bay number: 01, 02 … 12. */
export const bay = (n: number) => String(n).padStart(2, '0');
