/**
 * Dossier (WP9), Identity at a glance: the bio's length as a figure over its
 * strip against the target, the languages as chips, and (where there is room)
 * the four readiness slots as chips whose glyph says set, partly set or not set.
 */
import { ChipRow, type Chip } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { ReadinessSlot } from '../../../blueprintContract';
import { BioStrip } from '../BioStrip';
import { READINESS_SLOTS, SLOT_MARK, useSlotLabels } from '../readinessSlots';
import { Figure } from '../Figure';
import type { GlanceProps } from './glanceTypes';

export function IdentityGlance({ model, compact, roomy, spring, reduced }: GlanceProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const { slotLabel, statusLabel } = useSlotLabels();
  const { bioChars, bioTarget, languages } = model.identity;

  const slotChip = (slot: ReadinessSlot): Chip => {
    const status = model.readiness.slots[slot];
    return {
      id: slot,
      label: (
        <span data-slot={slot} data-status={status}>
          {slotLabel[slot]}
          <span className="sr-only">{statusLabel[status]}</span>
        </span>
      ),
      ...SLOT_MARK[status],
    };
  };

  return (
    <div className="dossier-glance" data-testid="dossier-identity">
      <div className="dossier-line k-in">
        <span className="typo-label dossier-key">{tb.metrics.bio}</span>
        <Figure value={bioChars} spring={spring} reduced={reduced} testId="dossier-bio-figure" />
      </div>
      <div className="dossier-line k-in">
        <BioStrip bioChars={bioChars} target={bioTarget} at={compact ? 'compact' : 'glance'} />
      </div>
      <div className="dossier-line k-in">
        <span className="typo-label dossier-key">{tb.metrics.languages}</span>
      </div>
      <ChipRow
        label={tb.metrics.languages}
        emptyLabel={tb.metrics.noLanguages}
        chips={languages.map((code) => ({ id: code, label: code.toUpperCase() }))}
      />
      {(!compact || roomy) && (
        <>
          <div className="dossier-line k-in">
            <span className="typo-label dossier-key">{tb.metrics.readiness}</span>
          </div>
          <ChipRow label={tb.metrics.readiness} emptyLabel={tb.states.notMeasured} chips={READINESS_SLOTS.map(slotChip)} />
        </>
      )}
    </div>
  );
}
