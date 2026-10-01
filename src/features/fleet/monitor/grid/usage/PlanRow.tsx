// PlanRow — ONE account's row: provider mark, account, the two window clusters,
// and the 7-day window as the bottom border. The row grammar and its negative
// space (no status icons, one bar) are documented on `AccountRows`.
//
// A CLAUDE PLAN THAT NEEDS SIGNING IN AGAIN speaks in words beside the name and
// swaps its clusters for the re-login acts (`reloginView`): "Needs login" +
// Re-login; the running step; the reason a human is needed + Re-login + Open
// sign-in window; the brief "Signed in again". Such a row spans two grid cells
// (the acts do not fit one; nor does "Signed in again" beside the meters) and is
// still never switchable while the plan is dead.

import type { MouseEvent } from 'react';
import { Settings2, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ROW_ACTIVE, ROW_BOX, ROW_REST } from '../UsageStripShell';
import { providerName, reasonLabel } from '../usageBits';
import { ReloginControls } from './ReloginControls';
import { ReloginStatus } from './ReloginStatus';
import { ProviderMark, STATS_GROUP, WeekBorder, WindowCluster } from './RowParts';
import { reloginView, type ReloginView } from './reloginModel';
import type { ReloginActs } from './reloginActs';
import { windowIn, type PlanModel, type ProviderModel } from './useResourceModel';

/** A hover-revealed icon act at the row's end: zero width until the row is looked at. */
const REVEAL_ACT = 'focus-ring inline-flex h-5 w-0 flex-shrink-0 items-center justify-center overflow-hidden rounded-interactive text-foreground opacity-0 focus-visible:w-5 focus-visible:opacity-100 group-hover/row:w-5 group-hover/row:opacity-70 group-focus-within/row:w-5 group-focus-within/row:opacity-70';

/** The same reveal on a shared `Button`: its icon size is overridden (important) to 0 and opened with the row. */
const REVEAL_BUTTON = '!h-5 !w-0 !flex-shrink-0 overflow-hidden !p-0 opacity-0 focus-visible:!w-5 focus-visible:opacity-100 group-hover/row:!w-5 group-hover/row:opacity-70 group-focus-within/row:!w-5 group-focus-within/row:opacity-70';

const NO_RELOGIN: ReloginView = { kind: 'none' };

