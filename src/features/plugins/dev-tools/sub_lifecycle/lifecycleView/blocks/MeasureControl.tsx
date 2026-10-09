/**
 * Measure: run the project's gate, test and coverage commands on the base
 * branch tip now. Idle it is a button; while a Measure runs (this page's, or
 * one the Overseer started) the same slot holds the live control
 * (`measure/MeasureProgress`: the segmented track, "2 of 5", Cancel), laid
 * over the idle button, which stays in place hidden: the button's own box IS
 * the footprint, so starting or ending a Measure moves nothing in the
 * header's cluster (at 1280 wide the cluster fills its row with ~7px spare). The button keeps the pressed-control spinner only for the
 * moment between the press and the snapshot saying the Measure runs.
 *
 * A refusal is a note line under the cluster, never a toast: "nothing to
 * measure" carries the way to set commands up (Gate's Commands editor); any
 * other refusal (another Measure running) says the backend's reason. A
 * failed Cancel is said on the same line.
 */
import { Gauge, Settings2 } from 'lucide-react';

import { AsyncButton, Button } from '@/features/shared/components/buttons';

import { useLifecycleViewModel } from '../context';
import { MeasureProgress } from '../measure/MeasureProgress';
import { useCancelMeasure } from '../measure/useCancelMeasure';
import { LT } from '../system/lcType';
import { ReservedLabel } from '../system/ReservedLabel';
import { GLYPH } from '../system/scales';
import { NOTE_LINE } from './OverseerControls';
import { useMeasureNow } from './useMeasureNow';

export function MeasureControl() {
  const { dl, projectId, snapshot, openStep } = useLifecycleViewModel();
  const cancel = useCancelMeasure();
  const { measure, running, refusal } = useMeasureNow();

  const note = refusal?.kind === 'nothing'
    ? dl.lcx4_nothing
    : refusal ? `${dl.lc2_measure_failed}: ${refusal.text}` : cancel.failure ? `${dl.lcx4_cancel_failed}: ${cancel.failure}` : '';

  return (
    <>
      <span className="relative inline-flex shrink-0" data-testid="lc-measure-slot" data-running={running || undefined}>
        <span className={`flex ${running ? 'invisible' : ''}`}>
          <AsyncButton
            variant="secondary"
            size="sm"
            icon={<Gauge className={GLYPH.sm} />}
            onClick={measure}
            disabled={!projectId || !snapshot || running}
            data-testid="lc-measure"
          >
            {/* The label reserves the width the button always had, which is the live control's room. */}
            <ReservedLabel shown={dl.lc2_measure} others={[dl.lc2_measuring]} />
          </AsyncButton>
        </span>
        {running && (
          <span className="absolute inset-0 flex">
            <MeasureProgress cancel={cancel} />
          </span>
        )}
      </span>
      {/* The live region is always mounted and only its text changes, so the refusal is announced. */}
      <p role="status" className={note ? `${NOTE_LINE} flex flex-wrap items-center gap-x-3 ${LT.row} text-status-error` : 'sr-only'} data-testid="lc-measure-note">
        {note}
        {refusal?.kind === 'nothing' && (
          <Button
            variant="link"
            size="xs"
            icon={<Settings2 className={GLYPH.sm} />}
            onClick={() => openStep('gate', 'commands')}
            data-testid="lc-measure-setup"
          >
            {dl.lcx4_nothing_cta}
          </Button>
        )}
      </p>
    </>
  );
}
