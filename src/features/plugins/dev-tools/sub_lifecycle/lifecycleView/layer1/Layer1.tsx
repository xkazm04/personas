/**
 * LAYER 1 - the whole practice at a glance, sized to fit above the fold at
 * 1280x800: the STATUS BAND (the weakest step's sentence, the goal as a drawn
 * quantity, the verdict counts that filter the rail) over the RAIL (two
 * stacked lanes of equal step cards joined by the pipe), then the HISTORY (the
 * last Measures as one figure; picking a past one travels the whole layer to
 * it, `history/timeTravel`). The history is read on idle, after the rail has
 * painted, into a frame that already holds its height.
 *
 * Pressing a card opens that step's Layer-2 screen in place of this one. Once
 * this layer has painted, the Layer-2 chunks are drained in idle time
 * (`stepChunks`), so the first press rarely waits on code.
 *
 * Motion: the cards ripple in on the project's FIRST entrance this session
 * only (`system/entrance`); a warm remount or a return from a step screen
 * paints still.
 */
import { useEffect } from 'react';

import { useLifecycleViewModel } from '../context';
import { HistorySection } from '../history/HistorySection';
import { prefetchStepChunksOnIdle } from '../layer2/stepChunks';
import { EntranceProvider, useFirstEntrance } from '../system/entrance';
import { RAIL } from '../system/lcSurface';
import { HighlightProvider } from './highlight';
import { Rail } from './rail/Rail';
import { StatusBand } from './status/StatusBand';
import { useLayer1 } from './useLayer1';

export function Layer1() {
  const { projectId } = useLifecycleViewModel();
  const play = useFirstEntrance(projectId);
  const data = useLayer1();

  useEffect(() => prefetchStepChunksOnIdle(), []);

  return (
    <EntranceProvider play={play}>
      <HighlightProvider>
        <div className={RAIL.laneGap} data-testid="lc1-layer1">
          <StatusBand steps={data.all} />
          <div data-testid="lc1-collar">
            <Rail data={data} />
          </div>
          <HistorySection />
        </div>
      </HighlightProvider>
    </EntranceProvider>
  );
}
