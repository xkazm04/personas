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
 *
 * Round 5 (2026-10-07) adds three slots, `r5a` / `r5b` / `r5c`, each owning
 * its own layer like Filament (`frame/variants/r5{a,b,c}/index.tsx`).
 */

import type { AthenaChatEngine } from '../athenaChatEngine';
import type { ChatVariant } from './ChatVariantTabs';
import { VariantFrame } from './frame/VariantFrame';
import { HALO_C_SLOTS } from './frame/variants/c';
import { FilamentFrame } from './frame/variants/filament/FilamentFrame';
import { R5AFrame } from './frame/variants/r5a';
import { R5BFrame } from './frame/variants/r5b';
import { R5CFrame } from './frame/variants/r5c';

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
  switch (variant) {
    case 'filament':
      return <FilamentFrame key={variant} engine={engine} lifted={lifted} />;
    case 'spread':
      return <VariantFrame key={variant} engine={engine} lifted={lifted} slots={HALO_C_SLOTS} />;
    // Round 5's slots (2026-10-07), same props as Filament.
    case 'r5a':
      return <R5AFrame key={variant} engine={engine} lifted={lifted} />;
    case 'r5b':
      return <R5BFrame key={variant} engine={engine} lifted={lifted} />;
    case 'r5c':
      return <R5CFrame key={variant} engine={engine} lifted={lifted} />;
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}
