/**
 * L1 - one project's milestones as a desk of brief cards, then the unbound
 * goals, the add card, and the ideas tray. While the lanes load it keeps the
 * grid's shape with ghost cards (ghost-under-chrome) instead of blanking.
 */
import { Flag } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { useProgressView } from '../../canvasHost';
import type { ProjectLayer } from '../layerModel';
import { UNASSIGNED } from '../useLayers';
import { AddMilestoneCard, GhostCards, UnassignedCard } from './ExtraCards';
import { IdeasStrip } from './IdeasStrip';
import { MilestoneBriefCard } from './MilestoneBriefCard';

// Container breakpoints: the deck's width is the canvas minus the rail, not the viewport.
const GRID = 'grid gap-5 grid-cols-1 @2xl:grid-cols-2 @5xl:grid-cols-3';

export function CardsDeck({
  projectId,
  layer,
  onOpenMilestone,
}: {
  projectId: string;
  layer: ProjectLayer | null;
  onOpenMilestone: (milestoneId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { model, canvas } = useProgressView();
  const name = layer?.name || model.rows.find((r) => r.projectId === projectId)?.name || '';
  const addCard = (
    <AddMilestoneCard onAdd={() => canvas.startCreateMilestone(projectId)} busy={canvas.busy} />
  );

  return (
    <div className="@container" data-testid="layers-cards-deck">
      <h3 className="typo-title mb-4">{tx(dl.layers_milestones_of, { project: name })}</h3>

      {layer === null ? (
        <div className={GRID} aria-busy="true" aria-label={dl.layers_loading}>
          <GhostCards />
        </div>
      ) : (
        <>
          {layer.milestones.length === 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-card border border-primary/10 bg-secondary/10 px-4 py-3" data-testid="layers-cards-empty">
              <Flag className="w-5 h-5 mt-0.5 text-primary shrink-0" aria-hidden />
              <div>
                <div className="typo-heading text-foreground">{dl.layers_no_milestones}</div>
                <div className="typo-body text-foreground">{dl.layers_no_milestones_hint}</div>
              </div>
            </div>
          )}
          <div className={GRID}>
            {layer.milestones.map((card) => (
              <MilestoneBriefCard key={card.lane.id} card={card} onOpen={() => onOpenMilestone(card.lane.id)} />
            ))}
            {layer.unassigned.length > 0 && (
              <UnassignedCard goals={layer.unassigned} onOpen={() => onOpenMilestone(UNASSIGNED)} />
            )}
            {addCard}
          </div>
          <IdeasStrip projectId={projectId} ideas={layer.ideas} />
        </>
      )}
    </div>
  );
}
