/**
 * ChatVariantHost — renders the chat variant picked in the switcher.
 *
 * FUSION (2026-10-07) is the owner's fusion of round 5 and the default
 * (`frame/variants/fusion/index.tsx`); Filament (`frame/variants/filament/`)
 * stays selectable beside it. Each owns its own layer over the app. Current
 * renders through the classic panel and never reaches this host. Halo ·
 * Spread and R5 · A / B / C were deleted on 2026-10-07 at the owner's
 * instruction after Fusion took the parts he wanted from them.
 */

import type { AthenaChatEngine } from '../athenaChatEngine';
import type { ChatVariant } from './ChatVariantTabs';
import { FilamentFrame } from './frame/variants/filament/FilamentFrame';
import { FusionFrame } from './frame/variants/fusion';

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
    case 'fusion':
      return <FusionFrame key={variant} engine={engine} lifted={lifted} />;
    case 'filament':
      return <FilamentFrame key={variant} engine={engine} lifted={lifted} />;
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}