export function PlanRow({
  provider, plan, recede, ask, acts, now, onSettings,
}: {
  provider: ProviderModel;
  plan: PlanModel;
  /** A standby plan beside a known live one: sit back until looked at. */
  recede: boolean;
  ask: (kind: 'switch' | 'remove', plan: PlanModel) => void;
  acts: ReloginActs;
  now: number;
  onSettings: (plan: PlanModel) => void;
}) {
  const { t, tx, language } = useTranslation();
  const short = windowIn(plan, 'short');
  const long = windowIn(plan, 'long');
  const name = plan.name ?? (provider.readOnly ? providerName(t, provider.id) : t.monitor.usage_plan_live_login);
  const view = provider.readOnly ? NO_RELOGIN : reloginView(plan, now);
  const quarantined = plan.state === 'quarantined';
  const trouble = quarantined || plan.state === 'unreadable';
  // While a run speaks (or a human is needed) it speaks INSTEAD of "Needs login".
  const speaking = view.kind === 'running' || view.kind === 'needs_you' || view.kind === 'done';
  const troubleLabel = quarantined ? t.monitor.usage_accounts_quarantined : t.monitor.usage_unavailable;
  const troubleHint = quarantined ? t.monitor.usage_accounts_quarantined_hint : reasonLabel(t, plan.reason);
  const showControls = view.kind === 'idle' || view.kind === 'running' || view.kind === 'needs_you';
  // The acts, and the words beside the name, do not fit one grid cell.
  const wide = showControls || view.kind === 'done';
  const projectedHint = plan.state !== 'projected'
    ? null
    : provider.readOnly
      ? t.monitor.usage_cli_projected_hint
      // The app's language, not the host OS locale (timestamp-display).
      : tx(t.monitor.usage_projected_hint, { time: new Date(plan.asOfMs ?? 0).toLocaleString(language) });
  const canSwitch = !provider.readOnly && plan.canSwitch;
  const canRemove = !provider.readOnly && plan.canRemove;
  const canConfigure = !provider.readOnly && plan.slot !== null;
  const nameClass = `min-w-0 truncate text-left typo-body text-foreground ${plan.isActive ? 'font-medium' : ''}`;
  const troubleAria = trouble && !speaking ? troubleLabel : null;

  const onSwitch = (e: MouseEvent) => {
    e.stopPropagation();
    ask('switch', plan);
  };

  return (
    <div
      role="group"
      aria-label={[providerName(t, provider.id), name, troubleAria].filter(Boolean).join(' · ')}
      // Pointer convenience only: the whole row is the target. The keyboard's
      // door is the account-name <button> inside it, which carries the act's name.
      onClick={canSwitch ? onSwitch : undefined}
      className={`${ROW_BOX} ${plan.isActive ? ROW_ACTIVE : ROW_REST} group/row transition-[opacity,background-color] ${
        recede ? 'opacity-60 hover:opacity-100 focus-within:opacity-100' : ''
      } ${canSwitch ? 'cursor-pointer hover:bg-black/30' : ''} ${wide ? 'col-span-2' : ''}`}
      data-testid="fleet-usage-account"
      data-provider={provider.id}
      data-account={plan.id}
      data-active={plan.isActive}
      data-state={plan.state}
      data-relogin={view.kind}
    >
      <ProviderMark provider={provider} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <Tooltip content={canSwitch ? `${name} · ${t.monitor.usage_accounts_switch}` : name}>
          {canSwitch ? (
            <button
              type="button"
              onClick={onSwitch}
              aria-label={tx(t.monitor.usage_accounts_switch_aria, { email: name })}
              className={`focus-ring rounded-interactive ${nameClass}`}
              data-testid="fleet-usage-switch"
            >
              {name}
            </button>
          ) : (
            <span className={nameClass} data-testid="fleet-usage-name">{name}</span>
          )}
        </Tooltip>
        {trouble && !speaking && (
          <Tooltip content={troubleHint}>
            <span className="flex-shrink-0 whitespace-nowrap typo-caption text-status-warning" data-testid="fleet-usage-trouble">
              {troubleLabel}
            </span>
          </Tooltip>
        )}
        <ReloginStatus view={view} />
      </span>
      {(!trouble || canRemove || showControls || canConfigure) && (
        <span className={STATS_GROUP} data-testid="fleet-usage-stats">
          {!trouble && (
            <>
              <WindowCluster w={short} slot="short" projectedHint={projectedHint} />
              <WindowCluster w={long} slot="long" projectedHint={projectedHint} />
            </>
          )}
          {showControls && <ReloginControls view={view} plan={plan} email={name} acts={acts} />}
          {canConfigure && (
            <Tooltip content={t.monitor.usage_profile_settings}>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onSettings(plan);
                }}
                aria-label={tx(t.monitor.usage_profile_settings_aria, { email: name })}
                className={REVEAL_BUTTON}
                data-testid="fleet-usage-settings"
              >
                <Settings2 className="h-3 w-3 flex-shrink-0" aria-hidden />
              </Button>
            </Tooltip>
          )}
          {canRemove && (
            <Tooltip content={t.monitor.usage_accounts_remove_hint}>
              {/* Hidden, it takes NO width: the email gets it back. It opens on
                  row hover and on focus anywhere in the row; tabbing onto the
                  button is itself focus-within, so it is never a zero-width
                  focus target. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  ask('remove', plan);
                }}
                aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: name })}
                className={`${REVEAL_ACT} hover:text-status-error`}
                data-testid="fleet-usage-remove"
              >
                <Trash2 className="h-3 w-3 flex-shrink-0" aria-hidden />
              </button>
            </Tooltip>
          )}
        </span>
      )}
      <WeekBorder w={long} />
    </div>
  );
}

export default PlanRow;
