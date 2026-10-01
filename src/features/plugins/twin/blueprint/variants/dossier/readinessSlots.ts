/**
 * Dossier (WP9): the four readiness slots the twin is scored on, their glyph
 * per status (set solid, partly set soft, not set hollow) and their labels.
 */
import type { Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { ReadinessSlot, ReadinessStatus } from '../../blueprintContract';

export const READINESS_SLOTS: readonly ReadinessSlot[] = ['identity', 'tone', 'channels', 'memories'];

export const SLOT_MARK: Record<ReadinessStatus, { tone: Tone; glyph: 'solid' | 'soft' | 'hollow' }> = {
  set: { tone: 'success', glyph: 'solid' },
  partial: { tone: 'warning', glyph: 'soft' },
  empty: { tone: 'neutral', glyph: 'hollow' },
};

export function useSlotLabels(): { slotLabel: Record<ReadinessSlot, string>; statusLabel: Record<ReadinessStatus, string> } {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const copy = tb.variantCopy.dossier;
  return {
    slotLabel: { identity: tb.sections.identity, tone: t.twin.slots.tone, channels: tb.metrics.channels, memories: tb.metrics.memories },
    statusLabel: { set: copy.slotSet, partial: copy.slotPartial, empty: copy.slotEmpty },
  };
}
