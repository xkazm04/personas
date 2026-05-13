import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { DesignPhasePanelSaved } from './DesignPhasePanelSaved';

import type { AgentIR } from '@/lib/types/designTypes';
import type { PersonaWithDetails, PersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

export interface DesignPhasePanelProps {
  savedDesignResult: AgentIR | null;
  selectedPersona: PersonaWithDetails;
  toolDefinitions: PersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  error: string | null;
  onStartAnalysis: () => void;
}

export function DesignPhasePanel({
  savedDesignResult,
  selectedPersona,
  toolDefinitions,
  currentToolNames,
  credentials,
  connectorDefinitions,
  error,
  onStartAnalysis,
}: DesignPhasePanelProps) {
  if (savedDesignResult) {
    return (
      <div key="idle" className="animate-fade-slide-in space-y-4">
        <DesignPhasePanelSaved
          savedDesignResult={savedDesignResult}
          selectedPersona={selectedPersona}
          toolDefinitions={toolDefinitions}
          currentToolNames={currentToolNames}
          credentials={credentials}
          connectorDefinitions={connectorDefinitions}
        />
        {error && <ErrorBanner message={error} variant="inline" onRetry={onStartAnalysis} />}
      </div>
    );
  }

  if (error) {
    return (
      <div key="idle" className="animate-fade-slide-in space-y-4">
        <ErrorBanner message={error} variant="inline" onRetry={onStartAnalysis} />
      </div>
    );
  }

  return null;
}
