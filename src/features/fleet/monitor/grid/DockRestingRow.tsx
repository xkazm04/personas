// DockRestingRow: the dispatch dock collapsed to one row (QuickDispatchDock's
// resting state, split out 2026-10-15 when WP7 added the act ticker). The
// row pays rent with the live fleet tally and, under the `lanes` decision
// surface, the stewards' act ticker; its height is reserved (h-9) whatever it
// carries, so nothing in it ever moves the board above.

import { Terminal } from 'lucide-react';

import { useDecisionSurface } from '@/features/decision-center/lanes/useLanesSnapshot';

import { DockActTicker } from './DockActTicker';
import { DOCK_COLUMN } from './dock/DockParts';
import type { DockConsole } from './dock/useDockConsole';

export function DockRestingRow({ console: d }: { console: DockConsole }) {
  const { c, tally } = d;
  const lanes = useDecisionSurface() === 'lanes';
  // The expand door is ONE button laid under the whole row; the row's
  // readings sit above it and let the pointer through, so the act ticker
  // (WP7) can be its own button without nesting one inside the other.
  return (
    <div className="group relative flex-shrink-0 border-t border-border bg-foreground/[0.015]">
      <span className="dock-rail pointer-events-none absolute inset-x-0 -top-px z-[4] h-px overflow-hidden" aria-hidden />
      <button
        type="button"
        onClick={d.expand}
        aria-label={c.quickT.title}
        data-testid="quick-dispatch-dock-expand"
        className="absolute inset-0 block w-full transition-colors hover:bg-secondary/30"
      />
      <span className={`${DOCK_COLUMN} pointer-events-none relative flex h-9 items-center gap-2 px-3`}>
        <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />
        <span className="dock-caret h-3.5 w-[7px] flex-shrink-0 rounded-[1px] bg-primary" aria-hidden />
        {/* The composer's placeholder keeps its whole width; the ticker (or,
            without it, a spacer) takes what is left and yields first. */}
        <span className="flex-shrink-0 truncate font-mono text-xs text-muted transition-colors group-hover:text-foreground">
          {c.quickT.placeholder}
        </span>
        {lanes ? <DockActTicker /> : <span className="flex-1" aria-hidden />}
        {/* The rent this row pays: what the fleet is doing right now. */}
        <span className="flex flex-shrink-0 items-center gap-2.5" data-testid="quick-dispatch-dock-tally">
          {tally.needsYou > 0 && (
            <span className="typo-label flex items-center gap-1 text-role-highlight">
              <span className="h-1.5 w-1.5 rounded-full bg-role-highlight" aria-hidden />
              {c.tx(c.quickT.rest_tally_needs_you, { count: tally.needsYou })}
            </span>
          )}
          {tally.working > 0 && (
            <span className="typo-label flex items-center gap-1 text-status-info">
              <span className="h-1.5 w-1.5 rounded-full bg-status-info" aria-hidden />
              {c.tx(c.quickT.rest_tally_working, { count: tally.working })}
            </span>
          )}
        </span>
        <span className="typo-label flex-shrink-0 text-muted transition-colors group-hover:text-primary">
          {c.quickT.title}
        </span>
      </span>
    </div>
  );
}
