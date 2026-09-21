// AccountRows — the body of the usage strip: ONE ROW PER ACCOUNT, across every
// provider, each a single 28px line:
//
//   <provider mark>  <account>  <5h: timer · percent · pace>  <7d: calendar · percent · pace>
//   ═══════════ 7-day utilisation, as the row's bottom border ═══════════
//
// WHAT IS DELIBERATELY NOT HERE.
//   • NO STATUS ICONS. No check mark, no slot number, no power glyph, no shield.
//     The LIVE plan is said by emphasis alone — full opacity and a medium-weight
//     name — and a standby plan recedes to 60% until hovered or focused. A plan
//     that cannot be read says why IN WORDS, in the account slot.
//   • NO 5-HOUR BAR. The session window is a number and a pace glyph.
//   • ONE BAR ONLY: the 7-day window, drawn as a 2px fill along the row's bottom
//     edge in that window's tone (`FILL`). It is `aria-hidden` — the 7-day cluster
//     carries the sentence.
//
// EVERY CLUSTER SPEAKS A FULL SENTENCE (`windowSentence`: name, percent, reset
// countdown, pace, "Estimated") as its accessible name and its tooltip, because
// what is painted is three glyphs wide.
//
// THE ACTS ARE UNCHANGED. An inactive Claude plan that can be switched to is a
// clickable row — the account name is the real `<button>`, so the keyboard
// reaches it — and the switch still goes through its confirm, because it changes
// which plan the CLI's next message bills to. Forget is offered only where it is
// the honest act (a plan nothing could be read for), as a hover/focus-revealed
// icon button at the row's end: an ACTION, not a status. Codex and Grok rows are
// observed, never driven: no switch, no forget.
//
// A PROVIDER WITH NOTHING TO METER IS STILL ONE ROW: its mark, and the reason in
// words ("Not installed", "No sessions yet") where the account would be. Never a
// zeroed meter — 0% is a reading, and "not installed" is not.

