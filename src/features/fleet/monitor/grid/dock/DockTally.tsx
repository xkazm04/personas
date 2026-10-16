// The resting dock's rent: what the fleet's sessions are doing right now, as
// the command bar's chips say it (`CommandBar` tally: a window, its lamp, the
// state's word, the bold figure). Read-only: the chips are readings on the
// expand door's row, not filters, so they are spans, not buttons. A chip is
// drawn only while its count is above zero, and its lamp is then lit
// (annunciator grammar: a dark chip would be a reading of nothing).

import { useTranslation } from '@/i18n/useTranslation';
import { Lamp } from '../prototype/entry-e/parts';
import type { Tone } from '../prototype/entry-e/tone';

function Chip({ tone, word, count, label, testId }: { tone: Tone; word: string; count: number; label: string; testId: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      data-testid={testId}
      className={`ae-win is-lit ae-t-${tone} inline-flex h-7 flex-shrink-0 items-center gap-2 rounded-input px-2.5`}
    >
      <Lamp lamp={{ tone, lit: true }} />
      <span className="hidden typo-caption text-foreground @[40rem]/dock:inline">{word}</span>
      <span className="typo-data tabular-nums text-foreground">{count}</span>
    </span>
  );
}

export function DockTally({ needsYou, working }: { needsYou: number; working: number }) {
  const { t, tx } = useTranslation();
  const q = t.plugins.fleet_quick_dispatch;
  return (
    <span className="flex flex-shrink-0 items-center gap-1" data-testid="quick-dispatch-dock-tally">
      {needsYou > 0 && (
        <Chip tone="warn" word={t.monitor.grid_state_attention} count={needsYou}
          label={tx(q.rest_tally_needs_you, { count: needsYou })} testId="quick-dispatch-dock-needs-you" />
      )}
      {working > 0 && (
        <Chip tone="run" word={t.monitor.grid_state_running} count={working}
          label={tx(q.rest_tally_working, { count: working })} testId="quick-dispatch-dock-working" />
      )}
    </span>
  );
}
