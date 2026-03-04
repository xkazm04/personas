interface PanelTab<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface PanelTabBarProps<T extends string> {
  tabs: PanelTab<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  activeUnderlineClass: string;
  idPrefix?: string;
}

export function PanelTabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  activeUnderlineClass,
  idPrefix,
}: PanelTabBarProps<T>) {
  return (
    <div role="tablist" className="flex gap-0 mt-4 -mb-5 -mx-4 md:-mx-6 border-t border-primary/10">
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
              'px-5 py-2.5 text-sm font-medium transition-colors relative',
              active
                ? `text-foreground/90 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 ${activeUnderlineClass}`
                : 'text-muted-foreground/90 hover:text-foreground/95',
              tab.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
