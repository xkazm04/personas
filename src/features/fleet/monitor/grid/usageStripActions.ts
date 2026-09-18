// usageStripActions — the usage strip's four acts, with their toasts.
//
// Each one wraps a `useClaudeAccounts` mutation in the same shape: do it, then
// say what happened in the operator's own words. They live here rather than in
// the component because they are the only part of the strip that talks to the
// backend at all, and because the SIMULATED strip replaces exactly this set —
// keeping them together makes the seam one object rather than four scattered
// closures.
//
// Note what each toast reports: the account the BACKEND came back with, never
// the one the click asked for. The strip never shows a switch it only
// requested (`useClaudeAccounts.accept` forces a read on every mutation).

import { useCallback } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { extractMessage, toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { ClaudeAutoRotateConfig } from '@/lib/bindings/ClaudeAutoRotateConfig';
import type { ClaudeAccountsState } from './useClaudeAccounts';

export interface UsageActions {
  capture: () => Promise<void>;
  switchTo: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  saveAutoRotate: (enabled: boolean, thresholdPct: number) => Promise<void>;
}

export function useUsageActions(accounts: ClaudeAccountsState): UsageActions {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const autoRotate = accounts.snapshot?.autoRotate ?? null;

  const capture = useCallback(async () => {
    try {
      const next = await accounts.capture();
      const mine = next.accounts.find((a) => a.id === next.activeAccountId);
      addToast(
        tx(t.monitor.usage_accounts_captured, {
          email: mine?.email ?? next.liveEmail ?? '',
          slot: mine?.slot ?? '',
        }),
        'success',
      );
    } catch (err) {
      // Capture runs unprompted now (`useAutoCapture`), so a failure must reach
      // Sentry as well as the operator: toastCatch, not a bare toast.
      toastCatch('monitor/usageStrip:capture', tx(t.monitor.usage_accounts_capture_failed, { error: extractMessage(err) }))(err);
    }
  }, [accounts, addToast, t, tx]);

  const switchTo = useCallback(
    async (id: string) => {
      try {
        const next = await accounts.switchTo(id);
        const target = next.accounts.find((a) => a.id === id);
        addToast(tx(t.monitor.usage_accounts_switched, { email: target?.email ?? '' }), 'success');
      } catch (err) {
        addToast(tx(t.monitor.usage_accounts_switch_failed, { error: extractMessage(err) }), 'error');
      }
    },
    [accounts, addToast, t, tx],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await accounts.remove(id);
      } catch (err) {
        addToast(tx(t.monitor.usage_accounts_capture_failed, { error: extractMessage(err) }), 'error');
      }
    },
    [accounts, addToast, t, tx],
  );

  const saveAutoRotate = useCallback(
    async (enabled: boolean, thresholdPct: number) => {
      if (!autoRotate) return;
      try {
        await accounts.setAutoRotate({ ...autoRotate, enabled, thresholdPct } satisfies ClaudeAutoRotateConfig);
        addToast(enabled ? t.monitor.usage_auto_rotate_on : t.monitor.usage_auto_rotate_off, 'success');
      } catch (err) {
        addToast(tx(t.monitor.usage_auto_rotate_failed, { error: extractMessage(err) }), 'error');
      }
    },
    [accounts, autoRotate, addToast, t, tx],
  );

  return { capture, switchTo, remove, saveAutoRotate };
}
