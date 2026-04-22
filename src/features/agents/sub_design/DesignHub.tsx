import { Suspense, lazy } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import { EditorTabContent } from '@/features/agents/sub_editor/components/EditorTabContent';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { DesignTab } from './DesignTab';

const PersonaConnectorsTab = lazy(() =>
  import('@/features/agents/sub_connectors/components/connectors/PersonaConnectorsTab').then((m) => ({ default: m.PersonaConnectorsTab })),
);

interface DesignHubProps {
  onConnectorsMissingChange?: (count: number) => void;
}

/**
 * DesignHub — single scroll that pairs the LLM design flow with a
 * Connectors & Tools section underneath. The former sub-tab nav
 * (Design / Prompt / Connectors) is gone; Prompt is retired entirely.
 */
export function DesignHub({ onConnectorsMissingChange }: DesignHubProps) {
  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 min-h-0 space-y-8 pb-6">
        <DesignTab />
        <div className="border-t border-primary/10" />
        <section className="space-y-4 px-4">
          <SectionHeading title="Connectors & Tools" icon={<LinkIcon />} />
          <Suspense fallback={<SuspenseFallback />}>
            <EditorTabContent>
              <PersonaConnectorsTab onMissingCountChange={onConnectorsMissingChange} />
            </EditorTabContent>
          </Suspense>
        </section>
      </div>
    </div>
  );
}
