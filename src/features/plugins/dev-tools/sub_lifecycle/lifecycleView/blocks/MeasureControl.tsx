/**
 * Measure: run the project's gate, test and coverage commands on the base
 * branch tip now. The button carries the spinner (a control the user just
 * pressed) for as long as the snapshot says a Measure is running, so a
 * Measure the Overseer started shows the same way. A refusal (another
 * Measure running, nothing to measure) is a note line under the header's
 * cluster, never a toast.
 *
 * A fragment, like the other cluster controls: the button holds its
 * footprint from first paint (disabled while the snapshot loads, and its label
 * reserves the width of "Measuring"), and the note drops below the row.
 */
import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';

import { measureLifecycle } from '@/api/devTools/lifecycle';
import { AsyncButton } from '@/features/shared/components/buttons';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';

import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { ReservedLabel } from '../system/ReservedLabel';
import { GLYPH } from '../system/scales';
import { NOTE_LINE } from './OverseerControls';

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
    <>
      <AsyncButton
        variant="secondary"
        size="sm"
        icon={<Gauge className={GLYPH.sm} />}
        isLoading={!!snapshot?.measuring}
        loadingText={<ReservedLabel shown={dl.lc2_measuring} others={[dl.lc2_measure]} />}
        onClick={measure}
        disabled={!projectId || !snapshot}
        data-testid="lc-measure"
      >
        <ReservedLabel shown={dl.lc2_measure} others={[dl.lc2_measuring]} />
      </AsyncButton>
      {/* The live region is always mounted and only its text changes, so the refusal is announced. */}
      <p role="status" className={failure ? `${NOTE_LINE} ${LT.row} text-status-error` : 'sr-only'} data-testid="lc-measure-note">
        {failure ? `${dl.lc2_measure_failed}: ${failure}` : ''}
      </p>
    </>
  );
}
