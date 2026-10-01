/**
 * Dossier (WP9), the Training board (L2): the six topic bars with their tier
 * and a key for the drawing (approved, awaiting review, the covered tick)
 * beside the answer kinds and the run totals; under them every goal of the
 * plan as one full-width row - its title, its coverage on 0..1, its answered
 * count - which opens that goal's full detail (L3).
 */
import { ChipRow, KeyValueGrid } from '@/features/shared/components/kit';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import type { SectionId, TwinBlueprintModel } from '../../../blueprintContract';
import { KIND_TONE, TOPIC_COVERED_AT, kindParts } from '../dossierModel';
import { Figure } from '../Figure';
import { TopicBars } from '../TopicBars';
import { KindStrip } from '../TrainingMarks';
import { GoalRows } from './GoalRows';

interface TrainingBoardProps {
  model: TwinBlueprintModel;
  onOpenDetail: (section: SectionId, itemKey?: string) => void;
  reduced: boolean;
}

export function TrainingBoard({ model, onOpenDetail, reduced }: TrainingBoardProps) {
  const { t, tx } = useTranslation();
  const tb = t.twin.blueprint;
  const copy = tb.variantCopy.dossier;
  const { topics, goals, answered, kindMix, observations, lastTrainedAt } = model.training;

  return (
    <div className="dossier-board" data-testid="dossier-board-training">
      <div className="dossier-board--split">
        <div className="dossier-board__col">
          <span className="typo-label dossier-key k-in">{tb.metrics.topics}</span>
          <TopicBars topics={topics} tiers reduced={reduced} />
          <div className="dossier-key-legend k-in" aria-hidden="true">
            <span className="dossier-swatch" data-swatch="approved" />
            <span className="typo-caption">{tb.metrics.approved}</span>
            <span className="dossier-swatch" data-swatch="awaiting" />
            <span className="typo-caption">{tb.metrics.awaiting}</span>
            <span className="dossier-swatch" data-swatch="tick" />
            <span className="typo-caption">{tx(copy.coveredAt, { count: TOPIC_COVERED_AT })}</span>
          </div>
        </div>
        <div className="dossier-board__col">
          <span className="typo-label dossier-key k-in">{tb.metrics.kinds}</span>
          <div className="dossier-line k-in">
            <KindStrip kindMix={kindMix} maxUnits={40} />
          </div>
          <ChipRow
            label={tb.metrics.kinds}
            emptyLabel={tb.states.emptyTraining}
            chips={kindParts(kindMix).map((p) => ({
              id: p.kind,
              label: tb.kinds[p.kind],
              count: p.n,
              tone: KIND_TONE[p.kind],
              glyph: 'solid',
            }))}
          />
          <KeyValueGrid
            min="6rem"
            items={[
              { k: tb.metrics.answers, v: <Figure value={answered} reduced={reduced} testId="dossier-answered" /> },
              { k: tb.metrics.observations, v: <Figure value={observations} reduced={reduced} /> },
              {
                k: tb.metrics.lastTrained,
                v: lastTrainedAt ? <RelativeTime timestamp={lastTrainedAt} /> : tb.metrics.neverTrained,
              },
            ]}
          />
        </div>
      </div>
      <span className="typo-label dossier-key k-in">{tb.metrics.goals}</span>
      <GoalRows goals={goals} onOpen={(goalId) => onOpenDetail('training', goalId)} reduced={reduced} />
    </div>
  );
}
