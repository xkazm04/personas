import { Check, Minus } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

// ---------------------------------------------------------------------------
// Selection checkbox — emerald fill, tri-state.
// ---------------------------------------------------------------------------

export function SelectBox({
  state,
  onChange,
  disabled,
  size = 'md',
  ariaLabel,
}: {
  state: 'all' | 'some' | 'none' | boolean;
  onChange: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  const checked = state === true || state === 'all';
  const indeterminate = state === 'some';
  const px = size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]';
  const ic = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`${px} rounded-input flex items-center justify-center flex-shrink-0 transition-all duration-200 bg-surface-2 border border-hair ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-primary/40'
      }`}
    >
      {checked && !indeterminate && (
        <span className="animate-fade-slide-in">
          <Check className={`${ic} text-status-success`} strokeWidth={3} />
        </span>
      )}
      {indeterminate && (
        <span className="animate-fade-slide-in">
          <Minus className={`${ic} text-status-success`} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stat chip — a compact labelled fact (model tier, trust, team membership).
// ---------------------------------------------------------------------------

const STAT_TONES = {
  neutral: 'bg-surface-2 text-foreground border-hair',
  violet: 'bg-role-agent/10 text-role-agent border-role-agent/20',
  emerald: 'bg-status-success/10 text-status-success border-status-success/20',
  amber: 'bg-status-warning/10 text-status-warning border-status-warning/20',
  sky: 'bg-status-info/10 text-status-info border-status-info/20',
  rose: 'bg-status-error/10 text-status-error border-status-error/20',
} as const;

export function StatChip({
  icon,
  children,
  tone = 'neutral',
  title,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone?: keyof typeof STAT_TONES;
  title?: string;
}) {
  return (
    <Tooltip content={title}><span
      className={`inline-flex items-center gap-1 rounded-input border px-1.5 py-0.5 typo-caption tabular-nums whitespace-nowrap ${STAT_TONES[tone]}`}
    >
      {icon}
      {children}
    </span></Tooltip>
  );
}
