// Atelier — the small shared vocabulary: soft surfaces, quiet labels, state
// dots and the one tick every elapsed figure reads. Colour is reserved for
// state; everything else is a neutral surface one step off the canvas.

import { useEffect, useState, type ReactNode } from 'react';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import type { SquareState } from '../../fleetGridModel';
import type { PendingFact } from '../shared';

/** The resting surface every Atelier card sits on. */
export const SURFACE = 'rounded-card bg-secondary/25 shadow-elevation-1';
/** A surface one step quieter — nested rows, empty slots. */
export const SURFACE_QUIET = 'rounded-input bg-foreground/[0.025]';
/** Hover lift without motion: surface and shadow only. */
export const HOVER_SOFT = 'transition-[background-color,box-shadow] duration-150 hover:bg-secondary/45 hover:shadow-elevation-2';

/** Persona state → the ring / dot tone. Status tokens only. */
export const STATE_DOT: Record<SquareState, string> = {
  running: 'bg-primary',
  attention: 'bg-status-warning',
  failed: 'bg-status-error',
  idle: 'bg-foreground/25',
};
export const STATE_RING: Record<SquareState, string> = {
  running: 'ring-primary/70',
  attention: 'ring-status-warning/70',
  failed: 'ring-status-error/70',
  idle: 'ring-border',
};
export const STATE_TEXT: Record<SquareState, string> = {
  running: 'text-primary',
  attention: 'text-status-warning',
  failed: 'text-status-error',
  idle: 'text-foreground opacity-60',
};

export const PENDING_TONE: Record<PendingFact['tone'], string> = {
  error: 'bg-status-error/12 text-status-error',
  warning: 'bg-status-warning/12 text-status-warning',
  info: 'bg-status-info/12 text-status-info',
  processing: 'bg-primary/12 text-primary',
};

export function StateDot({ state, reducedMotion }: { state: SquareState; reducedMotion: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-2 w-2 flex-shrink-0 rounded-full ${STATE_DOT[state]} ${
        state === 'running' && !reducedMotion ? 'animate-pulse' : ''
      }`}
    />
  );
}

/** A quiet section label with an optional count. */
export function SectionLabel({ children, count, trailing }: { children: ReactNode; count?: number; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="typo-label text-foreground opacity-70">{children}</span>
      {count !== undefined && (
        <span className="rounded-pill bg-secondary/50 px-2 typo-label tabular-nums text-foreground">{count}</span>
      )}
      {trailing && <span className="ml-auto flex items-center gap-2">{trailing}</span>}
    </div>
  );
}

/** Elapsed figures re-read on this tick while the window is visible. */
export function useTick(ms = 5_000): number {
  const visible = useDocumentVisibility();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [visible, ms]);
  return now;
}

/** Calm, delayed ghost block — the cold-open stand-in under permanent chrome. */
export function GhostBlock({ className = '', height }: { className?: string; height: number }) {
  return (
    <div
      aria-hidden
      className={`animate-fade-in rounded-card bg-foreground/[0.03] ${className}`}
      style={{ height, animationDelay: '150ms' }}
    />
  );
}
