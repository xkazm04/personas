// AccountRows — the plan slots of the usage strip: one card per stored Claude
// login in its own fifth of the width, the active card highlighted. Each
// card carries the account on its header line and its 5-hour and 7-day
// meters beneath, each labelled by the WHOLE units left until that window
// resets ("3h", "<1d"). The one act a card has — become the live login — sits
// on the header behind a confirm, because a switch changes which plan the
// CLI's next message bills to.
//
// FORGETTING A PLAN is offered only where it is the honest act: a card whose
// usage could not be read (a dead refresh token, an account the endpoint
// rejects). A plan that reads fine is not clutter, it is a plan.

import { useCallback, useState } from 'react';
import { Check, ShieldOff, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AsyncButton } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ClaudeAccountView } from '@/lib/bindings/ClaudeAccountView';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import type { Translations } from '@/i18n/generated/types';
import { orderWindows } from './usageModel';
import { EmptySlots, METER_GRID, PlanCard } from './UsageStripShell';
import { MeterBar, PaceGlyph, reasonLabel, RemainingLabel, windowAria } from './usageBits';

interface Props {
  accounts: ClaudeAccountView[];
  now: number;
  onSwitch: (id: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
}

type Pending = { kind: 'switch' | 'remove'; account: ClaudeAccountView } | null;

/** One meter row inside a plan card. */
export function CardMeter({ w, now, t }: { w: ClaudeUsageWindow; now: number; t: Translations }) {
  return (
    <div className={`${METER_GRID} h-4`} data-testid="fleet-usage-window" data-window={w.key}>
      <RemainingLabel w={w} now={now} t={t} />
      <MeterBar w={w} now={now} t={t} showTone={false} />
      <PaceGlyph w={w} now={now} t={t} />
    </div>
  );
}

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
    <>
      {accounts.map((a) => {
        const windows = orderWindows(a.usage);
        const five = windows.find((w) => w.key === 'five_hour');
        const seven = windows.find((w) => w.key === 'seven_day');
        const quarantined = a.quarantineReason !== null;
        const unreadable = quarantined || a.usageReason !== null;
        const aria = [
          a.email,
          five ? windowAria(t, tx, five, now) : null,
          seven ? windowAria(t, tx, seven, now) : null,
          quarantined ? t.monitor.usage_accounts_quarantined : a.usageReason ? reasonLabel(t, a.usageReason) : null,
        ].filter(Boolean).join(' · ');
        return (
          <PlanCard
            key={a.id}
            active={a.isActive}
            dim={quarantined}
            data-testid="fleet-usage-account"
            data-account={a.id}
            data-active={a.isActive}
            data-quarantined={quarantined}
            aria-label={aria}
            header={
              <>
                {a.isActive ? (
                  <span className="inline-flex flex-shrink-0 items-center text-primary" aria-label={t.monitor.usage_accounts_active}>
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                ) : (
                  <span className="flex-shrink-0 tabular-nums text-foreground opacity-50">{a.slot}</span>
                )}
                <Tooltip content={a.displayName ? `${a.email} · ${a.displayName}` : a.email}>
                  <span className={`min-w-0 flex-1 truncate ${a.isActive ? 'text-foreground' : 'text-foreground opacity-80'}`}>
                    {a.email}
                  </span>
                </Tooltip>
                {!a.isActive && !quarantined && (
                  <AsyncButton
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setPending({ kind: 'switch', account: a });
                      return Promise.resolve();
                    }}
                    data-testid="fleet-usage-switch"
                  >
                    {t.monitor.usage_accounts_switch}
                  </AsyncButton>
                )}
                {unreadable && !a.isActive && (
                  <Tooltip content={t.monitor.usage_accounts_remove_hint}>
                    <button
                      type="button"
                      onClick={() => setPending({ kind: 'remove', account: a })}
                      aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: a.email })}
                      className="focus-ring inline-flex flex-shrink-0 items-center justify-center rounded-interactive text-foreground opacity-50 hover:text-status-error hover:opacity-100"
                      data-testid="fleet-usage-remove"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </Tooltip>
                )}
              </>
            }
          >
            {unreadable ? (
              <Tooltip content={quarantined ? t.monitor.usage_accounts_quarantined_hint : reasonLabel(t, a.usageReason)}>
                <span className="inline-flex h-[2.25rem] items-center gap-1 typo-caption text-status-warning">
                  <ShieldOff className="h-3 w-3" aria-hidden />
                  {quarantined ? t.monitor.usage_accounts_quarantined : t.monitor.usage_unavailable}
                </span>
              </Tooltip>
            ) : (
              <>
                {five ? <CardMeter w={five} now={now} t={t} /> : <div className="h-4" />}
                {seven ? <CardMeter w={seven} now={now} t={t} /> : <div className="h-4" />}
              </>
            )}
          </PlanCard>
        );
      })}
      <EmptySlots from={accounts.length} />

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
    </>
  );
}

export default AccountRows;
