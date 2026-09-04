import { useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EpisodeDayCount } from '@/lib/bindings/EpisodeDayCount';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { ChartEmptyState } from '@/features/shared/components/display/ChartEmptyState';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { EpisodesTimeline } from '@/features/agents/sub_life/EpisodesTimeline';
import { BrainChart, BrainChartTooltip, useChartChrome } from './BrainChartFrame';
import { useBrainPalette } from './brainPalette';
import {
  dayKey,
  pivotEpisodeSeries,
  presentRoles,
  EPISODE_ROLES,
  OTHER_ROLE,
  type EpisodeDayRow,
  type EpisodeRoleKey,
} from './brainMath';

/** The stack's series keys — every one is a numeric field of `EpisodeDayRow`. */
type RoleSeries = EpisodeRoleKey | typeof OTHER_ROLE;

const TOOLTIP = <BrainChartTooltip />;
/** De-emphasis slot for the fold-in bucket — a gray, never a generated hue. */
const OTHER_FILL = 'var(--chart-axis-fill)';
const dayTick = (d: string) => d.slice(5);

/**
 * Episode volume over time, stacked by role — the answer to "is this agent
 * still living, and through which door".
 *
 * The flat episode list is DEMOTED to a drill-down here: at a few hundred rows
 * it stops being readable, while the daily shape stays readable at any volume.
 */
export function EpisodeVolumeTile({
  series,
  personaId,
}: {
  series: EpisodeDayCount[];
  personaId: string;
}) {
  const { t, tx } = useTranslation();
  const b = t.agents.brain;
  const palette = useBrainPalette();
  const chrome = useChartChrome();
  const [open, setOpen] = useState(false);

  // Same named-zone helper the series keys use, so "today" cannot land in a
  // different zone from the buckets it is compared against.
  const today = dayKey(new Date());
  const rows = useMemo(() => pivotEpisodeSeries(series, today), [series, today]);
  const roles = useMemo(() => presentRoles(rows), [rows]);
  const total = rows.reduce((n, r) => n + r.total, 0);

  const roleLabel: Record<RoleSeries, string> = {
    run: b.role_run,
    channel: b.role_channel,
    operator: b.role_operator,
    system: b.role_system,
    other: b.role_other,
  };
  /**
   * Color follows the ENTITY, never its rank: the slot is the role's fixed
   * index in `EPISODE_ROLES`, so a persona with no `run` episodes does not
   * repaint `channel` in run's blue.
   */
  const fill = (role: RoleSeries) =>
    role === OTHER_ROLE
      ? OTHER_FILL
      : palette.categorical[EPISODE_ROLES.indexOf(role) % palette.categorical.length]!;

  return (
    <SectionCard
      title={b.volume_title}
      subtitle={b.volume_subtitle}
      icon={<Activity className="w-3.5 h-3.5 text-primary" aria-hidden />}
      action={
        rows.length > 0 ? (
          <span className="typo-caption text-foreground/85">
            {tx(b.volume_total, { count: total })}
          </span>
        ) : undefined
      }
    >
      <div data-testid="brain-volume">
        {rows.length === 0 ? (
          // Honest absence: no axis, no zero line. The backend returns an
          // empty series only when the query ran and found nothing.
          <ChartEmptyState
            variant="bar"
            title={b.volume_empty_title}
            description={b.volume_empty_desc}
          />
        ) : (
          <VolumeChart
            rows={rows}
            roles={roles}
            roleLabel={roleLabel}
            fill={fill}
            chrome={chrome}
            // The chart's identity: whose brain, and which window it drew. A
            // persona switch or a reload that moved the window gets a fresh
            // error boundary rather than the previous chart's latched crash.
            resetKey={`${personaId}:${rows.length}:${rows[rows.length - 1]?.day ?? ''}`}
          />
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="brain-volume-drilldown"
          className="mt-3 inline-flex items-center gap-1.5 typo-caption text-foreground/85 hover:text-foreground transition-colors"
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5" aria-hidden />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" aria-hidden />
          )}
          {open ? b.volume_hide_timeline : b.volume_show_timeline}
        </button>
        {open && (
          <div className="mt-2">
            <EpisodesTimeline personaId={personaId} framed={false} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function VolumeChart({
  rows,
  roles,
  roleLabel,
  fill,
  chrome,
  resetKey,
}: {
  rows: EpisodeDayRow[];
  roles: RoleSeries[];
  roleLabel: Record<RoleSeries, string>;
  fill: (role: RoleSeries) => string;
  chrome: ReturnType<typeof useChartChrome>;
  resetKey: string;
}) {
  return (
    <>
      <BrainChart height={168} testId="brain-volume-chart" resetKey={resetKey}>
        {(R) => (
          <R.BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <R.CartesianGrid stroke={chrome.gridStroke} vertical={false} />
            <R.XAxis dataKey="day" tick={chrome.axisTick} tickFormatter={dayTick} minTickGap={16} />
            <R.YAxis tick={chrome.axisTick} allowDecimals={false} width={40} />
            <R.Tooltip content={TOOLTIP} cursor={{ fill: chrome.gridStroke }} />
            {roles.map((role, i) => (
              <R.Bar
                key={role}
                dataKey={role}
                name={roleLabel[role]}
                stackId="role"
                fill={fill(role)}
                // 2px surface gap between stacked fills, and the 4px rounded
                // data-end only on the topmost drawn segment.
                stroke="var(--background)"
                strokeWidth={2}
                radius={i === roles.length - 1 ? [4, 4, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
          </R.BarChart>
        )}
      </BrainChart>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {roles.map((role) => (
          <li key={role} className="flex items-center gap-1.5 typo-caption">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: fill(role) }}
              aria-hidden
            />
            <span className="text-foreground/85">{roleLabel[role]}</span>
            <Numeric
              className="text-foreground"
              value={rows.reduce((n, r) => n + r[role], 0)}
              unit="plain"
            />
          </li>
        ))}
      </ul>
    </>
  );
}
