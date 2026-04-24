import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';

export interface SegmentedTab<T extends string> {
  id: T;
  label: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
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
}: SegmentedTabsProps<T>) {
  const autoId = useId();
  const indicatorId = layoutId ?? `segmented-tabs-${autoId}`;
  const prefix = idPrefix ?? `segtabs-${autoId}`;
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

  const containerClass =
    variant === 'pill'
      ? `flex gap-1 p-1 rounded-card bg-secondary/30 border border-primary/10 ${className ?? ''}`
      : `flex rounded-card border border-primary/15 overflow-hidden ${className ?? ''}`;

  return (
    <div role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" className={containerClass.trim()}>
      {tabs.map((tab, index) => {
        const active = activeTab === tab.id;
        const tabId = `${prefix}-tab-${tab.id}`;
        const panelId = `${prefix}-panel-${tab.id}`;

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
              tabIndex={active ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && onTabChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`relative ${fullWidth ? 'flex-1' : ''} flex items-center justify-center gap-1.5 px-3 py-2 typo-body rounded-modal transition-colors focus-ring ${
                active ? 'text-foreground' : 'text-foreground hover:text-foreground hover:bg-primary/5'
              } ${tab.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              {active && (
                <motion.div
                  layoutId={indicatorId}
                  className="absolute inset-0 rounded-modal bg-primary/15 border border-primary/20"
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
            tabIndex={active ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`px-3 py-1.5 typo-body font-medium transition-colors focus-ring ${
              index > 0 ? 'border-l border-primary/15' : ''
            } ${
              active ? 'bg-primary/10 text-foreground' : 'text-foreground hover:text-foreground/80'
            } ${tab.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
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
