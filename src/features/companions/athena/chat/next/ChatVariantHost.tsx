/**
 * ChatVariantHost — renders the chat prototype picked in the switcher. Spread
 * fills `VariantFrame`'s slots (`frame/slots.ts`); Filament owns its own layer
 * (`frame/variants/filament/FilamentFrame.tsx`) because its pieces sit on the
 * window's bezel rather than inside VariantFrame's inset grid. Owner kept
 * Spread and Current on 2026-09-23 and picked the Oracle card body on
 * 2026-09-24; Filament is the 2026-10-03 contest winner being ported.
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import type { AthenaChatEngine } from '../athenaChatEngine';
import type { ChatVariant } from './ChatVariantTabs';
import { VariantFrame } from './frame/VariantFrame';
import { HALO_C_SLOTS } from './frame/variants/c';
import { FilamentFrame } from './frame/variants/filament/FilamentFrame';

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
  if (variant === 'filament') return <FilamentFrame key={variant} engine={engine} lifted={lifted} />;
  return <VariantFrame key={variant} engine={engine} lifted={lifted} slots={HALO_C_SLOTS} />;
}
