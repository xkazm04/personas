import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface LabVariantTab<T extends string> {
  id: T;
  label: ReactNode;
  /** Optional second-line caption (e.g. "Heraldic gladiator ring"). */
  subtitle?: ReactNode;
  /** Optional leading icon rendered next to the label. */
  icon?: LucideIcon;
  /** Optional test id appended to the trigger button. */
  testId?: string;
  /** When true, this tab is rendered but not interactive. */
  disabled?: boolean;
}

export interface LabVariantTabsProps<T extends string> {
  tabs: ReadonlyArray<LabVariantTab<T>>;
  activeId: T;
  onChange: (id: T) => void;
  /** Aria-label for the underlying tablist (defaults to "Variants"). */
  ariaLabel?: string;
  /** Render a thinner row when subtitles are unused. */
  compact?: boolean;
  className?: string;
}

/**
 * Shared two-line variant tab switcher used across the Lab surfaces.
 *
 * Visual grammar (single source of truth — Design.md §components):
 *   - bottom border separates the strip from content (border-b border-primary/10)
 *   - active state: bg-primary/10 + border-primary/20, rounded-modal
 *   - rhythm: px-3 py-2 (px-3 py-1.5 in `compact` mode)
 */
export function LabVariantTabs<T extends string>({
  tabs,
  activeId,
  onChange,
  ariaLabel = 'Variants',
  compact = false,
  className = '',
}: LabVariantTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex items-center gap-1 pb-2 border-b border-primary/10 ${className}`}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const Icon = tab.icon;
        const padding = compact ? 'px-3 py-1.5' : 'px-3 py-2';
        const stack = tab.subtitle ? 'flex-col items-start gap-0.5' : 'flex-row items-center gap-1.5';

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`lab-variant-${tab.id}`}
            disabled={tab.disabled}
            data-testid={tab.testId}
            onClick={() => onChange(tab.id)}
            className={`flex ${stack} ${padding} rounded-modal transition-colors border focus-ring disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? 'bg-primary/10 text-foreground border-primary/20'
                : 'text-foreground/80 hover:bg-secondary/30 border-transparent'
            }`}
          >
            <span className="flex items-center gap-1.5 typo-body font-medium">
              {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
              {tab.label}
            </span>
            {tab.subtitle && (
              <span className="typo-caption text-foreground/60">{tab.subtitle}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
