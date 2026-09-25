/**
 * The operator's console: run the instrument, and see what her loop is doing.
 *
 * ## What left, and what stayed
 *
 * The request COMPOSER - the skill picker, its argument field and its note
 * field - is gone from here. An app-wide universal console is being built to
 * take that job, and a second place to type a skill invocation would be a
 * second place for the two to drift. The lane it filed into left too, for the
 * queue DRAWER beside the docket, where it gets the height a queue deserves
 * instead of a 148px scroller wedged above the ledger.
 *
 * The RUN control stayed, and stays deliberately. It runs her projection, not
 * a skill - nothing in the universal console's job description covers it - and
 * without it this page has no way to populate itself at all, which would be a
 * regression rather than a simplification. When the universal console exists
 * and can carry it, moving it is one line.
 *
 * The runtime strip stayed because it is display, not input.
 *
 * ## The eleven seconds
 *
 * `curator_plan_refresh` spawns up to four node processes against the registry
 * on disk and takes about eleven seconds cold (five minutes cached on the same
 * HEAD). That is an ACTION the operator just pressed, not a surface loading
 * its data, so it wears a real spinner on the control itself plus `disabled`
 * and `aria-busy` - never a ghost, and never `LoadingSpinner`, which renders
 * nothing. Beside it, a live region says what is happening while the wait
 * runs, because eleven silent seconds on a button is indistinguishable from a
 * dead one.
 */
import { RefreshCw } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';

import { useWords } from '../words';

import { RuntimeStrip } from './RuntimeStrip';
import type { CuratorLoop } from './useCuratorLoop';

export interface ConsoleProps {
  loop: CuratorLoop;
  policy: CuratorPolicy | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}

/**
 * The run control.
 *
 * THE PAGE HAS EXACTLY ONE, IN EVERY PHASE, AND IT IS HERE. It used to move:
 * with a projection the console carried it, and without one a whole-page empty
 * state did instead, which meant the control the operator is looking for
 * changed address depending on a read they cannot see. Now the full layout
 * always draws, so the console always has it - booting, offering and running
 * alike - and no phase can show the offer twice.
 */
function RunInstrument({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => Promise<void> }) {
  const { w } = useWords();
  return (
    <span className="cb-run">
      <AsyncButton
        variant="primary"
        size="sm"
        className="cb-keep"
        isLoading={refreshing}
        loadingText={w.console.refresh_running}
        icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden />}
        data-testid="curator-run-instrument"
        onClick={onRefresh}
      >
        {w.console.refresh}
      </AsyncButton>
      {/* The wait, narrated. `aria-live` because the only other signal that
          anything is happening is a spinner, which a screen reader does not
          read out. */}
      <span className="cb-run-say typo-caption" role="status" aria-live="polite" data-role="cb-run-status">
        {refreshing ? w.console.refresh_working : ''}
      </span>
    </span>
  );
}

export function CuratorConsole({ loop, policy, refreshing, onRefresh }: ConsoleProps) {
  const { w } = useWords();
  return (
    <section className="cb-console" aria-label={w.console.region} data-role="cb-console">
      <div className="cb-console-top">
        <RunInstrument refreshing={refreshing} onRefresh={onRefresh} />
        <RuntimeStrip runtime={loop.runtime} policy={policy} />
      </div>
    </section>
  );
}
