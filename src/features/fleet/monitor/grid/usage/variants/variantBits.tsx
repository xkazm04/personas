// variantBits — the vocabulary the four resource-strip variants share.
//
// The variants differ in INFORMATION ARCHITECTURE (lanes, a time axis, dials, a
// table) and must not differ in what a thing is called, which colour means
// trouble, or what happens when you press Switch. Everything that has to be the
// same across them lives here:
//
//   • COLOUR HAS TWO JOBS AND THEY NEVER SHARE A MARK. Provider tint (Claude =
//     primary, Codex = info, Grok = processing) is only ever painted on FRAMES
//     and NAMES. Tone (ok / warning / error at 75 / 90, `usageModel`) is only ever
//     painted on a FILL. A blue bar is therefore never "Codex", and a Codex frame
//     is never "fine".
//   • GEOMETRY IS SVG ATTRIBUTES OR `scaleX`, never a percent string — a meter is
//     a number, and numbers go through `Numeric` / `formatPercent` so 14 locales
//     each get their own separator and sign placement.
//   • A PROVIDER WITH NOTHING TO METER SAYS SO IN WORDS (`EmptyReason`). There is
//     no zeroed meter anywhere in these files: 0% is a reading, and "not
//     installed" is not.
//   • THE PLAN ACTS are the classic strip's own — same confirm dialogs, same
//     copy, same callbacks (`usePlanConfirm`), so a variant cannot switch a login
//     on a looser footing than `AccountRows` does.

