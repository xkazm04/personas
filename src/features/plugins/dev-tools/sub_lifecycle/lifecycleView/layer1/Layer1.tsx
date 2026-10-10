/**
 * LAYER 1 - the whole practice at a glance, sized to fit above the fold at
 * 1280x800: the STATUS BAND (the weakest step's sentence and the verdict
 * counts that filter the rail) over the RAIL (two
 * stacked lanes of equal step cards joined by the pipe), then the HISTORY (the
 * last Measures as one figure; picking a past one travels the whole layer to
 * it, `history/timeTravel`). The history is read on idle, after the rail has
 * painted, into a frame that already holds its height.
 *
 * When the Overseer holds a goal for the project, his goal is the status
 * plate's second row, beside the verdict counts (`overseer/GoalPanel`): his
 * items, opened in place through the same item opener a step screen uses.
 *
 * Pressing a card opens that step's Layer-2 screen in place of this one. Once
 * this layer has painted, the Layer-2 chunks are drained in idle time
 * (`stepChunks`), so the first press rarely waits on code.
 *
 * Motion: the cards ripple in on the project's FIRST entrance this session
 * only (`system/entrance`); a warm remount or a return from a step screen
 * paints still.
 *
 * A project never measured gets the first-run setup in the status slot
 * (`setup/SetupPanel`): the commands Measure would run, as a checklist, and the
 * way to the first Measure.
 *
 * A running Measure takes the status band's slot (`measure/MeasurePanel`):
 * the band yields while the panel is open and comes back, re-judged, when it
 * closes. One slot, so the rail under it moves by the difference of two
 * heights, never by a whole panel, and stays above the fold at 1280x800.
 */
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { useLifecycleViewModel } from '../context';
import { RelatedItemProvider } from '../layer2/related/relatedItem';
import { HistorySection } from '../history/HistorySection';
import { prefetchStepChunksOnIdle } from '../layer2/stepChunks';
import { MeasurePanel } from '../measure/MeasurePanel';
import { useMeasureSession } from '../measure/measureSession';
import { EntranceProvider, useFirstEntrance } from '../system/entrance';
import { RAIL } from '../system/lcSurface';
import { HighlightProvider } from './highlight';
import { Rail } from './rail/Rail';
import { needsSetup } from './setup/setupModel';
import { SetupPanel } from './setup/SetupPanel';
import { rememberGoal } from './status/goalHint';
import { StatusBand } from './status/StatusBand';
import { useLayer1 } from './useLayer1';

export function Layer1() {
  const { projectId, snapshot, refetch } = useLifecycleViewModel();
  const play = useFirstEntrance(projectId);
  const data = useLayer1();
  const { open } = useMeasureSession();
  const reduced = useReducedMotion();
  // The band and the panel share one slot: the incoming one settles in, the outgoing one leaves at
  // once, so the slot never holds both. What is there on the first paint is painted still.
  const painted = useRef(false);
  useEffect(() => { painted.current = true; }, []);
  const enter = painted.current && !reduced ? { opacity: 0, y: -6 } : false;

  useEffect(() => prefetchStepChunksOnIdle(), []);
  // What the next cold load's ghost reserves: this project's goal line (`status/goalHint`).
  const hasGoal = !!snapshot?.goal;
  const setup = needsSetup(snapshot);
  useEffect(() => { if (projectId) rememberGoal(projectId, hasGoal); }, [projectId, hasGoal]);

  return (
    <EntranceProvider play={play}>
      <HighlightProvider>
        <RelatedItemProvider onDecided={refetch}>
          <div className={RAIL.laneGap} data-testid="lc1-layer1">
            <motion.div
              key={open ? 'measure' : setup ? 'setup' : 'band'}
              initial={enter}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {open ? <MeasurePanel /> : setup ? <SetupPanel key={projectId} /> : <StatusBand steps={data.all} />}
            </motion.div>
            <div data-testid="lc1-collar">
              <Rail data={data} />
            </div>
            <HistorySection />
          </div>
        </RelatedItemProvider>
      </HighlightProvider>
    </EntranceProvider>
  );
}
