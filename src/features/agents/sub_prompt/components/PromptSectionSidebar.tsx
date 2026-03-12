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
              className={`w-full flex items-center gap-2 px-2.5 py-2 text-sm font-medium rounded-xl transition-colors text-left relative ${
                active
                  ? 'bg-primary/10 text-foreground/80 border border-primary/30'
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

      <div className="flex items-center gap-2 px-2.5 pb-0.5">
        <svg width="32" height="32" viewBox="0 0 32 32" className={filled === total && total > 0 ? 'prompt-gauge-complete' : ''}>
          <defs>
            <linearGradient id="pg-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-secondary/30" />
          <circle
            cx="16" cy="16" r="13" fill="none"
            stroke="url(#pg-grad)" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 13}`}
            strokeDashoffset={`${2 * Math.PI * 13 * (1 - (total > 0 ? filled / total : 0))}`}
            transform="rotate(-90 16 16)"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
          <text x="16" y="17" textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="600" fill="currentColor" className="text-foreground/70">
            {filled}/{total}
          </text>
        </svg>
        <span className="text-xs text-muted-foreground/50">sections</span>
        <style>{`
          @keyframes prompt-gauge-glow {
            0%, 100% { filter: drop-shadow(0 0 0px transparent); }
            50% { filter: drop-shadow(0 0 4px rgba(16, 185, 129, 0.5)); }
          }
          .prompt-gauge-complete {
            animation: prompt-gauge-glow 1.5s ease-in-out 1;
          }
        `}</style>
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
