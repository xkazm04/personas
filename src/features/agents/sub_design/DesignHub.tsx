import { Suspense, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ScrollText, ClipboardList, Brain, Plug } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { lazyRetry } from '@/lib/lazyRetry';
import { useSystemStore } from '@/stores/systemStore';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { DesignSubTab } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

// The four standing surfaces stay one deferred chunk each. Connectors keeps
// its own module (it pulls the vault + verification machinery); the three
// living-agent panels share `DesignLifePanels`, whose lazyRetry boundaries
// dedupe into a single import.
const DesignManifestPanel = lazyRetry(() =>
  import('./components/DesignLifePanels').then((m) => ({ default: m.DesignManifestPanel })),
);
const DesignResponsibilitiesPanel = lazyRetry(() =>
  import('./components/DesignLifePanels').then((m) => ({ default: m.DesignResponsibilitiesPanel })),
);
const DesignBrainPanel = lazyRetry(() =>
  import('./components/DesignLifePanels').then((m) => ({ default: m.DesignBrainPanel })),
);
const DesignConnectorsPanel = lazyRetry(() =>
  import('./components/DesignSubtabPanels').then((m) => ({ default: m.DesignConnectorsPanel })),
);

interface DesignHubProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  /** Retained for the EditorBody contract; not wired by any current sub-tab. */
  onConnectorsMissingChange?: (count: number) => void;
}

interface SubTabDef {
  id: DesignSubTab;
  /** Key into `t.agents.design_subtabs` — resolved at render so all 14 locales apply. */
  labelKey: string;
  icon: typeof ScrollText;
}

/**
 * FOUR sub-tabs, in the order an agent is authored: what it IS, what it OWNS,
 * what it REMEMBERS, what it REACHES. Collapsed from ten by the agent-manifest
 * rebase (2026-09-04) — the six that went were either a read-only recap of the
 * build wizard (`prompt`, `parameters`, `triggers`, `messaging`), a surface a
 * charter now covers (`use-cases`), or a union member with no tab behind it at
 * all (`automations`).
 */
const SUB_TABS: SubTabDef[] = [
  { id: 'manifest', labelKey: 'manifest', icon: ScrollText },
  { id: 'responsibilities', labelKey: 'responsibilities', icon: ClipboardList },
  { id: 'brain', labelKey: 'brain', icon: Brain },
  { id: 'connectors', labelKey: 'connectors', icon: Plug },
];

/** Where an unknown persisted sub-tab lands. */
const FALLBACK_SUB_TAB: DesignSubTab = 'manifest';

/**
 * `_props` is deliberately unbound: all four panels read the selected persona
 * from the store rather than through the editor draft, so nothing is threaded
 * down today. The prop contract stays declared because `EditorBody` passes it
 * and a future panel that needs the in-flight draft should take it from here
 * rather than re-deriving one.
 */
export function DesignHub(_props: DesignHubProps) {
  const { t } = useTranslation();
  const subtabLabels = t.agents.design_subtabs as Record<string, string>;
  const { designSubTab, setDesignSubTab } = useSystemStore(
    useShallow((s) => ({ designSubTab: s.designSubTab, setDesignSubTab: s.setDesignSubTab })),
  );

  // A persisted value from an older build redirects rather than blanking the
  // hub — the rehydrate arm remaps the ones we know about, this catches the
  // rest (including a value written by a NEWER build the user rolled back from).
  const activeSubTab = useMemo<DesignSubTab>(
    () => (SUB_TABS.some((tab) => tab.id === designSubTab) ? designSubTab : FALLBACK_SUB_TAB),
    [designSubTab],
  );

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex items-center border-b border-primary/10 px-1">
        <div className="flex items-center flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            const label = subtabLabels[tab.labelKey] ?? tab.labelKey;
            return (
              <button
                type="button"
                key={tab.id}
                data-testid={`design-subtab-${tab.id}`}
                onClick={() => setDesignSubTab(tab.id)}
                className={`relative flex items-center gap-1.5 px-3 py-2 typo-body font-medium transition-colors whitespace-nowrap ${
                  isActive ? 'text-primary' : 'text-foreground hover:text-foreground/95'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                {label}
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
        <Suspense fallback={<RouteChunkSkeleton />}>
          {activeSubTab === 'manifest' && <DesignManifestPanel />}
          {activeSubTab === 'responsibilities' && <DesignResponsibilitiesPanel />}
          {activeSubTab === 'brain' && <DesignBrainPanel />}
          {activeSubTab === 'connectors' && <DesignConnectorsPanel />}
        </Suspense>
      </div>
    </div>
  );
}
