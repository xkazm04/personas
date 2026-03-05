import { useMemo, useRef, useEffect, useCallback } from 'react';
import { Check, Save } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export type SubTab = 'identity' | 'instructions' | 'toolGuidance' | 'examples' | 'errorHandling' | 'webSearch' | 'custom';

export interface SidebarEntry {
  key: SubTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

interface PromptSectionSidebarProps {
  visibleTabs: SidebarEntry[];
  activeTab: SubTab;
  onTabChange: (tab: SubTab) => void;
  sectionFilled: Record<SubTab, boolean>;
  showSaved: boolean;
  isSaving: boolean;
}

export function PromptSectionSidebar({
  visibleTabs,
  activeTab,
  onTabChange,
  sectionFilled,
  showSaved,
  isSaving,
}: PromptSectionSidebarProps) {
  const tabRefs = useRef<Partial<Record<SubTab, HTMLButtonElement | null>>>({});

  const { filled, total } = useMemo(() => {
    let f = 0;
    for (const tab of visibleTabs) {
      if (sectionFilled[tab.key]) f++;
    }
    return { filled: f, total: visibleTabs.length };
  }, [visibleTabs, sectionFilled]);

  useEffect(() => {
    tabRefs.current[activeTab]?.focus();
  }, [activeTab]);

  const focusTabByOffset = useCallback((current: SubTab, offset: number) => {
    const keys = visibleTabs.map((tab) => tab.key);
    const currentIndex = keys.indexOf(current);
    if (currentIndex < 0 || keys.length === 0) return;
    const nextIndex = (currentIndex + offset + keys.length) % keys.length;
    const nextTab = keys[nextIndex];
    if (!nextTab) return;
    onTabChange(nextTab);
  }, [visibleTabs, onTabChange]);

  const handleTabKeyDown = useCallback((tab: SubTab, e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusTabByOffset(tab, 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusTabByOffset(tab, -1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      const first = visibleTabs[0]?.key;
      if (first) onTabChange(first);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const last = visibleTabs[visibleTabs.length - 1]?.key;
      if (last) onTabChange(last);
    }
  }, [focusTabByOffset, onTabChange, visibleTabs]);

  return (
    <div className="w-40 flex-shrink-0 flex flex-col gap-1">
      <div className="space-y-0.5 flex-1 relative" role="tablist" aria-orientation="vertical" aria-label="Prompt sections">
        <div className="absolute left-[11px] top-3 bottom-3 w-px bg-primary/10" aria-hidden="true" />
        {visibleTabs.map((tab) => {
          const active = activeTab === tab.key;
          const isFilled = sectionFilled[tab.key];
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[tab.key] = el;
              }}
              onClick={() => onTabChange(tab.key)}
              onKeyDown={(e) => handleTabKeyDown(tab.key, e)}
              role="tab"
              id={`prompt-tab-${tab.key}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`w-full flex items-center gap-2 px-2.5 py-2 text-sm font-medium rounded-lg transition-colors text-left relative ${
                active
                  ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                  : 'text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <span
                className={`relative z-10 w-2.5 h-2.5 rounded-full border transition-all ${
                  isFilled
                    ? 'bg-emerald-400 border-emerald-400'
                    : 'bg-background border-muted-foreground/30'
                } ${active ? 'ring-2 ring-primary/60' : ''}`}
              />
              <tab.Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="px-2.5 pb-0.5 text-sm text-muted-foreground/60">
        Prompt completeness: {filled}/{total} sections
      </div>

      {/* Save status */}
      <div className="flex items-center gap-2 px-1 py-1 flex-shrink-0">
        <AnimatePresence>
          {showSaved && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center gap-1 text-sm text-emerald-400"
            >
              <Check className="w-3 h-3" />
              Saved
            </motion.div>
          )}
        </AnimatePresence>
        {isSaving && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground/90">
            <Save className="w-3 h-3 animate-pulse" />
            Saving...
          </div>
        )}
      </div>
    </div>
  );
}
