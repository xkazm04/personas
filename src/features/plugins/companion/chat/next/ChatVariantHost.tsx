/**
 * ChatVariantHost — renders the two-layer prototype picked in the switcher.
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import type { AthenaChatEngine } from '../athenaChatEngine';
import type { ChatVariant } from './ChatVariantTabs';
import { VariantBoard } from './board/VariantBoard';
import { VariantRooms } from './rooms/VariantRooms';
import { VariantRoster } from './roster/VariantRoster';

export function ChatVariantHost({
  variant,
  engine,
  lifted,
}: {
  variant: Exclude<ChatVariant, 'current'>;
  engine: AthenaChatEngine;
  lifted: boolean;
}) {
  if (variant === 'board') return <VariantBoard engine={engine} lifted={lifted} />;
  if (variant === 'rooms') return <VariantRooms engine={engine} lifted={lifted} />;
  return <VariantRoster engine={engine} lifted={lifted} />;
}
