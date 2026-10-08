/**
 * LAYER 1 of the Track prototype: one project's milestones as stations on a
 * single horizontal line, in `layer.milestones` order (shipped cuts last), then
 * the Unassigned station and the Add station. The Ideas tray runs underneath.
 *
 * The line is drawn once behind the row at the rings' centre height; each ring
 * sits on an opaque disc so the line reads as running BETWEEN stations. The
 * row scrolls horizontally when it is wider than the canvas (and when L2's
 * panel compresses it).
 */
import { useTranslation } from '@/i18n/useTranslation';

import { useProgressView } from '../../canvasHost';
import type { ProjectLayer } from '../layerModel';
import { UNASSIGNED, type LayerNav } from '../useLayers';
import { AddStation, UnassignedStation } from './EndStations';
import { IdeasTray } from './IdeasTray';
import { MilestoneStation, STATION_W } from './MilestoneStation';
import { RING_PX } from './StationRing';

/** Row padding + the station button's top padding + half a ring. */
const LINE_TOP = 16 + 12 + RING_PX / 2;
const GHOST_STATIONS = 4;

export function StationTrack({ layer, nav }: { layer: ProjectLayer; nav: LayerNav }) {
  const { tx } = useTranslation();
  const { dl } = useProgressView();
  const openGoal = (milestoneId: string) => (goalId: string) => {
    nav.openMilestone(milestoneId);
    nav.selectGoal(goalId);
  };
  const empty = layer.milestones.length === 0;

  return (
    <div className="flex flex-col min-w-0" data-testid="layers-track-l1">
      <div className="flex items-baseline gap-3 px-6 pt-4">
        <h3 className="typo-heading-lg text-foreground truncate">
          {tx(dl.layers_milestones_of, { project: layer.name })}
        </h3>
      </div>

      {empty && (
        <div className="px-6 pt-3" data-testid="layers-track-empty">
          <p className="typo-heading text-foreground">{dl.layers_no_milestones}</p>
          <p className="typo-body text-foreground">{dl.layers_no_milestones_hint}</p>
        </div>
      )}

      <div className="overflow-x-auto min-w-0" data-testid="layers-track-line">
        <div className="relative flex items-start gap-6 px-6 py-4 w-max min-w-full">
          <span
            aria-hidden="true"
            className="absolute left-6 right-6 h-0.5 rounded-full bg-gradient-to-r from-primary/35 via-violet-400/40 to-primary/10"
            style={{ top: LINE_TOP - 1 }}
          />
          {layer.milestones.map((card) => (
            <MilestoneStation
              key={card.lane.id}
              card={card}
              selected={nav.milestoneId === card.lane.id}
              onOpen={() => nav.openMilestone(card.lane.id)}
              onOpenGoal={openGoal(card.lane.id)}
            />
          ))}
          {layer.unassigned.length > 0 && (
            <UnassignedStation
              goals={layer.unassigned}
              selected={nav.milestoneId === UNASSIGNED}
              onOpen={() => nav.openMilestone(UNASSIGNED)}
              onOpenGoal={openGoal(UNASSIGNED)}
            />
          )}
          <AddStation projectId={layer.projectId} />
        </div>
      </div>

      <IdeasTray projectId={layer.projectId} ideas={layer.ideas} />
    </div>
  );
}

/** The lanes are still loading: calm station-shaped placeholders, no spinner. */
export function StationTrackGhost() {
  const { dl } = useProgressView();
  return (
    <div className="flex items-start gap-6 px-6 py-7" aria-busy="true" aria-label={dl.layers_loading} data-testid="layers-track-ghost">
      {Array.from({ length: GHOST_STATIONS }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col items-center gap-3 shrink-0 animate-fade-in"
          style={{ width: STATION_W, animationDelay: `${150 + i * 35}ms` }}
        >
          <span className="rounded-full border-[7px] border-primary/[0.08]" style={{ width: RING_PX, height: RING_PX }} />
          <span className="h-4 w-32 rounded-interactive bg-primary/[0.06]" />
          <span className="h-3 w-20 rounded-interactive bg-primary/[0.05]" />
        </div>
      ))}
    </div>
  );
}
