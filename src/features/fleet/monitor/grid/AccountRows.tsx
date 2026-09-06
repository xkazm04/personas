// AccountRows — the multi-plan mode of the usage strip: one row per stored
// Claude login, divided from the next, the active one on a highlighted
// ground, each with its 5-hour and 7-day meters (fill = spent, marker = the
// clock, warming towards the reset), a pace glyph, and the one act a row has —
// become the live login. A confirm sits in front of it because a switch
// changes which plan the CLI's next message bills to.
//
// FORGETTING A PLAN is offered only where it is the honest act: a row whose
// usage could not be read (a dead refresh token, an account the endpoint
// rejects). A plan that reads fine is not clutter, it is a plan; the space it
// takes is the point of the strip.

import { useCallback, useState } from 'react';
import { Check, ShieldOff, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AsyncButton } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ClaudeAccountView } from '@/lib/bindings/ClaudeAccountView';
import { orderWindows } from './usageModel';
import { MeterBar, PaceGlyph, reasonLabel, windowAria, windowLabel } from './usageBits';

/** slot · identity · 5h label · meter · % · 7d label · meter · % · pace · action · forget */
const ROW_GRID =
  'grid grid-cols-[1.25rem_minmax(8rem,14rem)_1.5rem_minmax(4rem,1fr)_2.5rem_1.5rem_minmax(4rem,1fr)_2.5rem_1rem_auto_1rem] items-center gap-x-2';

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
    <div className="flex min-w-0 flex-col divide-y divide-border/60" data-testid="fleet-usage-accounts">
      {accounts.map((a) => {
        const windows = orderWindows(a.usage);
        const five = windows.find((w) => w.key === 'five_hour');
        const seven = windows.find((w) => w.key === 'seven_day');
        const quarantined = a.quarantineReason !== null;
        const unreadable = quarantined || a.usageReason !== null;
        const name = a.displayName ? `${a.email} · ${a.displayName}` : a.email;
        const aria = [
          name,
          five ? windowAria(t, tx, five, now) : null,
          seven ? windowAria(t, tx, seven, now) : null,
          quarantined ? t.monitor.usage_accounts_quarantined : a.usageReason ? reasonLabel(t, a.usageReason) : null,
        ].filter(Boolean).join(' · ');
        return (
          <div
            key={a.id}
            className={`${ROW_GRID} -mx-1.5 h-6 px-1.5 ${a.isActive ? 'rounded-interactive bg-primary/10' : ''} ${quarantined ? 'opacity-60' : ''}`}
            data-testid="fleet-usage-account"
            data-account={a.id}
            data-active={a.isActive}
            data-quarantined={quarantined}
            aria-label={aria}
          >
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

            {five && !unreadable ? (
              <>
                <span className="typo-caption text-foreground opacity-60">{windowLabel(t, 'five_hour')}</span>
                <MeterBar w={five} now={now} t={t} showTone={false} />
              </>
            ) : unreadable ? (
              <>
                <span />
                <span className="col-span-5 truncate typo-caption">
                  <Tooltip content={quarantined ? t.monitor.usage_accounts_quarantined_hint : reasonLabel(t, a.usageReason)}>
                    <span className="inline-flex items-center gap-1 text-status-warning">
                      <ShieldOff className="h-3 w-3" aria-hidden />
                      {quarantined ? t.monitor.usage_accounts_quarantined : t.monitor.usage_unavailable}
                    </span>
                  </Tooltip>
                </span>
              </>
            ) : (
              <><span /><span /><span /></>
            )}
            {!unreadable && (seven ? (
              <>
                <span className="typo-caption text-foreground opacity-60">{windowLabel(t, 'seven_day')}</span>
                <MeterBar w={seven} now={now} t={t} showTone={false} />
              </>
            ) : (
              <><span /><span /><span /></>
            ))}

            {five && !unreadable ? <PaceGlyph w={five} now={now} t={t} /> : <span />}

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

            {unreadable && !a.isActive ? (
              <Tooltip content={t.monitor.usage_accounts_remove_hint}>
                <button
                  type="button"
                  onClick={() => setPending({ kind: 'remove', account: a })}
                  aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: a.email })}
                  className="focus-ring inline-flex items-center justify-center rounded-interactive text-foreground opacity-50 hover:text-status-error hover:opacity-100"
                  data-testid="fleet-usage-remove"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </Tooltip>
            ) : (
              <span />
            )}
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
