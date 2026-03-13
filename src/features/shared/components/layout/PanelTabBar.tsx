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
  return (
    <div role="tablist" className="flex gap-0 mt-4 -mb-4 -mx-4 md:-mx-6 border-t border-primary/10">
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
            disabled={tab.disabled}
            onClick={() => onTabChange(tab.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium transition-colors relative',
              active
                ? 'text-foreground/90'
                : 'text-muted-foreground/90 hover:text-foreground/95',
              tab.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            {tab.label}
            {active && (
              <motion.div
                layoutId={`${layoutIdPrefix}-underline`}
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
