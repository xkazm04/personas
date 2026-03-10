import { motion } from 'framer-motion';
import { ListChecks, FileText, Link, Settings, FlaskConical, Wand2, Check, Activity } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { EditorTab } from '@/lib/types/types';
import { isTabDirty } from '../libs/editorTabConstants';
import { IS_MOBILE } from '@/lib/utils/platform';

const tabDefs: Array<{ id: EditorTab; label: string; icon: typeof FileText }> = [
  { id: 'use-cases', label: 'Use Cases', icon: ListChecks },
  { id: 'prompt', label: 'Prompt', icon: FileText },
  { id: 'lab', label: 'Lab', icon: FlaskConical },
  { id: 'connectors', label: 'Connectors', icon: Link },
  { id: 'design', label: 'Design', icon: Wand2 },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface EditorTabBarProps {
  dirtyTabs: string[];
  connectorsMissing: number;
}

type TabBadgeVariant = 'dirty' | 'attention' | 'error' | 'success';

function TabBadge({ variant, count }: { variant: TabBadgeVariant; count?: number }) {
  if (variant === 'error') {
    return (
      <span className="ml-auto min-w-4 h-4 px-1 rounded-full bg-red-500/15 border border-red-500/25 text-red-400 text-sm leading-4 text-center">
        {count ?? '!'}
      </span>
    );
  }
  if (variant === 'success') {
    return (
      <span className="ml-auto w-4 h-4 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
        <Check className="w-2.5 h-2.5 text-emerald-400" />
      </span>
    );
  }
  if (variant === 'attention') {
    return (
      <span className="ml-auto relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-violet-500" />
      </span>
    );
  }
  return <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />;
}

export function EditorTabBar({ dirtyTabs, connectorsMissing }: EditorTabBarProps) {
  const editorTab = usePersonaStore((s) => s.editorTab);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const showDesignNudge = usePersonaStore((s) => s.showDesignNudge);

  return (
    <div className="border-b border-primary/10 bg-primary/5">
      <div className={`flex overflow-x-auto ${IS_MOBILE ? 'px-1 gap-0' : 'px-6 gap-1'} scrollbar-none`}>
        {tabDefs.map((tab) => {
          const Icon = tab.icon;
          const isActive = editorTab === tab.id;
          const tabDirty = isTabDirty(tab.id, dirtyTabs);
          return (
            <button
              key={tab.id}
              onClick={() => setEditorTab(tab.id)}
              title={tab.label}
              className={`relative flex items-center gap-1.5 ${IS_MOBILE ? 'px-2.5 py-3' : 'px-3 py-2.5'} text-sm font-medium transition-colors whitespace-nowrap ${
                isActive ? 'text-primary' : 'text-muted-foreground/90 hover:text-foreground/95'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!IS_MOBILE && tab.label}
              {tab.id === 'connectors' && connectorsMissing > 0
                ? <TabBadge variant="error" count={connectorsMissing} />
                : tab.id === 'design' && showDesignNudge && !isActive
                  ? <TabBadge variant="attention" />
                  : tabDirty
                    ? <TabBadge variant="dirty" />
                    : isActive && !tabDirty
                      ? <TabBadge variant="success" />
                      : null}
              {isActive && (
                <motion.div
                  layoutId="personaEditorTab"
                  className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
