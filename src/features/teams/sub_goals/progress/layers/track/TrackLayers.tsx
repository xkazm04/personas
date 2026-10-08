/**
 * LAYERED PROTOTYPE - TRACK. THESIS: a project's milestones are stations on
 * one line, and the layers hand over by EXPANDING IN PLACE.
 *
 *   L0  the real filmstrip, unchanged, under its own chronology header. A
 *       project name is the door to L1.
 *   L1  the portfolio collapses into a mini rail at the top (switch project
 *       without climbing back) and the opened project grows into its station
 *       track: big progress rings, readable names, goals hanging underneath.
 *   L2  a station opens the shared `MilestoneDetail` as a right-side panel;
 *       the track stays visible beside it and compresses (it scrolls).
 *
 * Escape climbs a rung (owned by `useLayerNav`); the rail's Back does the same.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';

import { ChronologyHeader } from '../../ChronologyHeader';
import { useProgressView } from '../../canvasHost';
import { FilmstripCanvas } from '../../variants/FilmstripCanvas';
import { MilestoneDetail } from '../detail/MilestoneDetail';
import { UNASSIGNED, useLayerNav, useProjectLayer } from '../useLayers';
import { StationTrack, StationTrackGhost } from './StationTrack';
import { TrackRail } from './TrackRail';

const PANEL_W = 460;
const EASE = [0.22, 1, 0.36, 1] as const;

export function TrackLayers({ leftWidth }: { leftWidth: number }) {
  const { tx } = useTranslation();
  const { model, dl } = useProgressView();
  const nav = useLayerNav();
  const layer = useProjectLayer(nav.projectId);
  const reduce = useReducedMotion();
  const tr = (s: number) => (reduce ? { duration: 0 } : { duration: s, ease: EASE });

  // The opened project left the portfolio (scope or filter change): its lanes
  // will never arrive, so a ghost would spin forever. Climb home instead.
  const panelName =
    nav.milestoneId === UNASSIGNED
      ? dl.layers_unassigned
      : (layer?.milestones.find((m) => m.lane.id === nav.milestoneId)?.lane.name ?? dl.layers_brief);
  const known = !nav.projectId || model.rows.some((r) => r.projectId === nav.projectId);
  const { home } = nav;
  useEffect(() => {
    if (!known) home();
  }, [known, home]);

  return (
    <div data-testid="layers-track" data-depth={nav.depth}>
      <AnimatePresence initial={false} mode="wait">
        {nav.depth === 0 ? (
          <motion.div
            key="l0"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: tr(0.22) }}
            transition={tr(0.2)}
            className="overflow-hidden"
            data-testid="layers-track-l0"
          >
            <ChronologyHeader
              leftWidth={leftWidth}
              label={tx(dl.progress_summary, { projects: model.rows.length, goals: model.shownGoals })}
            />
            <FilmstripCanvas leftWidth={leftWidth} onOpenProject={nav.openProject} />
          </motion.div>
        ) : (
          <motion.div
            key="l1"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: tr(0.18) }}
            transition={tr(0.32)}
            className="overflow-hidden"
          >
            <TrackRail nav={nav} />
            <div className="flex items-stretch min-w-0">
              <div className="flex-1 min-w-0">
                {layer ? <StationTrack layer={layer} nav={nav} /> : <StationTrackGhost />}
              </div>
              <AnimatePresence initial={false}>
                {layer && nav.milestoneId && (
                  <motion.aside
                    key="l2"
                    aria-label={panelName}
                    data-testid="layers-track-panel"
                    initial={reduce ? false : { width: 0, opacity: 0 }}
                    animate={{ width: PANEL_W, opacity: 1 }}
                    exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { width: 0, opacity: 0, transition: tr(0.2) }}
                    transition={tr(0.28)}
                    className="shrink-0 overflow-hidden border-l border-primary/10 bg-card/40"
                  >
                    <div style={{ width: PANEL_W }} className="h-full">
                      <MilestoneDetail
                        layer={layer}
                        milestoneId={nav.milestoneId}
                        goalId={nav.goalId}
                        onSelectGoal={nav.selectGoal}
                        onClose={() => nav.openProject(layer.projectId)}
                        layout="panel"
                      />
                    </div>
                  </motion.aside>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
