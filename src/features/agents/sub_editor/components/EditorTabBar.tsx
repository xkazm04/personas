import { motion } from 'framer-motion';
import { ListChecks, FileText, Link, Settings, FlaskConical, Check, Activity, MessageCircle, Grid3X3 } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import type { EditorTab } from '@/lib/types/types';
import { isTabDirty } from '../libs/editorTabConstants';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useTier } from '@/hooks/utility/interaction/useTier';
import type { Tier } from '@/lib/constants/uiModes';
import { TIERS } from '@/lib/constants/uiModes';
import { useTranslation } from '@/i18n/useTranslation';

type TabDefBase = { id: EditorTab; labelKey: string; icon: typeof FileText; devOnly?: boolean; minTier?: Tier };
const tabDefs: TabDefBase[] = [
  { id: 'activity', labelKey: 'tab_activity', icon: Activity, minTier: TIERS.TEAM },
  { id: 'matrix', labelKey: 'tab_matrix', icon: Grid3X3, minTier: TIERS.TEAM },
  { id: 'use-cases', labelKey: 'tab_use_cases', icon: ListChecks },
  { id: 'lab', labelKey: 'tab_lab', icon: FlaskConical, minTier: TIERS.TEAM },
  { id: 'connectors', labelKey: 'tab_connectors', icon: Link },
  { id: 'chat', labelKey: 'tab_chat', icon: MessageCircle },
  { id: 'settings', labelKey: 'tab_settings', icon: Settings },
];

interface EditorTabBarProps {
  dirtyTabs: string[];
  connectorsMissing: number;
}

type TabBadgeVariant = 'dirty' | 'attention' | 'error' | 'success';

function TabBadge({ variant, count }: { variant: TabBadgeVariant; count?: number }) {
  if (variant === 'error') {
    return (
      <span className="ml-auto min-w-4 h-4 px-1 rounded-full bg-red-500/15 border border-red-500/25 text-red-400 typo-caption leading-4 text-center">
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
  const { t } = useTranslation();
  const editorTab = useSystemStore((s) => s.editorTab);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const tier = useTier();
  const editorLabels = t.agents.editor_ui;
  return (
    <div className="border-b border-primary/10 bg-primary/5">
      <div className={`flex overflow-x-auto ${IS_MOBILE ? 'px-1 gap-0' : 'px-6 gap-1'} scrollbar-none`}>
        {tabDefs.filter((td) => (!td.devOnly || import.meta.env.DEV) && (!td.minTier || tier.isVisible(td.minTier))).map((tab) => {
          const Icon = tab.icon;
          const isActive = editorTab === tab.id;
          const tabDirty = isTabDirty(tab.id, dirtyTabs);
          const label = (editorLabels as Record<string, string>)[tab.labelKey] ?? tab.labelKey;
          return (
            <button
              key={tab.id}
              onClick={() => setEditorTab(tab.id)}
              data-testid={`editor-tab-${tab.id}`}
              title={label}
              className={`relative flex items-center gap-1.5 ${IS_MOBILE ? 'px-2.5 py-3' : 'px-3 py-2.5'} typo-heading transition-colors whitespace-nowrap ${
                isActive ? 'text-primary' : 'text-muted-foreground/90 hover:text-foreground/95'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!IS_MOBILE && label}
              {tab.id === 'connectors' && connectorsMissing > 0
                ? <TabBadge variant="error" count={connectorsMissing} />
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
