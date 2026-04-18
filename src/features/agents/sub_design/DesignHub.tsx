import { Suspense, lazy } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { EditorTabContent } from '@/features/agents/sub_editor/components/EditorTabContent';
import { DesignHubHeader } from './components/DesignHubHeader';
import { DesignTab } from './DesignTab';

const PersonaPromptEditor = lazy(() =>
  import('@/features/agents/sub_prompt').then((m) => ({ default: m.PersonaPromptEditor })),
);
const PersonaConnectorsTab = lazy(() =>
  import('@/features/agents/sub_connectors/components/connectors/PersonaConnectorsTab').then((m) => ({ default: m.PersonaConnectorsTab })),
);

interface DesignHubProps {
  onConnectorsMissingChange?: (count: number) => void;
}

/**
 * DesignHub — parent container for the unified Design experience.
 *
 * Absorbs the former standalone Prompt, Connectors, and Health tabs via
 * horizontal sub-tabs and an inline health summary. The Design subtab
 * renders the existing LLM-driven design flow unchanged; Prompt and
 * Connectors sub-tabs embed the original editors verbatim so the data
 * model and save semantics are preserved.
 */
export function DesignHub({ onConnectorsMissingChange }: DesignHubProps) {
  const designSubTab = useSystemStore((s) => s.designSubTab);

  return (
    <div className="flex flex-col min-h-full">
      <DesignHubHeader />
      <div className="flex-1 min-h-0 animate-fade-slide-in" key={designSubTab}>
        <Suspense fallback={<SuspenseFallback />}>
          {designSubTab === 'design' && <DesignTab />}
          {designSubTab === 'prompt' && <PersonaPromptEditor />}
          {designSubTab === 'connectors' && (
            <EditorTabContent>
              <PersonaConnectorsTab onMissingCountChange={onConnectorsMissingChange} />
            </EditorTabContent>
          )}
        </Suspense>
      </div>
    </div>
  );
}
