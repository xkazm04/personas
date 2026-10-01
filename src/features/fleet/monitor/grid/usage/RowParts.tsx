// RowParts — the pieces every row of the usage strip is made of: the provider's
// mark (named), one usage window as three glyphs, the 7-day window as the row's
// 2px bottom border, and the single row a provider with nothing to meter gets.
// Split out of `AccountRows` so a plan row's own states (`PlanRow`) have room.

import { CalendarDays, Timer } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ROW_BOX, ROW_REST } from '../UsageStripShell';
import {
  FILL, PACE_ICON, PACE_TONE, TONE_TEXT, cliReasonHint, cliReasonLabel, providerName, windowSentence,
} from '../usageBits';
import { ProviderIcon } from './ProviderIcon';
import type { ProviderModel, WindowModel } from './useResourceModel';

/** The provider's mark, named: "OpenAI Codex 0.41.0", plus — for an observed CLI — that it is read-only and how fresh. */
export function ProviderMark({ provider }: { provider: ProviderModel }) {
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

/** A provider with nothing to meter: its mark, and why, in words. Still one row. */
export function EmptyProviderRow({ provider }: { provider: ProviderModel }) {
  const { t } = useTranslation();
  const reason = provider.emptyReason ?? 'unreadable';
  const label = cliReasonLabel(t, reason);
  return (
    <div
      role="group"
      aria-label={`${providerName(t, provider.id)} · ${label}`}
      className={`${ROW_BOX} ${ROW_REST}`}
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

// A cluster is exactly as wide as its glyphs — no fixed width, no spacer — so
// the email keeps every pixel the stats do not use. Two slots stay fixed so the
// rows of one column still line up: the figure (`FIGURE_BOX`, 3ch of tabular
// digits — "99%" fits, "100%" overflows it by one character, which only a
// capped window ever shows) and the pace slot (`PACE_BOX`, the glyph's own size,
// held even when there is no pace so a paceless row does not shift).
const CLUSTER_BOX = 'inline-flex flex-shrink-0 items-center gap-0.5 typo-caption';
const FIGURE_BOX = 'inline-flex min-w-[3ch] items-baseline justify-end tabular-nums';
const PACE_BOX = 'inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center';
/** The row's right-hand group: both clusters and the Forget act, packed tight against the row's right edge. */
export const STATS_GROUP = 'ml-auto flex flex-shrink-0 items-center gap-1.5';

/** One window as three glyphs: its icon, the percent in its tone, the pace. No bar. */
export function WindowCluster({
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
    // The plan has no such window (Codex reports one, not two): the same
    // compact shape as a read cluster, so the rows stay aligned, and it says so
    // rather than "0%".
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
          <span aria-hidden className={FIGURE_BOX}>—</span>
          <span aria-hidden className={PACE_BOX} />
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
          className={`${FIGURE_BOX} ${TONE_TEXT[w.tone]} ${w.projected ? 'opacity-70' : ''}`}
          data-testid="fleet-usage-percent"
        >
          {w.projected && <span aria-hidden>≈</span>}
          <Numeric value={w.usedPct} unit="percent" precision={0} />
        </span>
        <span className={`${PACE_BOX} ${w.pace ? PACE_TONE[w.pace] : ''}`}>
          {Pace && <Pace className="h-3.5 w-3.5" aria-hidden data-testid="fleet-usage-pace" data-pace={w.pace} />}
        </span>
      </span>
    </Tooltip>
  );
}

/** The row's bottom border: the 7-day window as a 2px fill. An empty track when the plan has none. */
export function WeekBorder({ w }: { w: WindowModel | null }) {
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
