/**
 * ChatVariantHost — renders the chat prototype picked in the switcher: the
 * Frame · Halo layout with the Spread slots (right panel + decision stage, see
 * `frame/slots.ts`). Owner kept Spread and Current on 2026-09-23; R4 splits
 * Spread into three decision-card body treatments (spread-a/b/c).
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import type { AthenaChatEngine } from '../athenaChatEngine';
import type { ChatVariant } from './ChatVariantTabs';
import { VariantFrame } from './frame/VariantFrame';
import type { HaloSlots } from './frame/slots';
import { HALO_C_LEDGER_SLOTS, HALO_C_ORACLE_SLOTS, HALO_C_RUNES_SLOTS } from './frame/variants/c';

// R4 (2026-09-24): the Spread layout with three card-native body treatments.
const SLOTS: Record<Exclude<ChatVariant, 'current'>, HaloSlots> = {
  'spread-a': HALO_C_ORACLE_SLOTS,
  'spread-b': HALO_C_LEDGER_SLOTS,
  'spread-c': HALO_C_RUNES_SLOTS,
};

export function ChatVariantHost({
  variant,
  engine,
  lifted,
}: {
  variant: Exclude<ChatVariant, 'current'>;
  engine: AthenaChatEngine;
  lifted: boolean;
}) {
  // Keyed by variant so switching tabs resets the layer (expanded, open
  // decision) instead of carrying one variant's state into another's stage.
  return <VariantFrame key={variant} engine={engine} lifted={lifted} slots={SLOTS[variant]} />;
}
