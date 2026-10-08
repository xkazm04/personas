/**
 * Measure: run the project's gate, test and coverage commands on the base
 * branch tip now. The button carries the spinner (a control the user just
 * pressed) for as long as the snapshot says a Measure is running, so a
 * Measure the Overseer started shows the same way. A refusal (another
 * Measure running, nothing to measure) is said inline beside the button,
 * never in a toast.
 */
import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';

import { measureLifecycle } from '@/api/devTools/lifecycle';
import { AsyncButton } from '@/features/shared/components/buttons';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';

import { useLifecycleViewModel } from '../context';

export function MeasureControl() {
  const { dl, projectId, snapshot, refetch } = useLifecycleViewModel();
  const [failure, setFailure] = useState<string | null>(null);

  // A failure belongs to the project it was said about.
  useEffect(() => { setFailure(null); }, [projectId]);

  const measure = async () => {
    if (!projectId) return;
    setFailure(null);
    try {
      await measureLifecycle(projectId);
      refetch();
    } catch (err) {
      silentCatch('lifecycle:measure')(err);
      setFailure(resolveError(err instanceof Error ? err.message : String(err)).message);
    }
  };

  return (
    <span className="flex items-center gap-3">
      {/* The live region is always mounted and only its text changes, so the refusal is announced. */}
      <span role="status" className="typo-body text-status-error" data-testid="lc-measure-note">
        {failure ? `${dl.lc2_measure_failed}: ${failure}` : ''}
      </span>
      <AsyncButton
        variant="secondary"
        size="sm"
        icon={<Gauge className="w-3.5 h-3.5" />}
        isLoading={!!snapshot?.measuring}
        loadingText={dl.lc2_measuring}
        onClick={measure}
        disabled={!projectId || !snapshot}
        data-testid="lc-measure"
      >
        {dl.lc2_measure}
      </AsyncButton>
    </span>
  );
}
