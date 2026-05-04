import { Suspense, lazy } from 'react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { EditorTabContent } from '@/features/agents/sub_editor/components/EditorTabContent';
import { DesignTab } from './DesignTab';

const PersonaConnectorsTab = lazy(() =>
  import('@/features/agents/sub_connectors/components/connectors/PersonaConnectorsTab').then((m) => ({ default: m.PersonaConnectorsTab })),
);

interface DesignHubProps {
  onConnectorsMissingChange?: (count: number) => void;
}

/**
 * DesignHub — single scroll that pairs the LLM design flow with the
 * live Connectors panel beneath it. PersonaConnectorsTab carries its own
 * inner sections ("Required" with healthcheck, AgentCredentialDemands,
 * etc.); the outer "Connectors & Tools" SectionHeading was removed
 * because DesignResultPreview's ConnectorsSection above already renders
 * a section titled "Connectors & Tools" — the wrapper duplicated the
 * heading and made the page read like there were two unrelated lists.
 */
export function DesignHub({ onConnectorsMissingChange }: DesignHubProps) {
  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 min-h-0 space-y-6 pb-6">
        <DesignTab />
        <Suspense fallback={<SuspenseFallback />}>
          <EditorTabContent>
            <PersonaConnectorsTab onMissingCountChange={onConnectorsMissingChange} />
          </EditorTabContent>
        </Suspense>
      </div>
    </div>
  );
}
