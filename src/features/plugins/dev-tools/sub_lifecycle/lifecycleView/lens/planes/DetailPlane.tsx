/**
 * L3, the last layer: one project's step at full width (owner, 2026-10-16:
 * "the detail ... could become last nested layer instead of expanding on top
 * of the columns so it has enough space to spread and style its content").
 *
 * It is the step screen that used to replace Layer 1 (`layer2/StepScreen`):
 * the band, Next, the preset for its kind, its rule and related items, with
 * its own keys (Esc back, ←/→ walk the steps). A never-measured project gets
 * the first-run setup on its Gate and Tests detail, where Measure is set up.
 *
 * Code: the screen is a lazy chunk; when it is already in, it renders straight
 * from the chunk so it mounts in the same commit as the press.
 */
import { memo, Suspense, useRef } from 'react';

import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { needsSetup } from '../../layer1/setup/setupModel';
import { SetupPanel } from '../../layer1/setup/SetupPanel';
import { LazyStepScreen } from '../../layer2/lazySteps';
import { arrivedStepChunk } from '../../layer2/stepChunks';
import { StepScreenGhost } from '../../layer2/StepScreenGhost';

const SETUP_STEPS = new Set(['gate', 'tests']);

function ScreenHost({ node }: { node: JourneyNode }) {
  // Chosen once per mount: switching component type would remount the screen and lose its state.
  const Direct = useRef(arrivedStepChunk('screen')?.StepScreen ?? null).current;
  return Direct ? <Direct node={node} /> : <LazyStepScreen node={node} />;
}

export const DetailPlane = memo(function DetailPlane({ node }: { node: JourneyNode }) {
  const { projectId, snapshot } = useLifecycleViewModel();
  const setup = SETUP_STEPS.has(node.id) && needsSetup(snapshot);
  return (
    <div className="lens-detail" data-testid="lens-detail" data-step={node.id}>
      {setup && <div className="pb-4"><SetupPanel key={projectId} /></div>}
      <Suspense fallback={<StepScreenGhost />}>
        <ScreenHost node={node} />
      </Suspense>
    </div>
  );
});
