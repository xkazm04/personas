import { useCallback, useEffect, useState } from 'react';
import type { RailTab } from './ConversationRail';

/**
 * Which face the right rail shows. It opens on Needs you; Drive on a
 * deliberation band switches it to that deliberation's controls; a new team or
 * persona puts it back on Needs you and forgets the driven deliberation (its
 * controls belong to the conversation they were opened from).
 */
export function useRailFocus(scopeKey: string | null) {
  const [tab, setTab] = useState<RailTab>('asks');
  const [focusDelib, setFocusDelib] = useState<string | null>(null);
  useEffect(() => {
    setFocusDelib(null);
    setTab('asks');
  }, [scopeKey]);
  const drive = useCallback((deliberationId: string) => {
    setFocusDelib(deliberationId);
    setTab('focus');
  }, []);
  return { tab, setTab, focusDelib, drive };
}
