// The ledger's one keyboard door: a route-level handler on the app keyboard
// ladder that filters what the ledger must not steal (text fields, dialogs,
// modifier chords, Enter on a focused control) and hands every recognised
// key to the caller as a command.
import { useCallback } from 'react';

import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import { resolveLedgerKey, shouldIgnoreKey, type LedgerCommand, type LedgerLayer } from './model/ledgerKeys';

export function useLedgerKeys(
  layer: LedgerLayer,
  onCommand: (command: LedgerCommand) => void,
  enabled = true,
): void {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (shouldIgnoreKey(e)) return false;
      const command = resolveLedgerKey(layer, e.key);
      if (!command) return false;
      e.preventDefault();
      onCommand(command);
      return true;
    },
    [layer, onCommand],
  );
  useAppKeyboard(handler, { enabled, priority: ROUTE_DECISION_PRIORITY });
}
