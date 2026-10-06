/**
 * ChatVariantHost — renders the chat variant picked in the switcher.
 *
 * Filament owns its own layer (`frame/variants/filament/FilamentFrame.tsx`)
 * because its pieces sit on the window's bezel rather than inside
 * `VariantFrame`'s inset grid; Spread fills `VariantFrame`'s slots
 * (`frame/slots.ts`).
 *
 * FILAMENT IS THE DEFAULT as of 2026-10-06 - the owner confirmed it as the
 * `athena-chrome` winner. Current and Spread stay selectable because he is
 * setting up a separate fusion project and they are its inputs, so the usual
 * "the winner becomes the only render and the losers are deleted" rule is
 * explicitly suspended here rather than forgotten.
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
