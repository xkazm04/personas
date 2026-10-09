// The first failure of an ended Measure, named: "eslint failed: <its first
// error>" (or "check timed out"), with how many more failed, and the way to
// the step that owns the command (Gate or Tests). The first error is the
// Measure's own run, read from the step's detail (cached, revalidated on the
// same revision that ended the Measure); until it lands the line names the
// command alone.
import { ArrowRight, OctagonX } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { LifecycleCommandProgress } from '@/lib/bindings/LifecycleCommandProgress';

import { stepLabel } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { useStepDetail } from '../layer2/useStepDetail';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { stepForKind } from './measureModel';

interface FailureLineProps {
  failure: LifecycleCommandProgress;
  more: number;
  measureId: string | null;
}

export function FailureLine({ failure, more, measureId }: FailureLineProps) {
  const { dl, tx, projectId, snapshot, openStep } = useLifecycleViewModel();
  const stepId = snapshot ? stepForKind(snapshot.rules, failure.kind) : null;
  const { detail } = useStepDetail(projectId, failure.outcome === 'failed' ? stepId : null);
  const error = detail?.runs.find((r) => r.measureId === measureId && r.commandId === failure.commandId)?.firstError ?? null;
  const command = failure.commandId;
  const said = failure.outcome === 'timeout'
    ? tx(dl.lcx4_timed_out, { command })
    : error ? tx(dl.lcx4_failed_error, { command, error }) : tx(dl.lcx4_failed, { command });
  return (
    <p className={`flex h-7 min-w-0 items-center gap-2 ${LT.row}`} data-testid="lc-measure-failure">
      <OctagonX className={`${GLYPH.sm} shrink-0 text-status-error`} aria-hidden />
      <Tooltip content={error ?? said} placement="bottom">
        <span className="min-w-0 truncate text-status-error">{said}</span>
      </Tooltip>
      {more > 0 && <span className={`shrink-0 ${LT.meta}`}>{tx(dl.lcx4_more_failed, { count: more })}</span>}
      {stepId && (
        <Button
          variant="link"
          size="xs"
          iconRight={<ArrowRight className={GLYPH.sm} />}
          onClick={() => openStep(stepId)}
          className="shrink-0"
          data-testid="lc-measure-open-step"
        >
          {tx(dl.lcx4_open_step, { step: stepLabel(dl, stepId, null) })}
        </Button>
      )}
    </p>
  );
}
