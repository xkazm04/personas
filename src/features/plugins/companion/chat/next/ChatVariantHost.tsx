/**
 * ChatVariantHost — renders the chat prototype picked in the switcher.
 * TODO(prototype, 2026-09-22): consolidate the Athena chat switcher.
 */

import type { AthenaChatEngine } from '../athenaChatEngine';
import type { ChatVariant } from './ChatVariantTabs';
import { VariantFrame } from './frame/VariantFrame';
import { VariantFused } from './fused/VariantFused';

export function ChatVariantHost({
  variant,
  engine,
  lifted,
}: {
  variant: Exclude<ChatVariant, 'current'>;
  engine: AthenaChatEngine;
  lifted: boolean;
}) {
  if (variant === 'fused') return <VariantFused engine={engine} lifted={lifted} />;
  return <VariantFrame engine={engine} lifted={lifted} lookId={variant} />;
}
