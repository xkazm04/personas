/**
 * PeekRow — one decision in the peek: tier mark, title, source, age.
 *
 * Built on the kit's `ListRow` (fixed height, one pressable name, the selected
 * band), so the peek list is the app's row and not a fourth hand-rolled one.
 * The focused row is the kit's `selected` state; pressing it opens the item.
 */
import { memo } from 'react';

import { ListRow, type Tone } from '@/features/shared/components/kit';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import type { DecisionItem, DecisionTier } from '../model/decisionModel';
import { decisionTier } from '../model/decisionOrder';

const TIER_TONE: Record<DecisionTier, Tone> = { 1: 'error', 2: 'warning', 3: 'info' };

export const PeekRow = memo(function PeekRow({
  item, focused, armed, onOpen,
}: {
  item: DecisionItem;
  focused: boolean;
  /** R was pressed on this row; Enter will reject it. */
  armed: boolean;
  onOpen: (item: DecisionItem) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const tier = decisionTier(item);
  const tierLabel = tier === 1 ? m.dc_hub_tier_blocking : tier === 2 ? m.dc_hub_tier_decide : m.dc_hub_tier_read;
  const severity = item.severity ? ` · ${item.severity}` : '';

  return (
    <ListRow
      size="s"
      mark={{ tone: armed ? 'error' : TIER_TONE[tier], glyph: tier === 1 ? 'solid' : 'soft', label: `${tierLabel}${severity}` }}
      name={item.title}
      meta={armed ? tx(m.dc_hub_reject_armed, { verdict: item.verdictLabels.reject }) : item.source.label}
      time={item.createdAt ? <RelativeTime timestamp={item.createdAt} /> : undefined}
      state={focused ? 'selected' : undefined}
      onPress={() => onOpen(item)}
      testId={`decision-peek-row-${item.id}`}
    />
  );
});
