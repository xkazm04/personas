import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';

/**
 * @catalog Compact KPI / metric card — icon chip + label + big value, with an optional trend delta and hint. Use for dashboard stat rows instead of hand-rolling a tile.
 */

export type StatTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<StatTone, { icon: string; chip: string }> = {
  neutral: { icon: 'text-foreground/70', chip: 'bg-secondary/40 border-primary/10' },
  success: { icon: 'text-[var(--status-success)]', chip: 'bg-[color-mix(in_oklab,var(--status-success)_12%,transparent)] border-[color-mix(in_oklab,var(--status-success)_25%,transparent)]' },
  warning: { icon: 'text-[var(--status-warning)]', chip: 'bg-[color-mix(in_oklab,var(--status-warning)_12%,transparent)] border-[color-mix(in_oklab,var(--status-warning)_25%,transparent)]' },
  danger: { icon: 'text-[var(--status-error)]', chip: 'bg-[color-mix(in_oklab,var(--status-error)_12%,transparent)] border-[color-mix(in_oklab,var(--status-error)_25%,transparent)]' },
  info: { icon: 'text-[var(--status-info)]', chip: 'bg-[color-mix(in_oklab,var(--status-info)_12%,transparent)] border-[color-mix(in_oklab,var(--status-info)_25%,transparent)]' },
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  /** Optional trend delta — `direction` drives the arrow + color. */
  delta?: { label: string; direction: 'up' | 'down' | 'flat' };
  /** Small caption under the value (e.g. "of 12 in scope"). */
  hint?: string;
  /** Tooltip on the whole card. */
  tooltip?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  delta,
  hint,
  tooltip,
  className,
}: StatCardProps) {
  const t = TONE[tone];
  const deltaColor =
    delta?.direction === 'up'
      ? 'text-[var(--status-success)]'
      : delta?.direction === 'down'
        ? 'text-[var(--status-error)]'
        : 'text-foreground/50';
  const DeltaIcon = delta?.direction === 'down' ? ArrowDownRight : ArrowUpRight;

  const card = (
    <div
      className={`rounded-card border border-primary/10 bg-secondary/20 p-3.5 flex flex-col gap-2 ${className ?? ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="typo-caption text-foreground/60">{label}</span>
        {Icon && (
          <span className={`w-6 h-6 rounded-md border flex items-center justify-center ${t.chip}`}>
            <Icon className={`w-3.5 h-3.5 ${t.icon}`} />
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className="typo-data-lg font-semibold text-foreground/90 tabular-nums leading-none">
          {value}
        </span>
        {delta && delta.direction !== 'flat' && (
          <span className={`inline-flex items-center gap-0.5 typo-caption ${deltaColor}`}>
            <DeltaIcon className="w-3 h-3" />
            {delta.label}
          </span>
        )}
      </div>
      {hint && <span className="typo-caption text-foreground/45">{hint}</span>}
    </div>
  );

  return tooltip ? <Tooltip content={tooltip}>{card}</Tooltip> : card;
}

export default StatCard;
