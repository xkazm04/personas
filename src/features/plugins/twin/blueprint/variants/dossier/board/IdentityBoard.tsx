/**
 * Dossier (WP9), the Identity board (L2): the bio as a lead figure over its
 * strip against the target, the languages, and the four readiness slots the
 * twin is scored on (set, partly set, not set) with the readiness score.
 */
import { ChipRow, Dot, KeyValueGrid, StatStrip } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { TwinBlueprintModel } from '../../../blueprintContract';
import { BioStrip } from '../BioStrip';
import { Figure } from '../Figure';
import { READINESS_SLOTS, SLOT_MARK, useSlotLabels } from '../readinessSlots';

export function IdentityBoard({ model, reduced }: { model: TwinBlueprintModel; reduced: boolean }) {
  const { t, tx } = useTranslation();
  const tb = t.twin.blueprint;
  const copy = tb.variantCopy.dossier;
  const { bioChars, bioTarget, languages } = model.identity;

  const { slotLabel, statusLabel } = useSlotLabels();

  const bioDraw = <BioStrip bioChars={bioChars} target={bioTarget} at="board" />;

  return (
    <div className="dossier-board dossier-board--split" data-testid="dossier-board-identity">
      <div className="dossier-board__col">
        <StatStrip
          tiles={[
            {
              label: tb.metrics.bio,
              value: <Figure value={bioChars} reduced={reduced} className="typo-data-lg" testId="dossier-bio-figure" />,
              draw: bioDraw,
              note: tx(copy.ofTarget, { count: bioTarget }),
            },
            {
              label: tb.metrics.languages,
              value: <Figure value={languages.length} reduced={reduced} className="typo-data-lg" />,
            },
          ]}
        />
        <ChipRow
          label={tb.metrics.languages}
          emptyLabel={tb.metrics.noLanguages}
          chips={languages.map((code) => ({ id: code, label: code.toUpperCase() }))}
        />
      </div>
      <div className="dossier-board__col">
        <StatStrip
          tiles={[{ label: tb.metrics.readiness, value: <Figure value={model.readiness.score / 100} unit="ratio" reduced={reduced} className="typo-data-lg" /> }]}
        />
        <KeyValueGrid
          min="9rem"
          items={READINESS_SLOTS.map((slot) => {
            const status = model.readiness.slots[slot];
            const mark = SLOT_MARK[status];
            return {
              k: slotLabel[slot],
              draw: <Dot tone={mark.tone} glyph={mark.glyph} />,
              v: <span data-slot={slot} data-status={status}>{statusLabel[status]}</span>,
            };
          })}
        />
      </div>
    </div>
  );
}
