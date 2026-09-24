// Departures — the ledger's shared vocabulary. PROTOTYPE (variant C).
//
// The whole variant is built from four atoms: a small SQUARE MARKER in a state
// colour, a RULED HEADER (label over a hairline), a TABULAR CELL, and a calm
// GHOST LINE. Colour lives only in markers and status words; everything else is
// foreground at full or stepped-back opacity, aligned on tabular numerals.

import { useEffect, useState, type ReactNode } from 'react';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import type { SquareState } from '../../fleetGridModel';
import type { PendingFact } from '../shared';

/** Persona state → marker fill. Canonical status tokens only. */
export const STATE_FILL: Record<SquareState, string> = {
  running: 'bg-primary',
  attention: 'bg-status-warning',
  failed: 'bg-status-error',
  idle: 'bg-foreground/30',
};

/** Persona state → status-word colour. Idle recedes rather than tinting. */
export const STATE_TEXT: Record<SquareState, string> = {
  running: 'text-primary',
  attention: 'text-status-warning',
  failed: 'text-status-error',
  idle: 'text-foreground opacity-50',
};

/** Pressed-filter underline, in the state's own colour. */
export const STATE_UNDERLINE: Record<SquareState, string> = {
  running: 'border-primary',
  attention: 'border-status-warning',
  failed: 'border-status-error',
  idle: 'border-foreground/50',
};

export const PENDING_TEXT: Record<PendingFact['tone'], string> = {
  error: 'text-status-error',
  warning: 'text-status-warning',
  info: 'text-status-info',
  processing: 'text-status-processing',
};

/** A 6px square marker. `pulse` only for live work, and only when motion is allowed. */
export function Marker({ className, pulse = false }: { className: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-none ${className} ${pulse ? 'motion-safe:animate-pulse' : ''}`}
    />
  );
}

/** A section's title row: label left, trailing content right, one hairline under. */
export function RuledHeader({
  label, count, trailing, className = '',
}: {
  label: ReactNode;
  count?: number;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-2 border-b border-border/60 pb-1 ${className}`}>
      <span className="typo-label uppercase tracking-wide text-foreground">{label}</span>
      {count !== undefined && <span className="typo-data tabular-nums text-foreground opacity-60">{count}</span>}
      {trailing && <span className="ml-auto flex items-baseline gap-3">{trailing}</span>}
    </div>
  );
}

/** Geometry-matched placeholder lines — static, delayed, under the chrome. */
export function GhostLines({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden className="flex flex-col animate-fade-in" style={{ animationDelay: '150ms' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-8 items-center gap-3 border-b border-border/30 px-2">
          <span className="h-1.5 w-1.5 rounded-none bg-foreground/10" />
          <span className="h-2 rounded-pill bg-foreground/[0.06]" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
          <span className="ml-auto h-2 w-12 rounded-pill bg-foreground/[0.05]" />
        </div>
      ))}
    </div>
  );
}

/** Two-digit gate / rank numerals: `03`, `12`. */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The ledger's clock: a 5 s tick for elapsed columns, only while `active` and
 * the window is visible — a hidden window paints no clock.
 */
export function useLedgerClock(active: boolean): number {
  const visible = useDocumentVisibility();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !visible) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, [active, visible]);
  return now;
}
