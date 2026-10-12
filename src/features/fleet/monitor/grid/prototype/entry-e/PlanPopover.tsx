/* eslint-disable custom/enforce-base-modal --
 * An anchored popover beside the row that opened it, not a centred modal: a
 * BaseModal backdrop would hide the plates it is explaining. Same exemption as
 * ConfirmPopover; role="dialog" + aria-label give it the right semantics. */
// The small popup behind a plan row. The row itself is two bars and nothing
// else; everything that makes a row tall - the name, the percentages, the reset
// countdowns, the per-model windows, switch and remove, the auto-rotate rule - is
// here, one press away, so the plates can all stay on screen at once.
//
// Anchored beside the row (the supply column is the left edge of the panel, so
// right is where there is room), portalled, clamped to the viewport. Esc and an
// outside press close it; focus returns to the row.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, RotateCw, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { formatPercent } from '@/lib/utils/formatters';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { Button } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { ProviderIcon } from '../../usage/ProviderIcon';
import type { PlanModel, ProviderModel, WindowModel } from '../../usage/useResourceModel';
import { formatCountdown } from '../../usageModel';
import { PACE_ICON, paceLabel, providerName, reasonLabel, windowTitle } from '../../usageBits';
import type { UsageFeed } from '../useUsageFeed';
import { Lamp, Segments } from './parts';
import { METER_TONE } from './tone';

const WIDTH = 288;
const GAP = 8;
const EDGE = 8;
/** Opus / Sonnet are brand names, not words: they read the same in every locale. */
const MODEL_SLOT: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet' };

function WindowLine({ w }: { w: WindowModel }) {
  const { t, tx } = useTranslation();
  const Pace = w.pace ? PACE_ICON[w.pace] : null;
  const model = MODEL_SLOT[w.label];
  const reset = w.remainingMs === null
    ? t.monitor.usage_resets_unknown
    : tx(t.monitor.usage_resets_in, {
      time: formatCountdown(w.remainingMs, {
        day: t.monitor.usage_unit_day, hour: t.monitor.usage_unit_hour,
        minute: t.monitor.usage_unit_minute, underMinute: t.monitor.usage_under_minute,
      }),
    });
  return (
    <li className="flex flex-col gap-1" data-testid="entry-e-plan-window">
      <span className="flex items-baseline gap-2">
        <span className="typo-body text-foreground">{windowTitle(t, w)}{model ? ` · ${model}` : ''}</span>
        <span className="flex-1" />
        {Pace && <Pace className="h-3 w-3 self-center" aria-hidden />}
        <span className={`typo-data tabular-nums ${
          w.tone === 'error' ? 'text-status-error' : w.tone === 'warning' ? 'text-status-warning' : 'text-foreground'}`}>
          {formatPercent(w.usedPct, { precision: 0 })}
        </span>
      </span>
      <Segments count={20} lit={(Math.max(0, 100 - w.usedPct) / 100) * 20} tone={METER_TONE[w.tone]} thin />
      <span className="typo-caption">
        {[reset, w.pace ? paceLabel(t, w.pace) : null, w.projected ? t.monitor.usage_projected_short : null]
          .filter(Boolean).join(' · ')}
      </span>
    </li>
  );
}

export function PlanPopover({ plan, provider, usage, anchorRef, readOnly, onClose }: {
  plan: PlanModel;
  provider: ProviderModel;
  usage: UsageFeed;
  anchorRef: RefObject<HTMLElement | null>;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const rotate = provider.id === 'claude' ? usage.autoRotate : null;
  const shown = draft ?? rotate?.thresholdPct ?? 80;
  const email = plan.name ?? '';

  useLayoutEffect(() => {
    const a = anchorRef.current?.getBoundingClientRect();
    if (!a) return;
    const h = panelRef.current?.offsetHeight ?? 200;
    const fitsRight = a.right + GAP + WIDTH <= window.innerWidth - EDGE;
    setPos({
      left: fitsRight ? a.right + GAP : Math.max(EDGE, a.left - GAP - WIDTH),
      top: Math.max(EDGE, Math.min(a.top, window.innerHeight - h - EDGE)),
    });
  }, [anchorRef]);

  useClickOutside([anchorRef, panelRef], true, onClose);
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      e.preventDefault();
      onClose();
      return true;
    },
    { enabled: true, priority: OVERLAY_DISMISS_PRIORITY },
  );
  useEffect(() => {
    const anchor = anchorRef.current;
    return () => anchor?.focus({ preventScroll: true });
  }, [anchorRef]);

  const ask = (kind: 'switch' | 'remove') => { onClose(); usage.ask(kind, plan); };
  const unreadable = plan.state === 'unreadable' || plan.state === 'quarantined';

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={plan.name ?? providerName(t, provider.id)}
      data-testid="entry-e-plan-popover"
      className="ae-plate fixed z-50 flex flex-col gap-3 rounded-card p-3"
      style={{ width: WIDTH, top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <header className="flex min-w-0 items-center gap-2">
        <ProviderIcon provider={provider.id} className="text-foreground" />
        <span className="typo-label text-foreground">{providerName(t, provider.id)}</span>
        <span className="min-w-0 flex-1 truncate text-right typo-caption">{plan.name ?? m.usage_not_stored}</span>
        <Lamp lamp={{ tone: plan.state === 'quarantined' ? 'err' : 'run', lit: plan.isActive }}
          label={plan.isActive ? m.usage_plan_live_login : undefined} />
      </header>
      {unreadable ? (
        <p className="typo-caption text-status-warning">
          {plan.state === 'quarantined' ? m.usage_accounts_quarantined : reasonLabel(t, plan.reason)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">{plan.windows.map((w) => <WindowLine key={w.key} w={w} />)}</ul>
      )}
      {!readOnly && (plan.canSwitch || plan.canRemove) && (
        <div className="flex items-center gap-2">
          {plan.canSwitch && (
            <Button variant="ghost" size="sm" onClick={() => ask('switch')}
              aria-label={tx(m.usage_accounts_switch_aria, { email })}
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}>{m.usage_accounts_switch}</Button>
          )}
          {plan.canRemove && (
            <Button variant="ghost" size="sm" onClick={() => ask('remove')}
              aria-label={tx(m.usage_accounts_remove_aria, { email })}
              icon={<X className="h-3.5 w-3.5" />}>{m.usage_accounts_remove_hint}</Button>
          )}
        </div>
      )}
      {rotate && (
        <div className="flex items-center gap-2 border-t border-border pt-2.5">
          <AccessibleToggle size="sm" checked={rotate.enabled} label={m.usage_auto_rotate}
            onChange={() => usage.saveAutoRotate(!rotate.enabled, shown)} />
          <RotateCw className={`h-3.5 w-3.5 flex-shrink-0 ${rotate.enabled ? 'text-primary' : ''}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate typo-caption">{m.usage_auto_rotate}</span>
          <input
            type="number" min={1} max={100} step={5} value={shown}
            aria-label={m.usage_auto_rotate_threshold_aria}
            onChange={(e) => setDraft(Number(e.target.value))}
            onBlur={() => {
              const pct = Math.max(1, Math.min(100, Math.round(shown)));
              setDraft(null);
              if (pct !== rotate.thresholdPct) usage.saveAutoRotate(rotate.enabled, pct);
            }}
            className="w-14 rounded-input border border-border bg-background px-1.5 py-0.5 text-right typo-data tabular-nums text-foreground"
            data-testid="fleet-usage-rotate-threshold"
          />
          <span className="typo-caption">%</span>
        </div>
      )}
    </div>,
    document.body,
  );
}
