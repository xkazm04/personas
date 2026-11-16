import { motion } from 'framer-motion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterOption<T extends string = string> {
  /** Unique filter key, e.g. 'all', 'pending', 'unread'. */
  id: T;
  /** Display label rendered inside the button. */
  label: string;
  /** Optional badge count shown to the right of the label. */
  badge?: number;
}

export interface FilterBarProps<T extends string = string> {
  /** Available filter options. */
  options: FilterOption<T>[];
  /** Currently active filter id. */
  value: T;
  /** Called when the user clicks a filter button. */
  onChange: (value: T) => void;
  /**
   * Kept for call-site compatibility. Console renders both the same: a mono `.num`
   * count after the label (ink-3, ink-1 when selected); no pill, no parentheses.
   */
  badgeStyle?: 'badge' | 'paren';
  /** Optional summary text rendered at the far right, e.g. "Showing 5 of 20". */
  summary?: string;
  /** Extra elements rendered after the filter buttons (before the summary). */
  trailing?: React.ReactNode;
  /**
   * A unique `layoutId` prefix for the active-indicator animation.
   * Defaults to `'filter-bar'`. Use a unique value when multiple FilterBars
   * coexist in the same AnimatePresence tree.
   */
  layoutIdPrefix?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilterBar<T extends string = string>({
  options,
  value,
  onChange,
  badgeStyle = 'badge',
  summary,
  trailing,
  layoutIdPrefix = 'filter-bar',
}: FilterBarProps<T>) {
  const FOOT = 'shadow-[inset_0_-2px_0_var(--primary)]';
  return (
    <div
      className="px-[var(--gutter-page)] min-h-[var(--head-h)] border-b border-hair flex items-center gap-3 flex-shrink-0"
      data-testid="filter-bar"
    >
      {/* Console segmented look: hairline track, selected cell on surface-2 in ink-1 with a 2px primary foot. */}
      <div className="flex h-[var(--control-h)] rounded-input border border-hair-2 overflow-hidden">
        {options.map((opt, index) => {
          const isActive = value === opt.id;
          const showBadge = opt.badge != null && opt.badge > 0;

          return (
            <button
              type="button"
              key={opt.id}
              onClick={() => onChange(opt.id)}
              aria-pressed={isActive}
              data-testid={`filter-btn-${opt.id}`}
              className={`relative px-3 typo-label transition-colors focus-ring flex items-center gap-1.5 ${
                index > 0 ? 'border-l border-hair-2' : ''
              } ${isActive ? 'text-ink-1' : 'text-ink-2 hover:text-ink-1 hover:bg-surface-1'}`}
            >
              {isActive && (
                <motion.div
                  layoutId={`${layoutIdPrefix}-active`}
                  className={`absolute inset-0 bg-surface-2 ${FOOT}`}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}

              <span className="relative">{opt.label}</span>

              {/* Both badge styles read the same: a mono figure, ink-3 (ink-1 when selected). */}
              {showBadge && (
                <span
                  className={`relative num typo-data ${isActive ? 'text-ink-1' : 'text-ink-3'}`}
                  data-badge-style={badgeStyle}
                >
                  {opt.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {trailing}

      {summary && (
        <span className="ml-auto typo-code text-ink-2">
          {summary}
        </span>
      )}
    </div>
  );
}
