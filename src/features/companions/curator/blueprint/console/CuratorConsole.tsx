/**
 * The operator's console: run the instrument, see what her loop is doing, and
 * file work into the lane she drains BEFORE her own plan.
 *
 * It sits above the ledger because that is the order the work happens in. The
 * ledger below is what she would do next; this is what she is doing now and
 * what you have told her to do first.
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

import { RequestComposer } from './RequestComposer';
import { RequestLane } from './RequestLane';
import { RuntimeStrip } from './RuntimeStrip';
import type { CuratorLoop } from './useCuratorLoop';

export interface ConsoleProps {
  loop: CuratorLoop;
  policy: CuratorPolicy | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  /**
   * Whether the console carries the run control.
   *
   * It does whenever a projection exists. When none does, the empty state
   * below carries it instead: with nothing on the page, running the instrument
   * is the ONE thing to do, and the offer belongs in the block that explains
   * why the page is empty rather than in a toolbar above it. One control
   * either way - never two buttons for one act.
   */
  run?: boolean;
}

/**
 * The run control on its own, so the empty page can offer the same act without
 * the lane and the strip around it.
 */
export function RunInstrument({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => Promise<void> }) {
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

export function CuratorConsole({ loop, policy, refreshing, onRefresh, run = true }: ConsoleProps) {
  const { w } = useWords();
  return (
    <section className="cb-console" aria-label={w.console.region} data-role="cb-console">
      <div className="cb-console-top">
        {run && <RunInstrument refreshing={refreshing} onRefresh={onRefresh} />}
        <RuntimeStrip runtime={loop.runtime} policy={policy} />
      </div>
      <RequestLane requests={loop.requests} onCancel={loop.cancel} />
      <RequestComposer skills={loop.skills} onFile={loop.file} />
    </section>
  );
}
