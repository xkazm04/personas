import { Check, Minus } from 'lucide-react';

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
      className={`${px} rounded-input flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${
        checked || indeterminate
          ? 'bg-emerald-500 border border-emerald-500'
          : 'bg-secondary/40 border border-primary/20 hover:border-primary/40'
      }`}
    >
      {checked && !indeterminate && (
        <span className="animate-fade-slide-in">
          <Check className={`${ic} text-foreground`} strokeWidth={3} />
        </span>
      )}
      {indeterminate && (
        <span className="animate-fade-slide-in">
          <Minus className={`${ic} text-foreground`} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stat chip — a compact labelled fact (model tier, trust, team membership).
// ---------------------------------------------------------------------------

const STAT_TONES = {
  neutral: 'bg-secondary/40 text-foreground border-primary/10',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  sky: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  rose: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
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
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-input border px-1.5 py-0.5 typo-caption tabular-nums whitespace-nowrap ${STAT_TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
