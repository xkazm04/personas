import { motion } from 'framer-motion';
import { ListChecks, FileText, Link, Settings, FlaskConical, Wand2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { EditorTab } from '@/lib/types/types';

const tabDefs: Array<{ id: EditorTab; label: string; icon: typeof FileText }> = [
  { id: 'use-cases', label: 'Use Cases', icon: ListChecks },
  { id: 'prompt', label: 'Prompt', icon: FileText },
  { id: 'lab', label: 'Lab', icon: FlaskConical },
  { id: 'connectors', label: 'Connectors', icon: Link },
  { id: 'design', label: 'Design', icon: Wand2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface EditorTabBarProps {
  dirtyTabs: string[];
  connectorsMissing: number;
}

export function EditorTabBar({ dirtyTabs, connectorsMissing }: EditorTabBarProps) {
  const editorTab = usePersonaStore((s) => s.editorTab);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);
  const showDesignNudge = usePersonaStore((s) => s.showDesignNudge);

  return (
    <div className="border-b border-primary/10 bg-primary/5">
      <div className="flex overflow-x-auto px-6 gap-1">
        {tabDefs.map((tab) => {
          const Icon = tab.icon;
          const isActive = editorTab === tab.id;
          const tabDirty = dirtyTabs.includes(tab.id)
            || (tab.id === 'use-cases' && dirtyTabs.includes('model'));
          return (
            <button
              key={tab.id}
              onClick={() => setEditorTab(tab.id)}
              className={`relative flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive ? 'text-primary' : 'text-muted-foreground/90 hover:text-foreground/95'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tabDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
              {tab.id === 'connectors' && connectorsMissing > 0 && (
                <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
              )}
              {tab.id === 'design' && showDesignNudge && !isActive && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                </span>
              )}
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
