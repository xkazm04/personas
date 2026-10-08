/**
 * LAYERED PROTOTYPE - BANDS. Each layer REPLACES the canvas (a breadcrumb drill):
 *
 *   L0  the filmstrip - every project's goals; a project's name opens L1
 *   L1  that project's milestones as segment bands (`ProjectBands`)
 *   L2  one milestone opened full-width (`MilestoneDetail layout="full"`)
 *
 * A breadcrumb bar on top is the way back up (Escape climbs too, `useLayerNav`).
 * The layers slide in the direction of travel - deeper from the right, back up
 * from the left - and only fade under reduced motion.
 */
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';

import { useProgressView } from '../../canvasHost';
import { ChronologyHeader } from '../../ChronologyHeader';
import { FilmstripCanvas } from '../../variants/FilmstripCanvas';
import { MilestoneDetail } from '../detail/MilestoneDetail';
import { UNASSIGNED, useLayerNav, useProjectLayer } from '../useLayers';
import { BandsCrumbs } from './BandsCrumbs';
import { GhostBands } from './bandParts';
import { ProjectBands } from './ProjectBands';

const SLIDE_PX = 48;

export function BandsLayers({ leftWidth }: { leftWidth: number }) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { model } = useProgressView();
  const nav = useLayerNav();
  const layer = useProjectLayer(nav.projectId);
  const reduce = useReducedMotion();

  // Direction of travel, derived from the depth change during render (the
  // documented "state from previous render" pattern, no effect round-trip).
  const [prevDepth, setPrevDepth] = useState(nav.depth);
  const [dir, setDir] = useState(1);
  if (prevDepth !== nav.depth) {
    setDir(nav.depth > prevDepth ? 1 : -1);
    setPrevDepth(nav.depth);
  }

  const projectName =
    layer?.name || model.rows.find((r) => r.projectId === nav.projectId)?.name || '';
  const milestoneName =
    nav.milestoneId === UNASSIGNED
      ? dl.layers_unassigned
      : (layer?.milestones.find((m) => m.lane.id === nav.milestoneId)?.lane.name ?? '');

  const openMilestone = (milestoneId: string, goalId?: string) => {
    nav.openMilestone(milestoneId);
    if (goalId) nav.selectGoal(goalId);
  };

  const key = nav.depth === 0 ? 'l0' : nav.depth === 1 ? `l1-${nav.projectId}` : `l2-${nav.milestoneId}`;
  const offset = (d: number) => (reduce ? 0 : d * SLIDE_PX);

  return (
    <div data-testid="layers-bands" data-depth={nav.depth}>
      <BandsCrumbs nav={nav} projectName={projectName} milestoneName={milestoneName} />

      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={key}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: offset(d) }),
              center: { opacity: 1, x: 0 },
              exit: (d: number) => ({ opacity: 0, x: offset(-d) }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduce ? 0.12 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            data-testid={`layers-bands-layer-${nav.depth}`}
          >
            {nav.depth === 0 && (
              <>
                <ChronologyHeader
                  leftWidth={leftWidth}
                  label={tx(dl.progress_summary, { projects: model.rows.length, goals: model.shownGoals })}
                />
                <FilmstripCanvas leftWidth={leftWidth} onOpenProject={nav.openProject} />
              </>
            )}

            {nav.depth === 1 && (
              <div className="p-4">
                <ProjectBands layer={layer} onOpenMilestone={openMilestone} />
              </div>
            )}

            {nav.depth === 2 && nav.milestoneId && (
              <div className="p-4">
                {layer ? (
                  <MilestoneDetail
                    layer={layer}
                    milestoneId={nav.milestoneId}
                    goalId={nav.goalId}
                    onSelectGoal={nav.selectGoal}
                    onClose={() => nav.openProject(layer.projectId)}
                    layout="full"
                  />
                ) : (
                  <GhostBands />
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
