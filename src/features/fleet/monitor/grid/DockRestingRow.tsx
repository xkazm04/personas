// DockRestingRow: the dispatch dock collapsed to one row (QuickDispatchDock's
// resting state, split out 2026-10-15 when WP7 added the act ticker). The
// row pays rent with the live fleet tally and the stewards' act ticker; its
// height is reserved (the plate's h-10) whatever it carries, so nothing in it
// ever moves the board above.
//
// THE PLATE (polish P2, 2026-10-16). The row was a full-width strip of mono
// text and coloured dots under a board of plates and chips. It is now a plate
// of the panel (`.ae-dock` + `.ae-plate`) whose door is a window (`ae-win`,
// the command bar's chip glass) holding the composer's prompt, followed by the
// act ticker at caption weight and the tally as the bar's lamp chips. The
// door is the shared `Button`, so the row has no hand-rolled button and the
// ticker beside it is its own button, never nested in another.

import { ChevronUp, Terminal } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { DockActTicker } from './DockActTicker';
import { DockTally } from './dock/DockTally';
import type { DockConsole } from './dock/useDockConsole';
import './prototype/entry-e/entryE.css';

export function DockRestingRow({ console: d }: { console: DockConsole }) {
  const { c, tally } = d;
  return (
    <div className="ae-dock relative flex-shrink-0 px-2.5 pb-2 pt-1">
      <div className="ae-plate @container/dock relative flex h-10 items-center gap-2 rounded-card px-1.5">
        <span className="dock-rail pointer-events-none absolute inset-x-3 -top-px z-[4] h-px overflow-hidden" aria-hidden />
        {/* The door: the composer's prompt in a window. It keeps its floor
            width; the ticker beside it takes what is left and yields first. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={d.expand}
          aria-label={c.quickT.title}
          data-testid="quick-dispatch-dock-expand"
          icon={<Terminal className="h-3.5 w-3.5 text-primary" aria-hidden />}
          iconRight={<ChevronUp className="h-3.5 w-3.5 text-foreground" aria-hidden />}
          className="ae-win ae-focus group h-8 min-w-[15rem] flex-[0_1_30rem] rounded-input [&>span:nth-child(2)]:min-w-0 [&>span:nth-child(2)]:flex-1"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="dock-caret h-3.5 w-[7px] flex-shrink-0 rounded-interactive bg-primary" aria-hidden />
            <span className="min-w-0 truncate typo-caption text-left">{c.quickT.placeholder}</span>
            <span className="ml-auto hidden flex-shrink-0 typo-caption @[48rem]/dock:inline">{c.quickT.title}</span>
          </span>
        </Button>
        <DockActTicker />
        <DockTally needsYou={tally.needsYou} working={tally.working} />
      </div>
    </div>
  );
}
