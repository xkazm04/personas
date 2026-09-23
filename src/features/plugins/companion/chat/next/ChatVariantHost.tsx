/**
 * ChatVariantHost — renders the chat prototype picked in the switcher. Every
 * non-Current tab is the Frame · Halo layout; the tab id picks its slots
 * (right panel + decision stage, see `frame/slots.ts`).
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import type { AthenaChatEngine } from '../athenaChatEngine';
import type { ChatVariant } from './ChatVariantTabs';
import { VariantFrame } from './frame/VariantFrame';
import type { HaloSlots } from './frame/slots';
import { BASE_SLOTS } from './frame/slots/base';
import { HALO_A_SLOTS } from './frame/variants/a';
import { HALO_B_SLOTS } from './frame/variants/b';
import { HALO_C_SLOTS } from './frame/variants/c';

const SLOTS: Record<Exclude<ChatVariant, 'current'>, HaloSlots> = {
  halo: BASE_SLOTS,
  'halo-a': HALO_A_SLOTS,
  'halo-b': HALO_B_SLOTS,
  'halo-c': HALO_C_SLOTS,
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
