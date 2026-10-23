/**
 * What you can do to the focused project's practice - Measure, the Overseer
 * hand-off, Ask Athena, and last the one conditional control, Install - in the
 * top bar's fixed actions slot. The project picker is gone: the portfolio is
 * the picker.
 *
 * Every always-present control renders at its final size from first paint,
 * disabled until the snapshot is in. A control's note (a refusal, an install
 * result) floats under the slot (`lens.css`), so a message never moves the
 * header (the owner's fixed-height rule).
 */
import { memo } from 'react';
import { Sparkles } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';

import { InstallControl } from '../../blocks/InstallControl';
import { MeasureControl } from '../../blocks/MeasureControl';
import { OverseerControls } from '../../blocks/OverseerControls';
import { useLifecycleViewModel } from '../../context';
import { GLYPH } from '../../system/scales';

export const LensActions = memo(function LensActions() {
  const { dl, projectId, projectName, snapshot, askAthena } = useLifecycleViewModel();
  return (
    <div className="lens-actions" data-testid="lc-header-cluster">
      <MeasureControl />
      <OverseerControls
        projectId={projectId}
        watched={snapshot?.watched ?? false}
        goal={snapshot?.goal ?? null}
        disabled={!snapshot}
      />
      <Button
        variant="accent"
        tone="agent"
        size="sm"
        icon={<Sparkles className={GLYPH.sm} />}
        onClick={askAthena}
        disabled={!projectName}
        data-testid="lc-ask-athena"
      >
        {dl.lc_ask_athena}
      </Button>
      <InstallControl />
    </div>
  );
});
