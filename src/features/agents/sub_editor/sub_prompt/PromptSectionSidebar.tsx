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
  return (
    <div className="w-36 flex-shrink-0 flex flex-col gap-1">
      <div className="space-y-0.5 flex-1">
        {visibleTabs.map((tab) => {
          const active = activeTab === tab.key;
          const filled = sectionFilled[tab.key];
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 text-sm font-medium rounded-lg transition-colors text-left ${
                active
                  ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                  : 'text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <tab.Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{tab.label}</span>
              {filled && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400/60 flex-shrink-0" />
              )}
            </button>
          );
        })}
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