import { useCallback, useState, type ReactNode } from 'react';
import { CircleSlash, History, Lock, ShieldOff, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { AsyncButton } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { formatPercent } from '@/lib/utils/formatters';
import type { CliUsageReason } from '@/lib/bindings/CliUsageReason';
import { formatCountdown, type MeterTone, type Pace } from '../../usageModel';
import { PACE_ICON, PACE_TONE, paceLabel, reasonLabel, windowHint, windowLabel } from '../../usageBits';
import type { PlanModel, ProviderId, ProviderModel, ResourceModel, WindowModel } from '../useResourceModel';

/** What the host hands every variant. The header (tabs, auto-rotate, refresh) is the host's. */
export interface UsageVariantProps {
  model: ResourceModel;
  onSwitch: (id: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  /** A simulated strip writes nothing to the backend. */
  simulated: boolean;
}

// Brand names: identical in every locale, so they are not catalogue entries.
export const PROVIDER_NAME: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok' };

export interface ProviderTint { text: string; border: string; wash: string; dot: string }

export const PROVIDER_TINT: Record<ProviderId, ProviderTint> = {
  claude: { text: 'text-primary', border: 'border-primary/40', wash: 'bg-primary/[0.06]', dot: 'bg-primary' },
  codex: { text: 'text-status-info', border: 'border-status-info/40', wash: 'bg-status-info/[0.06]', dot: 'bg-status-info' },
  grok: {
    text: 'text-status-processing', border: 'border-status-processing/40',
    wash: 'bg-status-processing/[0.06]', dot: 'bg-status-processing',
  },
};

/** Tone as a TEXT colour, for marks painted with `fill-current` / `stroke-current`. */
export const TONE_INK: Record<MeterTone, string> = {
  ok: 'text-primary',
  warning: 'text-status-warning',
  error: 'text-status-error',
};

const DAY_MINUTES = 24 * 60;

/** "5h" / "7d" / "7d Opus" — a window's short name, from its real length. */
export function windowTitle(t: Translations, w: WindowModel): string {
  if (w.label === 'opus' || w.label === 'sonnet') return windowLabel(t, w.key);
  if (w.windowMinutes >= DAY_MINUTES) return `${Math.round(w.windowMinutes / DAY_MINUTES)}${t.monitor.usage_unit_day}`;
  return `${Math.max(1, Math.round(w.windowMinutes / 60))}${t.monitor.usage_unit_hour}`;
}

/** "2h 14m" until the reset; an em dash when the window has none scheduled. */
export function resetText(t: Translations, w: WindowModel): string {
  if (w.remainingMs === null) return '—';
  return formatCountdown(w.remainingMs, {
    day: t.monitor.usage_unit_day,
    hour: t.monitor.usage_unit_hour,
    minute: t.monitor.usage_unit_minute,
    underMinute: t.monitor.usage_under_minute,
  });
}

/** The spoken sentence for one window. */
export function windowSentence(
  t: Translations, tx: (s: string, v: Record<string, string | number>) => string, w: WindowModel,
): string {
  const parts = [
    `${windowTitle(t, w)} ${formatPercent(w.usedPct, { precision: 0 })}`,
    w.remainingMs === null ? t.monitor.usage_resets_unknown : tx(t.monitor.usage_resets_in, { time: resetText(t, w) }),
  ];
  if (w.pace) parts.push(paceLabel(t, w.pace));
  if (w.projected) parts.push(t.monitor.usage_projected_short);
  return parts.join(' · ');
}

export function cliReasonLabel(t: Translations, reason: CliUsageReason): string {
  switch (reason) {
    case 'not_installed': return t.monitor.usage_cli_not_installed;
    case 'no_quota_source': return t.monitor.usage_cli_no_quota_source;
    case 'no_sessions': return t.monitor.usage_cli_no_sessions;
    case 'unreadable': return t.monitor.usage_cli_unreadable;
  }
}

export function cliReasonHint(t: Translations, reason: CliUsageReason): string {
  switch (reason) {
    case 'not_installed': return t.monitor.usage_cli_not_installed_hint;
    case 'no_quota_source': return t.monitor.usage_cli_no_quota_source_hint;
    case 'no_sessions': return t.monitor.usage_cli_no_sessions_hint;
    case 'unreadable': return t.monitor.usage_cli_unreadable_hint;
  }
}

/** The percent, locale-formatted, with the approximation sign when it is a projection. */
export function PctText({ w, className = '' }: { w: WindowModel; className?: string }) {
  return (
    <span className={`inline-flex items-baseline tabular-nums ${w.projected ? 'opacity-70' : ''} ${className}`}>
      {w.projected && <span aria-hidden>≈</span>}
      <Numeric value={w.usedPct} unit="percent" precision={0} />
    </span>
  );
}

/**
 * THE meter — one grammar for every provider and every variant that draws a bar:
 * a track, a tone-coloured fill to utilisation, and a tick where an even pace
 * would have the fill by now (the elapsed fraction of the window).
 */
export function SvgMeter({
  w, reduced, thick = false,
}: { w: WindowModel; reduced: boolean; thick?: boolean }) {
  return (
    <span
      aria-hidden
      className={`block w-full overflow-hidden rounded-full ${thick ? 'h-2.5' : 'h-1.5'}`}
      data-testid="fleet-usage-meter"
      data-tone={w.tone}
      data-approx={w.projected || undefined}
    >
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" className={`block h-full w-full ${TONE_INK[w.tone]}`}>
        <rect x={0} y={0} width={100} height={10} className="fill-foreground/10" />
        <rect
          x={0} y={0} height={10} width={w.usedPct}
          className={`fill-current ${reduced ? '' : 'transition-[width] duration-500'}`}
          opacity={w.projected ? 0.5 : 1}
        />
        {w.elapsedFrac !== null && (
          <line
            x1={w.elapsedFrac * 100} x2={w.elapsedFrac * 100} y1={0} y2={10}
            className="stroke-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </span>
  );
}

/** The pace verdict as its glyph (fast / steady / slow), named for screen readers. */
export function PaceMark({ pace, withLabel = false }: { pace: Pace | null; withLabel?: boolean }) {
  const { t } = useTranslation();
  if (!pace) return <span className="opacity-50" aria-hidden>—</span>;
  const Icon = PACE_ICON[pace];
  return (
    <span className={`inline-flex items-center gap-1 ${PACE_TONE[pace]}`} data-pace={pace}>
      <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <span className={withLabel ? 'whitespace-nowrap' : 'sr-only'}>{paceLabel(t, pace)}</span>
    </span>
  );
}

/** A window's short name with its hint, e.g. "5h" → "Rolling 5-hour session window". */
export function WindowName({ w, className = '' }: { w: WindowModel; className?: string }) {
  const { t } = useTranslation();
  const name = windowTitle(t, w);
  // Claude's keys carry their own hint; a CLI window's name is already its description.
  const hint = windowHint(t, w.key);
  const label = <span className={`tabular-nums ${className}`}>{name}</span>;
  return hint === w.key ? label : <Tooltip content={hint}>{label}</Tooltip>;
}

/** A provider's name in its tint, with the read-only lock where it applies. */
export function ProviderName({ provider, className = '' }: { provider: ProviderModel; className?: string }) {
  const { t } = useTranslation();
  const tint = PROVIDER_TINT[provider.id];
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`} data-testid="fleet-usage-provider-name">
      <span aria-hidden className={`h-2 w-2 flex-shrink-0 rounded-full ${tint.dot}`} />
      <span className={`truncate typo-title ${tint.text}`}>{PROVIDER_NAME[provider.id]}</span>
      {provider.readOnly && (
        <Tooltip content={t.monitor.usage_read_only_hint}>
          <span className="inline-flex flex-shrink-0 items-center opacity-60">
            <Lock className="h-3 w-3" aria-hidden />
            <span className="sr-only">{t.monitor.usage_read_only}</span>
          </span>
        </Tooltip>
      )}
    </span>
  );
}

/** "reported 3h ago" — when a read-only provider's numbers were last true. */
export function Freshness({ provider, className = '' }: { provider: ProviderModel; className?: string }) {
  const { t } = useTranslation();
  if (!provider.readOnly || provider.plans.length === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap typo-caption ${className}`} data-testid="fleet-usage-freshness">
      {provider.projected && (
        <Tooltip content={t.monitor.usage_cli_projected_hint}>
          <span className="inline-flex items-center text-status-warning">
            <History className="h-3 w-3" aria-hidden />
            <span className="sr-only">{t.monitor.usage_projected_short}</span>
          </span>
        </Tooltip>
      )}
      {provider.asOfMs === null ? (
        t.monitor.usage_cli_never_reported
      ) : (
        <>
          {t.monitor.usage_cli_reported} <RelativeTime timestamp={provider.asOfMs} />
        </>
      )}
    </span>
  );
}

/** The honest empty state of a read-only provider: words, never a meter. */
export function EmptyReason({ reason, className = '' }: { reason: CliUsageReason; className?: string }) {
  const { t } = useTranslation();
  return (
    <Tooltip content={cliReasonHint(t, reason)}>
      <span
        className={`inline-flex items-center gap-1.5 typo-caption text-foreground opacity-70 ${className}`}
        data-testid="fleet-usage-empty"
        data-reason={reason}
      >
        <CircleSlash className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        {cliReasonLabel(t, reason)}
      </span>
    </Tooltip>
  );
}

/** A Claude plan that could not be read: "Needs login" / "Usage unavailable", with why. */
export function PlanTrouble({ plan, className = '' }: { plan: PlanModel; className?: string }) {
  const { t } = useTranslation();
  const quarantined = plan.state === 'quarantined';
  return (
    <Tooltip content={quarantined ? t.monitor.usage_accounts_quarantined_hint : reasonLabel(t, plan.reason)}>
      <span className={`inline-flex items-center gap-1 typo-caption text-status-warning ${className}`} data-testid="fleet-usage-trouble">
        <ShieldOff className="h-3 w-3 flex-shrink-0" aria-hidden />
        {quarantined ? t.monitor.usage_accounts_quarantined : t.monitor.usage_unavailable}
      </span>
    </Tooltip>
  );
}

/** What to call a plan: its email / plan type, or "Live login" when the source named neither. */
export function planName(t: Translations, plan: PlanModel): string {
  return plan.name ?? t.monitor.usage_plan_live_login;
}

/** A static ghost block — no pulse, no spinner; it fades in late so a warm strip never shows it. */
export function Ghost({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block rounded-interactive bg-primary/[0.06] animate-fade-in ${className}`}
      style={{ animationDelay: '150ms' }}
    />
  );
}

// ── Plan acts ────────────────────────────────────────────────────────────────

type Pending = { kind: 'switch' | 'remove'; plan: PlanModel } | null;

export interface PlanConfirm {
  ask: (kind: 'switch' | 'remove', plan: PlanModel) => void;
  /** Render once per variant. */
  dialogs: ReactNode;
}

/** The classic strip's two confirms, verbatim, for any variant. */
export function usePlanConfirm(
  onSwitch: (id: string) => Promise<unknown>,
  onRemove: (id: string) => Promise<unknown>,
): PlanConfirm {
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
  const dialogs = (
    <>
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
  return { ask, dialogs };
}

/** Switch / Forget for one plan — rendered only where `AccountRows` would offer them. */
export function PlanActions({ plan, confirm }: { plan: PlanModel; confirm: PlanConfirm }) {
  const { t, tx } = useTranslation();
  if (!plan.canSwitch && !plan.canRemove) return null;
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1">
      {plan.canSwitch && (
        <AsyncButton
          size="xs"
          variant="ghost"
          onClick={() => {
            confirm.ask('switch', plan);
            return Promise.resolve();
          }}
          data-testid="fleet-usage-switch"
        >
          {t.monitor.usage_accounts_switch}
        </AsyncButton>
      )}
      {plan.canRemove && (
        <Tooltip content={t.monitor.usage_accounts_remove_hint}>
          <button
            type="button"
            onClick={() => confirm.ask('remove', plan)}
            aria-label={tx(t.monitor.usage_accounts_remove_aria, { email: plan.name ?? '' })}
            className="focus-ring inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-interactive text-foreground opacity-60 hover:text-status-error hover:opacity-100"
            data-testid="fleet-usage-remove"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        </Tooltip>
      )}
    </span>
  );
}
