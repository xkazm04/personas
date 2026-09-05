// AccountRows — the multi-plan mode of the usage strip: one row per stored
// Claude login, the active one marked, each with its 5-hour and 7-day meters,
// the 5-hour reset countdown, a pace glyph, and the one act a row has —
// become the live login. A confirm sits in front of it because a switch
// changes which plan the CLI's next message bills to, and the operator
// offered to confirm rather than have it silent.
//
// A quarantined row (dead refresh token) is dimmed and says "needs login";
// it cannot be switched to until the operator runs `claude login` for it and
// stores it again.

import { useCallback, useState } from 'react';
import { Check, ShieldOff, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AsyncButton } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ClaudeAccountView } from '@/lib/bindings/ClaudeAccountView';
import { orderWindows } from './usageModel';
import { countdownText, MeterBar, PaceGlyph, reasonLabel, windowLabel } from './usageBits';

/** slot · identity · 5h meter+% · 7d meter+% · reset · pace · action · forget */
const ROW_GRID =
  'grid grid-cols-[1.25rem_minmax(8rem,14rem)_1.5rem_5rem_2.5rem_1.5rem_5rem_2.5rem_minmax(0,1fr)_1rem_auto_1rem] items-center gap-x-2';

interface Props {
  accounts: ClaudeAccountView[];
  now: number;
  onSwitch: (id: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
}

type Pending = { kind: 'switch' | 'remove'; account: ClaudeAccountView } | null;

export function AccountRows({ accounts, now, onSwitch, onRemove }: Props) {
  const { t, tx } = useTranslation();
  const [pending, setPending] = useState<Pending>(null);
  const cancel = useCallback(() => setPending(null), []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    const { kind, account } = pending;
    try {
      if (kind === 'switch') await onSwitch(account.id);
      else await onRemove(account.id);
    } finally {
      setPending(null);
    }
  }, [pending, onSwitch, onRemove]);

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="fleet-usage-accounts">
      {accounts.map((a) => {
        const windows = orderWindows(a.usage);
        const five = windows.find((w) => w.key === 'five_hour');
        const seven = windows.find((w) => w.key === 'seven_day');
        const quarantined = a.quarantineReason !== null;
        const name = a.displayName ? `${a.email} · ${a.displayName}` : a.email;
        return (
          <div
            key={a.id}
            className={`${ROW_GRID} h-5 ${quarantined ? 'opacity-50' : ''}`}
            data-testid="fleet-usage-account"
            data-account={a.id}
            data-active={a.isActive}
            data-quarantined={quarantined}
          >
            {/* The slot, and the active mark in place of it on the live row. */}
            <span className="typo-caption tabular-nums text-foreground opacity-60">
              {a.isActive ? (
                <span className="inline-flex items-center text-primary" aria-label={t.monitor.usage_accounts_active}>
                  <Check className="h-3.5 w-3.5" aria-hidden />
                </span>
              ) : (
                a.slot
              )}
            </span>
            <span className={`truncate typo-caption ${a.isActive ? 'text-foreground' : 'text-foreground opacity-80'}`}>
              {name}
            </span>

            {five && !quarantined ? (
              <>
                <span className="typo-caption text-foreground opacity-60">{windowLabel(t, 'five_hour')}</span>
                <MeterBar w={five} t={t} showTone={false} />
              </>
            ) : (
              <><span /><span /><span /></>
            )}
            {seven && !quarantined ? (
              <>
                <span className="typo-caption text-foreground opacity-60">{windowLabel(t, 'seven_day')}</span>
                <MeterBar w={seven} t={t} showTone={false} />
              </>
            ) : (
              <><span /><span /><span /></>
            )}

            <span className="truncate typo-caption text-foreground opacity-60">
              {quarantined ? (
                <Tooltip content={t.monitor.usage_accounts_quarantined_hint}>
                  <span className="inline-flex items-center gap-1 text-status-warning opacity-100">
                    <ShieldOff className="h-3 w-3" aria-hidden />
                    {t.monitor.usage_accounts_quarantined}
                  </span>
                </Tooltip>
              ) : a.usageReason ? (
                <Tooltip content={reasonLabel(t, a.usageReason)}>
                  <span>{t.monitor.usage_unavailable}</span>
                </Tooltip>
              ) : five ? (
                countdownText(t, tx, five, now)
              ) : null}
            </span>

            {five && !quarantined ? <PaceGlyph w={five} now={now} t={t} /> : <span />}

            {a.isActive ? (
              <span className="typo-caption text-primary">{t.monitor.usage_accounts_active}</span>
            ) : (
              <AsyncButton
                size="xs"
                variant="secondary"
                disabled={quarantined}
                onClick={() => {
                  setPending({ kind: 'switch', account: a });
                  return Promise.resolve();
                }}
                data-testid="fleet-usage-switch"
              >
                {t.monitor.usage_accounts_switch}
              </AsyncButton>
            )}

            <button
              type="button"
              onClick={() => setPending({ kind: 'remove', account: a })}
              aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: a.email })}
              className="focus-ring inline-flex items-center justify-center rounded-interactive text-foreground opacity-40 hover:opacity-100"
              data-testid="fleet-usage-remove"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        );
      })}

      {pending && pending.kind === 'switch' && (
        <ConfirmDialog
          title={tx(t.monitor.usage_accounts_switch_title, { email: pending.account.email })}
          body={t.monitor.usage_accounts_switch_body}
          confirmLabel={t.monitor.usage_accounts_switch}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
      {pending && pending.kind === 'remove' && (
        <ConfirmDialog
          danger
          title={tx(t.monitor.usage_accounts_remove_title, { email: pending.account.email })}
          body={t.monitor.usage_accounts_remove_body}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
    </div>
  );
}

export default AccountRows;
