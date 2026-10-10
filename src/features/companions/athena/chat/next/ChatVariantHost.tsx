/**
 * ChatVariantHost — renders the chat variant picked in the switcher.
 *
 * Fusion (`frame/variants/fusion/index.tsx`) is the only variant that owns its
 * own layer over the app; Current renders through the classic panel and never
 * reaches this host. Spread, R5 · A / B / C and Filament were retired on
 * 2026-10-07 (see `ChatVariantTabs`).
 */

import type { AthenaChatEngine } from '../athenaChatEngine';
import type { ChatVariant } from './ChatVariantTabs';
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
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}
