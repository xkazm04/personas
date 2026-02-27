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
   * How to render the badge count:
   * - `'badge'`  — rounded pill to the right (default)
   * - `'paren'`  — parenthetical suffix, e.g. "Pending (3)"
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
  return (
    <div
      className="px-4 md:px-6 py-3 border-b border-primary/10 flex items-center gap-2 flex-shrink-0"
      data-testid="filter-bar"
    >
      {options.map((opt) => {
        const isActive = value === opt.id;
        const showBadge = opt.badge != null && opt.badge > 0;

        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            data-testid={`filter-btn-${opt.id}`}
            className={`relative px-3 py-1.5 rounded-lg text-sm font-medium transition-all border flex items-center gap-1.5 ${
              isActive
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary/30 text-muted-foreground/80 border-primary/15 hover:text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            {/* layoutId animated active indicator */}
            {isActive && (
              <motion.div
                layoutId={`${layoutIdPrefix}-active`}
                className="absolute inset-0 rounded-lg bg-primary/15 border border-primary/30"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
              />
            )}

            <span className="relative">
              {opt.label}
              {showBadge && badgeStyle === 'paren' && (
                <span className="opacity-60 ml-1">({opt.badge})</span>
              )}
            </span>

            {showBadge && badgeStyle === 'badge' && (
              <span className="relative text-sm bg-primary/20 text-primary rounded-full min-w-[18px] px-1 inline-flex items-center justify-center">
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}

      {trailing}

      {summary && (
        <span className="ml-auto text-sm font-mono text-muted-foreground/80">
          {summary}
        </span>
      )}
    </div>
  );
}
