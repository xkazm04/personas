import { useId, useRef } from 'react';
import { motion } from 'framer-motion';

interface PanelTab<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface PanelTabBarProps<T extends string> {
  tabs: PanelTab<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  underlineClass: string;
  idPrefix?: string;
  layoutIdPrefix?: string;
}

export function PanelTabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  underlineClass,
  idPrefix,
  layoutIdPrefix = 'panel-tab',
}: PanelTabBarProps<T>) {
  // Per-instance suffix so two tab bars never share a framer-motion layoutId —
  // a shared id makes the underline teleport/animate between the two bars.
  const instanceId = useId();
  const underlineLayoutId = `${layoutIdPrefix}-${instanceId}-underline`;
  const tablistRef = useRef<HTMLDivElement>(null);

  // WAI-ARIA tablist keyboard nav: Arrow keys move between tabs, Home/End jump
  // to the ends (skipping disabled tabs). Paired with roving tabindex below
  // (only the active tab is in the Tab order), this is the expected behaviour
  // for a `role="tablist"` — without it every tab sat in the Tab order and
  // arrow keys did nothing.
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const enabled = tabs.map((t, i) => ({ t, i })).filter(({ t }) => !t.disabled);
    if (enabled.length === 0) return;
    e.preventDefault();
    const pos = enabled.findIndex(({ i }) => i === index);
    let nextPos: number;
    switch (e.key) {
      case 'ArrowRight': nextPos = (pos + 1) % enabled.length; break;
      case 'ArrowLeft': nextPos = (pos - 1 + enabled.length) % enabled.length; break;
      case 'Home': nextPos = 0; break;
      default: nextPos = enabled.length - 1; break; // End
    }
    const next = enabled[nextPos];
    if (!next) return;
    onTabChange(next.t.id);
    tablistRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      ?.[next.i]?.focus();
  };

  return (
    <div ref={tablistRef} role="tablist" className="flex gap-0 mt-4 -mb-4 -mx-4 md:-mx-6 border-t border-primary/10">
      {tabs.map((tab, index) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            // Roving tabindex: only the active tab is reachable via Tab; arrow
            // keys move within the tablist.
            tabIndex={active ? 0 : -1}
            id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
            disabled={tab.disabled}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={[
              'px-4 py-2.5 typo-heading transition-colors relative focus-ring',
              active
                ? 'text-foreground font-semibold'
                : 'text-foreground hover:text-foreground/80',
              tab.disabled ? 'text-foreground cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            {tab.label}
            {active && (
              <motion.div
                layoutId={underlineLayoutId}
                className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-full ${underlineClass}`}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
