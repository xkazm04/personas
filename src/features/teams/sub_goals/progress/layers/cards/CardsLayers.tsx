/**
 * LAYERED PROTOTYPE - CARDS. Thesis: Notes and the filmstrip fuse at L1. A
 * milestone is drawn in the Notepad's own card language - its brief quoted,
 * its goals as quest lines - and the card's border is its progress gauge. The
 * project's loose brainstorm drafts sit beside them as sticky notes that
 * promote into milestones.
 *
 * Transition - SPLIT. L0 is the real filmstrip. Opening a project squeezes the
 * portfolio into a left rail (every project still in view, one click to switch)
 * and the cards fill the right. Opening a card swaps the grid for the
 * milestone's full detail; the rail stays. Escape climbs one rung
 * (`useLayerNav`).
 */
import { ArrowLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import Button from '@/features/shared/components/buttons/Button';

import { ChronologyHeader } from '../../ChronologyHeader';
import { useProgressView } from '../../canvasHost';
import { FilmstripCanvas } from '../../variants/FilmstripCanvas';
import { MilestoneDetail } from '../detail/MilestoneDetail';
import { useLayerNav, useProjectLayer } from '../useLayers';
import { CardsDeck } from './CardsDeck';
import { ProjectRail } from './ProjectRail';

export function CardsLayers({ leftWidth }: { leftWidth: number }) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { model } = useProgressView();
  const nav = useLayerNav();
  const layer = useProjectLayer(nav.projectId);
  const reduced = useReducedMotion();

  // One-shot fades and slides; under reduced motion they resolve instantly.
  const slide = (dx: number) =>
    reduced
      ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, x: dx },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x: -dx / 2 },
          transition: { duration: 0.22, ease: 'easeOut' as const },
        };

  return (
    <div data-testid="layers-cards" data-depth={nav.depth}>
      <AnimatePresence mode="wait" initial={false}>
        {nav.projectId === null ? (
          <motion.div key="l0" {...slide(-16)} data-testid="layers-cards-l0">
            <ChronologyHeader
              leftWidth={leftWidth}
              label={tx(dl.progress_summary, { projects: model.rows.length, goals: model.shownGoals })}
            />
            <FilmstripCanvas leftWidth={leftWidth} onOpenProject={nav.openProject} />
          </motion.div>
        ) : (
          <motion.div key="split" {...slide(24)} className="flex min-h-[28rem]" data-testid="layers-cards-split">
            <ProjectRail openId={nav.projectId} onOpen={nav.openProject} onHome={nav.home} />
            <section className="flex-1 min-w-0 p-5">
              <AnimatePresence mode="wait" initial={false}>
                {nav.milestoneId !== null && layer !== null ? (
                  <motion.div key={`l2-${nav.milestoneId}`} {...slide(24)} className="flex flex-col gap-3" data-testid="layers-cards-l2">
                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<ArrowLeft className="w-4 h-4" />}
                        onClick={() => nav.openProject(layer.projectId)}
                        data-testid="layers-cards-back"
                      >
                        {tx(dl.layers_milestones_of, { project: layer.name })}
                      </Button>
                    </div>
                    <MilestoneDetail
                      layer={layer}
                      milestoneId={nav.milestoneId}
                      goalId={nav.goalId}
                      onSelectGoal={nav.selectGoal}
                      onClose={nav.back}
                      layout="full"
                    />
                  </motion.div>
                ) : (
                  <motion.div key={`l1-${nav.projectId}`} {...slide(24)} data-testid="layers-cards-l1">
                    <CardsDeck projectId={nav.projectId} layer={layer} onOpenMilestone={nav.openMilestone} />
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
