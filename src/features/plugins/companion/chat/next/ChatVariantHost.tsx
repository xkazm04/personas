/**
 * ChatVariantHost — renders the chat prototype picked in the switcher: the
 * Frame · Halo layout with the Spread slots (right panel + decision stage, see
 * `frame/slots.ts`). Owner kept Spread and Current on 2026-09-23 and picked the
 * Oracle card body on 2026-09-24.
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import type { AthenaChatEngine } from '../athenaChatEngine';
import type { ChatVariant } from './ChatVariantTabs';
import { VariantFrame } from './frame/VariantFrame';
import type { HaloSlots } from './frame/slots';
import { HALO_C_SLOTS } from './frame/variants/c';

// The Spread layout with the Oracle card body (owner's pick, 2026-09-24).
const SLOTS: Record<Exclude<ChatVariant, 'current'>, HaloSlots> = {
  spread: HALO_C_SLOTS,
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