import { useCallback, useState, type MouseEvent } from 'react';
import { CalendarDays, Timer, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { GhostRow, ROW_BOX } from './UsageStripShell';
import {
  FILL, PACE_ICON, PACE_TONE, TONE_TEXT, cliReasonHint, cliReasonLabel, providerName, reasonLabel, windowSentence,
} from './usageBits';
import { ProviderIcon } from './usage/ProviderIcon';
import {
  windowIn, type PlanModel, type ProviderModel, type ResourceModel, type WindowModel,
} from './usage/useResourceModel';

interface Props {
  model: ResourceModel;
  onSwitch: (id: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
}

type Pending = { kind: 'switch' | 'remove'; plan: PlanModel } | null;

/** The provider's mark, named: "OpenAI Codex 0.41.0", plus — for an observed CLI — that it is read-only and how fresh. */
function ProviderMark({ provider }: { provider: ProviderModel }) {
  const { t } = useTranslation();
  const name = providerName(t, provider.id);
  const label = provider.version ? `${name} ${provider.version}` : name;
  const tip = provider.readOnly ? (
    <span className="flex max-w-xs flex-col gap-0.5">
      <span>{label}</span>
      <span className="opacity-70">{t.monitor.usage_read_only_hint}</span>
      {provider.plans.length > 0 && (
        <span className="opacity-70">
          {provider.asOfMs === null
            ? t.monitor.usage_cli_never_reported
            : <>{t.monitor.usage_cli_reported} <RelativeTime timestamp={provider.asOfMs} /></>}
        </span>
      )}
    </span>
  ) : label;
  return (
    <Tooltip content={tip}>
      <span role="img" aria-label={label} className="inline-flex flex-shrink-0 items-center text-foreground" data-testid="fleet-usage-provider">
        <ProviderIcon provider={provider.id} />
      </span>
    </Tooltip>
  );
}

const CLUSTER_BOX = 'inline-flex w-[4.75rem] flex-shrink-0 items-center gap-1 typo-caption';

/** One window as three glyphs: its icon, the percent in its tone, the pace. No bar. */
function WindowCluster({
  w, slot, projectedHint,
}: {
  w: WindowModel | null;
  slot: 'short' | 'long';
  /** Why the figure is an estimate, when it is one. */
  projectedHint: string | null;
}) {
  const { t, tx } = useTranslation();
  const Icon = slot === 'short' ? Timer : CalendarDays;
  if (!w) {
    // The plan has no such window (Codex reports one, not two): the column
    // keeps its width so the rows stay aligned, and says so rather than "0%".
    return (
      <Tooltip content={t.monitor.usage_window_none}>
        <span
          role="img"
          aria-label={t.monitor.usage_window_none}
          className={`${CLUSTER_BOX} text-foreground opacity-40`}
          data-testid="fleet-usage-window"
          data-window={slot}
          data-empty
        >
          <Icon className="h-3 w-3 flex-shrink-0" aria-hidden />
          <span aria-hidden className="flex-1 text-right">—</span>
          <span className="w-3.5 flex-shrink-0" />
        </span>
      </Tooltip>
    );
  }
  const sentence = windowSentence(t, tx, w);
  const Pace = w.pace ? PACE_ICON[w.pace] : null;
  return (
    <Tooltip
      content={w.projected && projectedHint ? (
        <span className="flex max-w-xs flex-col gap-0.5">
          <span>{sentence}</span>
          <span className="opacity-70">{projectedHint}</span>
        </span>
      ) : sentence}
    >
      <span
        role="img"
        aria-label={sentence}
        className={`${CLUSTER_BOX} text-foreground`}
        data-testid="fleet-usage-window"
        data-window={slot}
        data-tone={w.tone}
        data-approx={w.projected || undefined}
      >
        <Icon className="h-3 w-3 flex-shrink-0 opacity-60" aria-hidden />
        <span
          className={`inline-flex flex-1 items-baseline justify-end tabular-nums ${TONE_TEXT[w.tone]} ${w.projected ? 'opacity-70' : ''}`}
          data-testid="fleet-usage-percent"
        >
          {w.projected && <span aria-hidden>≈</span>}
          <Numeric value={w.usedPct} unit="percent" precision={0} />
        </span>
        <span className={`inline-flex w-3.5 flex-shrink-0 items-center justify-center ${w.pace ? PACE_TONE[w.pace] : ''}`}>
          {Pace && <Pace className="h-3.5 w-3.5" aria-hidden data-testid="fleet-usage-pace" data-pace={w.pace} />}
        </span>
      </span>
    </Tooltip>
  );
}

/** The row's bottom border: the 7-day window as a 2px fill. An empty track when the plan has none. */
function WeekBorder({ w }: { w: WindowModel | null }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-border/40"
      data-testid="fleet-usage-week-track"
    >
      {w && (
        <span
          className={`block h-full transition-[width] duration-500 motion-reduce:transition-none ${FILL[w.tone]} ${w.projected ? 'opacity-50' : ''}`}
          style={{ width: `${w.usedPct}%` }}
          data-testid="fleet-usage-week-fill"
          data-tone={w.tone}
        />
      )}
    </span>
  );
}

function PlanRow({
  provider, plan, recede, ask,
}: {
  provider: ProviderModel;
  plan: PlanModel;
  /** A standby plan beside a known live one — sit back until looked at. */
  recede: boolean;
  ask: (kind: 'switch' | 'remove', plan: PlanModel) => void;
}) {
  const { t, tx, language } = useTranslation();
  const short = windowIn(plan, 'short');
  const long = windowIn(plan, 'long');
  const name = plan.name ?? (provider.readOnly ? providerName(t, provider.id) : t.monitor.usage_plan_live_login);
  const trouble = plan.state === 'quarantined' || plan.state === 'unreadable';
  const troubleLabel = plan.state === 'quarantined' ? t.monitor.usage_accounts_quarantined : t.monitor.usage_unavailable;
  const troubleHint = plan.state === 'quarantined' ? t.monitor.usage_accounts_quarantined_hint : reasonLabel(t, plan.reason);
  const projectedHint = plan.state !== 'projected'
    ? null
    : provider.readOnly
      ? t.monitor.usage_cli_projected_hint
      // The app's language, not the host OS locale (timestamp-display).
      : tx(t.monitor.usage_projected_hint, { time: new Date(plan.asOfMs ?? 0).toLocaleString(language) });
  const canSwitch = !provider.readOnly && plan.canSwitch;
  const canRemove = !provider.readOnly && plan.canRemove;
  const nameClass = `min-w-0 truncate text-left typo-body text-foreground ${plan.isActive ? 'font-medium' : ''}`;

  const onSwitch = (e: MouseEvent) => {
    e.stopPropagation();
    ask('switch', plan);
  };

  return (
    <div
      role="group"
      aria-label={[providerName(t, provider.id), name, trouble ? troubleLabel : null].filter(Boolean).join(' · ')}
      // Pointer convenience only: the whole row is the target. The keyboard's
      // door is the account-name <button> inside it, which carries the act's name.
      onClick={canSwitch ? onSwitch : undefined}
      className={`${ROW_BOX} group/row transition-opacity ${
        recede ? 'opacity-60 hover:opacity-100 focus-within:opacity-100' : ''
      } ${canSwitch ? 'cursor-pointer hover:bg-secondary/20' : ''}`}
      data-testid="fleet-usage-account"
      data-provider={provider.id}
      data-account={plan.id}
      data-active={plan.isActive}
      data-state={plan.state}
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
        {trouble && (
          <Tooltip content={troubleHint}>
            <span className="flex-shrink-0 whitespace-nowrap typo-caption text-status-warning" data-testid="fleet-usage-trouble">
              {troubleLabel}
            </span>
          </Tooltip>
        )}
      </span>
      {!trouble && (
        <>
          <WindowCluster w={short} slot="short" projectedHint={projectedHint} />
          <WindowCluster w={long} slot="long" projectedHint={projectedHint} />
        </>
      )}
      {canRemove && (
        <Tooltip content={t.monitor.usage_accounts_remove_hint}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ask('remove', plan);
            }}
            aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: name })}
            className="focus-ring inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-interactive text-foreground opacity-0 hover:text-status-error focus-visible:opacity-100 group-hover/row:opacity-70 group-focus-within/row:opacity-70"
            data-testid="fleet-usage-remove"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        </Tooltip>
      )}
      <WeekBorder w={long} />
    </div>
  );
}

