// What a plan row's hover (and keyboard focus) opens: the specific numbers last
// measured for that plan, in the row's own expanded space (the house Tooltip,
// right of the rail). The row itself stays two bars; the click popup
// (`PlanPopover`) stays the place for switch / remove / auto-rotate.
//
// LIVENESS - only what a read fills. The three reads behind a plan are
// `fleet_claude_accounts_list` (stored Claude plans: per window utilization %,
// reset, length, and when the plan was fetched or projected from),
// `fleet_claude_usage` (the single live login, same window shape) and
// `fleet_cli_usage` (codex / agy: used %, reset, window minutes, as-of). So a
// window prints its span, its used %, the countdown and the wall-clock reset,
// and the plan prints when it was measured. NONE of them reports an absolute
// "used / limit" count (the endpoints speak percent), so there is no such line:
// absent is omitted, never invented. A window without a reset says so in the
// existing words; a plan without an as-of has no "as of" line.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { formatPercent } from '@/lib/utils/formatters';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { PlanModel, ProviderModel, WindowModel } from '../../usage/useResourceModel';
import { formatCountdown } from '../../usageModel';
import { providerName, reasonLabel, windowTitle } from '../../usageBits';
import { clockText } from './personaTailModel';

/** Brand names, not words: the same in every locale (as `PlanPopover`). */
const MODEL_SLOT: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet' };

const INK: Record<WindowModel['tone'], string> = {
  ok: 'text-foreground', warning: 'text-status-warning', error: 'text-status-error',
};

function WindowFacts({ w, now }: { w: WindowModel; now: number }) {
  const { t, tx, language } = useTranslation();
  const m = t.monitor;
  const model = MODEL_SLOT[w.label];
  const reset = w.remainingMs === null || w.resetsAtMs === null
    ? m.usage_resets_unknown
    : `${tx(m.usage_resets_in, {
      time: formatCountdown(w.remainingMs, {
        day: m.usage_unit_day, hour: m.usage_unit_hour, minute: m.usage_unit_minute, underMinute: m.usage_under_minute,
      }),
    })} · ${clockText(w.resetsAtMs, language, now)}`;
  return (
    <li className="flex flex-col" data-testid="entry-e-plan-hover-window" data-window={w.key}>
      <span className="flex items-baseline gap-3">
        <span className="typo-caption text-foreground">{windowTitle(t, w)}{model ? ` · ${model}` : ''}</span>
        <span className="flex-1" />
        <span className={`typo-data tabular-nums ${INK[w.tone]}`} data-testid="entry-e-plan-hover-used">
          {formatPercent(w.usedPct, { precision: 0, language })}
        </span>
      </span>
      <span className="typo-caption tabular-nums" data-testid="entry-e-plan-hover-reset">{reset}</span>
    </li>
  );
}

export function PlanHover({ plan, provider, now }: { plan: PlanModel; provider: ProviderModel; now: number }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const dead = plan.state === 'unreadable' || plan.state === 'quarantined';
  return (
    <div className="flex w-56 flex-col gap-2" data-testid="entry-e-plan-hover">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="typo-body text-foreground">{providerName(t, provider.id)}</span>
        {plan.name && <span className="min-w-0 flex-1 truncate text-right typo-caption">{plan.name}</span>}
      </span>
      {dead ? (
        <span className="typo-caption text-status-warning">
          {plan.state === 'quarantined' ? m.usage_accounts_quarantined : reasonLabel(t, plan.reason)}
        </span>
      ) : (
        <ul className="flex flex-col gap-1.5">{plan.windows.map((w) => <WindowFacts key={w.key} w={w} now={now} />)}</ul>
      )}
      {(plan.asOfMs !== null || plan.state === 'projected') && (
        <span className="flex items-center gap-1 border-t border-border pt-1.5 typo-caption" data-testid="entry-e-plan-hover-asof">
          {plan.asOfMs !== null && <>{m.usage_as_of} <RelativeTime timestamp={plan.asOfMs} /></>}
          {plan.state === 'projected' && <span className="text-status-warning">{plan.asOfMs !== null ? ' · ' : ''}{m.usage_projected_short}</span>}
        </span>
      )}
    </div>
  );
}

/**
 * The row's hover view as the house `AnchoredTooltip` reads it: the row's rect
 * after the rail's tooltip delay on pointer enter or keyboard focus, null on
 * leave, blur, Escape or a press. Not the wrapping `Tooltip`: that one unmounts
 * its child when its content goes null, and the row must stay the same node
 * while its popup opens over it (the popup anchors to it and returns focus).
 */
export function useHoverAnchor(ref: RefObject<HTMLElement | null>, delay = 400) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const dismiss = useCallback(() => { clear(); setAnchor(null); }, []);
  const show = useCallback(() => {
    clear();
    timer.current = window.setTimeout(() => setAnchor(ref.current?.getBoundingClientRect() ?? null), delay);
  }, [ref, delay]);
  useEffect(() => clear, []);
  return {
    anchor,
    dismiss,
    bind: {
      onMouseEnter: show,
      onMouseLeave: dismiss,
      onFocus: show,
      onBlur: dismiss,
      onKeyDown: (e: { key: string }) => { if (e.key === 'Escape') dismiss(); },
    },
  };
}
