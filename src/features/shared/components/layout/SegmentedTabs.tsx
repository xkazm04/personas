import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';

export interface SegmentedTab<T extends string> {
  id: T;
  label: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  /**
   * `data-testid` for this tab's button. For a tab that REPLACED an earlier
   * control, so an E2E suite keeps driving the same id across the redesign.
   */
  testId?: string;
}

type Variant = 'pill' | 'segment';

interface SegmentedTabsProps<T extends string> {
  tabs: SegmentedTab<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  variant?: Variant;
  ariaLabel?: string;
  layoutId?: string;
  className?: string;
  idPrefix?: string;
  fullWidth?: boolean;
  /** `'sm'` tightens per-tab padding for dense rails. Default `'md'`. */
  size?: 'sm' | 'md';
}

export function SegmentedTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  variant = 'pill',
  ariaLabel,
  layoutId,
  className,
  idPrefix,
  fullWidth = true,
  size = 'md',
}: SegmentedTabsProps<T>) {
  const autoId = useId();
  const indicatorId = layoutId ?? `segmented-tabs-${autoId}`;
  const prefix = idPrefix ?? `segtabs-${autoId}`;
  // Roving tab stop: the active tab, unless it is disabled or matches no tab, then the first enabled one.
  const activeIdx = tabs.findIndex((tb) => tb.id === activeTab && !tb.disabled);
  const tabStop = activeIdx >= 0 ? activeIdx : tabs.findIndex((tb) => !tb.disabled);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusEnabled = useCallback(
    (from: number, direction: 1 | -1) => {
      const n = tabs.length;
      for (let step = 1; step <= n; step++) {
        const idx = (from + direction * step + n) % n;
        const next = tabs[idx];
        if (next && !next.disabled) {
          refs.current[idx]?.focus();
          onTabChange(next.id);
          return;
        }
      }
    },
    [tabs, onTabChange],
  );

  const focusEdge = useCallback(
    (edge: 'first' | 'last') => {
      const order = edge === 'first' ? tabs.map((_, i) => i) : tabs.map((_, i) => tabs.length - 1 - i);
      for (const idx of order) {
        const next = tabs[idx];
        if (next && !next.disabled) {
          refs.current[idx]?.focus();
          onTabChange(next.id);
          return;
        }
      }
    },
    [tabs, onTabChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          focusEnabled(index, 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          focusEnabled(index, -1);
          break;
        case 'Home':
          e.preventDefault();
          focusEdge('first');
          break;
        case 'End':
          e.preventDefault();
          focusEdge('last');
          break;
      }
    },
    [focusEnabled, focusEdge],
  );

  // Console segmented look: a hairline track, the selected cell on surface-2 in ink-1 with a 2px
  // primary foot. Height is the control role (--control-h), 24px when dense (`sm`).
  const heightClass = size === 'sm' ? 'h-6' : 'h-[var(--control-h)]';
  const containerClass =
    variant === 'pill'
      ? `flex gap-0.5 p-0.5 ${heightClass} rounded-input bg-surface-1 border border-hair-2 ${className ?? ''}`
      : `flex ${heightClass} rounded-input border border-hair-2 overflow-hidden ${className ?? ''}`;
  const FOOT = 'shadow-[inset_0_-2px_0_var(--primary)]';

  return (
    <div role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" className={containerClass.trim()}>
      {tabs.map((tab, index) => {
        const active = activeTab === tab.id;
        const tabId = `${prefix}-tab-${tab.id}`;
        // aria-controls is a claim that a panel with this id exists. Without an
        // `idPrefix` the id derives from useId(), which no caller can know, so
        // the claim could only dangle: withhold it, as PanelTabBar does. A
        // caller that renders the panel passes `idPrefix` and spreads
        // `segmentedTabPanelProps(idPrefix, activeTab)` onto it.
        const panelId = idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined;

        if (variant === 'pill') {
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              role="tab"
              type="button"
              id={tabId}
              aria-selected={active}
              aria-controls={panelId}
              aria-label={tab.ariaLabel}
              data-testid={tab.testId}
              tabIndex={index === tabStop ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && onTabChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`relative ${fullWidth ? 'flex-1' : ''} flex items-center justify-center gap-1.5 ${size === 'sm' ? 'px-2' : 'px-3'} typo-label rounded-interactive transition-colors focus-ring ${
                active ? 'text-ink-1' : 'text-ink-2 hover:text-ink-1 hover:bg-surface-2'
              } ${tab.disabled ? 'text-ink-4 cursor-not-allowed' : ''}`}
            >
              {active && (
                <motion.div
                  layoutId={indicatorId}
                  className={`absolute inset-0 rounded-interactive bg-surface-2 ${FOOT}`}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">{tab.label}</span>
            </button>
          );
        }

        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role="tab"
            type="button"
            id={tabId}
            aria-selected={active}
            aria-controls={panelId}
            aria-label={tab.ariaLabel}
            data-testid={tab.testId}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`${size === 'sm' ? 'px-2' : 'px-3'} typo-label transition-colors focus-ring ${
              index > 0 ? 'border-l border-hair-2' : ''
            } ${
              active ? `bg-surface-2 text-ink-1 ${FOOT}` : 'text-ink-2 hover:text-ink-1 hover:bg-surface-1'
            } ${tab.disabled ? 'text-ink-4 cursor-not-allowed' : ''}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function segmentedTabPanelProps<T extends string>(prefix: string, id: T) {
  return {
    role: 'tabpanel' as const,
    id: `${prefix}-panel-${id}`,
    'aria-labelledby': `${prefix}-tab-${id}`,
  };
}
