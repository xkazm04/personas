/**
 * Dossier (WP9), the Knowledge board (L2): the memory counts as lead figures
 * (approved drawn against the count at which the section reads full), the
 * memories again as one large apportioned strip, the facts, the proposals
 * waiting from learn-from-sample, and the knowledge-base binding.
 */
import { Dot, KeyValueGrid, StatStrip, UnitStrip, apportion, quantumFor } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { TwinBlueprintModel } from '../../../blueprintContract';
import { KNOWLEDGE_FULL_AT } from '../../../sectionMetrics';
import { memoriesUnmeasured } from '../dossierModel';
import { Figure, NotMeasured } from '../Figure';
import { PipMeter } from '../PipMeter';

/** Units per row of the large strip, three rows. */
const BOARD_UNITS_PER_ROW = 40;

export function KnowledgeBoard({ model, reduced }: { model: TwinBlueprintModel; reduced: boolean }) {
  const { t, tx } = useTranslation();
  const tb = t.twin.blueprint;
  const copy = tb.variantCopy.dossier;
  const { memories, facts, kbBound } = model.knowledge;
  const fig = (value: number | null, testId?: string) => <Figure value={value} reduced={reduced} className="typo-data-lg" testId={testId} />;
  const spoken = (n: number | null) => (n === null ? tb.states.notMeasured : n);

  const approved = memories.approved;
  const total = (memories.approved ?? 0) + (memories.pending ?? 0) + (memories.rejected ?? 0);
  const quantum = quantumFor(total, BOARD_UNITS_PER_ROW * 3);

  return (
    <div className="dossier-board" data-testid="dossier-board-knowledge">
      <StatStrip
        tiles={[
          {
            label: tb.metrics.approved,
            value: fig(approved, 'dossier-mem-approved'),
            draw:
              approved === null ? undefined : (
                <PipMeter value={approved} slots={KNOWLEDGE_FULL_AT} tone="success" size="m" bare reduced={reduced}
                  label={tx(copy.fullAt, { count: KNOWLEDGE_FULL_AT })} />
              ),
            note: tx(copy.fullAt, { count: KNOWLEDGE_FULL_AT }),
          },
          { label: tb.metrics.awaiting, value: fig(memories.pending, 'dossier-mem-pending') },
          { label: tb.metrics.rejected, value: fig(memories.rejected, 'dossier-mem-rejected') },
          { label: tb.metrics.facts, value: fig(facts, 'dossier-facts') },
          { label: tb.metrics.samplesOpen, value: fig(model.samples.open, 'dossier-samples-open') },
        ]}
      />
      <div className="dossier-line k-in">
        {memoriesUnmeasured(memories) ? (
          <NotMeasured width="var(--dz-mem-lg-w)" height="var(--dz-mem-lg-h)" testId="dossier-memories-none" />
        ) : (
          <UnitStrip
            size="l"
            rows={3}
            label={tx(copy.memoriesAria, { approved: spoken(memories.approved), pending: spoken(memories.pending), rejected: spoken(memories.rejected) })}
            legend={quantum > 1 ? tx(copy.memoryUnit, { count: quantum }) : undefined}
            segments={apportion(
              [
                { value: memories.approved ?? 0, tone: 'success' },
                { value: memories.pending ?? 0, tone: 'pending' },
                { value: memories.rejected ?? 0, tone: 'error', glyph: 'soft' },
              ],
              quantum,
            )}
          />
        )}
      </div>
      <KeyValueGrid
        items={[
          {
            k: tb.metrics.knowledgeBase,
            draw: <Dot tone={kbBound ? 'success' : 'neutral'} glyph={kbBound ? 'solid' : 'hollow'} />,
            v: <span data-testid="dossier-kb" data-bound={kbBound ? 'true' : 'false'}>{kbBound ? tb.metrics.kbBound : tb.metrics.kbUnbound}</span>,
          },
        ]}
      />
    </div>
  );
}