/** A provider with nothing to meter: its mark, and why, in words. Still one row. */
function EmptyProviderRow({ provider }: { provider: ProviderModel }) {
  const { t } = useTranslation();
  const reason = provider.emptyReason ?? 'unreadable';
  const label = cliReasonLabel(t, reason);
  return (
    <div
      role="group"
      aria-label={`${providerName(t, provider.id)} · ${label}`}
      className={ROW_BOX}
      data-testid="fleet-usage-empty"
      data-provider={provider.id}
      data-reason={reason}
    >
      <ProviderMark provider={provider} />
      <Tooltip content={cliReasonHint(t, reason)}>
        <span className="min-w-0 flex-1 truncate typo-body text-foreground opacity-60">{label}</span>
      </Tooltip>
      <WeekBorder w={null} />
    </div>
  );
}

export function AccountRows({ model, onSwitch, onRemove }: Props) {
  const { t, tx } = useTranslation();
  const [pending, setPending] = useState<Pending>(null);
  const cancel = useCallback(() => setPending(null), []);
  const ask = useCallback((kind: 'switch' | 'remove', plan: PlanModel) => setPending({ kind, plan }), []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    try {
      if (pending.kind === 'switch') await onSwitch(pending.plan.id);
      else await onRemove(pending.plan.id);
    } finally {
      setPending(null);
    }
  }, [pending, onSwitch, onRemove]);

  const email = pending?.plan.name ?? '';
  const loading = model.providers.some((p) => p.pending);
  return (
    <>
      {model.providers.map((provider) => {
        // A read that has not settled: a ghost row under the permanent header — never a spinner.
        if (provider.pending) return <GhostRow key={provider.id} />;
        if (provider.plans.length === 0) return <EmptyProviderRow key={provider.id} provider={provider} />;
        // Receding exists to make the LIVE plan stand out. Where no plan is known
        // to be live (an install whose CLI never wrote an account uuid; a read-only
        // CLI, which has no such notion) nothing recedes — dimming every row would
        // read as "every plan is stale" rather than "we cannot tell which is live".
        const hasActive = provider.plans.some((p) => p.isActive);
        return provider.plans.map((plan) => (
          <PlanRow
            key={`${provider.id}:${plan.id}`}
            provider={provider}
            plan={plan}
            recede={hasActive && !plan.isActive}
            ask={ask}
          />
        ));
      })}
      {/* Mounted for the strip's lifetime; only its TEXT is conditional, so the announcement has a change to fire on. */}
      <span className="sr-only" role="status">{loading ? t.monitor.usage_loading : ''}</span>

      {pending?.kind === 'switch' && (
        <ConfirmDialog
          title={tx(t.monitor.usage_accounts_switch_title, { email })}
          body={t.monitor.usage_accounts_switch_body}
          confirmLabel={t.monitor.usage_accounts_switch}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
      {pending?.kind === 'remove' && (
        <ConfirmDialog
          danger
          title={tx(t.monitor.usage_accounts_remove_title, { email })}
          body={t.monitor.usage_accounts_remove_body}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
    </>
  );
}

export default AccountRows;
