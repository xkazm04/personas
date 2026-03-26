import { useMemo } from 'react';
import { getEventColor } from '@/lib/design/eventTokens';
import type { EventColorResult } from '@/lib/design/eventTokens';

/**
 * Returns consistent bg, text, border, and hex color classes
 * for a given event type and status from the centralized token system.
 */
export function useEventColor(eventType: string, status: string): EventColorResult {
  return useMemo(() => getEventColor(eventType, status), [eventType, status]);
}
