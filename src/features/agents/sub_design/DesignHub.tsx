import { Suspense, lazy, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ListChecks, FileText, Cable, Zap, MessageSquare, Workflow } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { EditorTabContent } from '@/features/agents/sub_editor/components/EditorTabContent';
import { DesignTab } from './DesignTab';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { DesignSubTab } from '@/lib/types/types';
import { debtText } from '@/i18n/DebtText';


const PersonaConnectorsTab = lazy(() =>
  import('@/features/agents/sub_connectors/components/connectors/PersonaConnectorsTab').then((m) => ({ default: m.PersonaConnectorsTab })),
);
const PersonaUseCasesTab = lazy(() =>
  import('@/features/agents/sub_use_cases/components/core/PersonaUseCasesTab').then((m) => ({ default: m.PersonaUseCasesTab })),
);

interface DesignHubProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  onConnectorsMissingChange?: (count: number) => void;
}

interface SubTabDef {
  id: DesignSubTab;
  label: string;
  icon: typeof ListChecks;
}

const SUB_TABS: SubTabDef[] = [
  { id: 'use-cases', label: 'Use Cases', icon: ListChecks },
  { id: 'prompt', label: 'Prompt', icon: FileText },
  { id: 'connectors', label: 'Connectors & Tools', icon: Cable },
  { id: 'triggers', label: 'Events & Triggers', icon: Zap },
  { id: 'messaging', label: 'Messaging', icon: MessageSquare },
  { id: 'automations', label: 'Automations', icon: Workflow },
];

export function DesignHub({ draft, patch, modelDirty, onConnectorsMissingChange }: DesignHubProps) {
  const { designSubTab, setDesignSubTab } = useSystemStore(
    useShallow((s) => ({ designSubTab: s.designSubTab, setDesignSubTab: s.setDesignSubTab })),
  );
  const credentials = useVaultStore((s) => s.credentials);

  const activeSubTab = useMemo<DesignSubTab>(
    () => (SUB_TABS.some((t) => t.id === designSubTab) ? designSubTab : 'use-cases'),
    [designSubTab],
  );

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex items-center border-b border-primary/10 px-1">
        <div className="flex items-center flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                data-testid={`design-subtab-${tab.id}`}
                onClick={() => setDesignSubTab(tab.id)}
                title={tab.label}
                className={`relative flex items-center gap-1.5 px-3 py-2 typo-body font-medium transition-colors whitespace-nowrap ${
                  isActive ? 'text-primary' : 'text-foreground hover:text-foreground/95'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                {tab.label}
                {isActive && (
                  <motion.div
                    layoutId="designSubTab"
                    className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 pt-4">
        <Suspense fallback={<SuspenseFallback />}>
          {activeSubTab === 'use-cases' && (
            // No EditorTabContent wrapper here — PersonaUseCasesTab now
            // owns its own per-layout width policy. The Persona Layout
            // mode wants the full content area (sigil + side panels
            // spread to the edges); the legacy sigil-grid layout still
            // applies the 900 px prose cap internally.
            <PersonaUseCasesTab draft={draft} patch={patch} modelDirty={modelDirty} credentials={credentials} />
          )}
          {activeSubTab === 'prompt' && <DesignTab />}
          {activeSubTab === 'connectors' && (
            <EditorTabContent>
              <PersonaConnectorsTab onMissingCountChange={onConnectorsMissingChange} />
            </EditorTabContent>
          )}
          {activeSubTab === 'triggers' && (
            <div className="py-12">
              <EmptyState
                icon={Zap}
                title={debtText("auto_events_triggers_6c0403bc")}
                description="Per-persona event subscriptions and trigger configuration will land in this tab."
              />
            </div>
          )}
          {activeSubTab === 'messaging' && (
            <div className="py-12">
              <EmptyState
                icon={MessageSquare}
                title="Messaging"
                description="Notification channels and inbox routing for this agent will live here."
              />
            </div>
          )}
          {activeSubTab === 'automations' && (
            <div className="py-12">
              <EmptyState
                icon={Workflow}
                title="Automations"
                description="Standalone automation rules for this agent will live here."
              />
            </div>
          )}
        </Suspense>
      </div>
    </div>
  );
}
