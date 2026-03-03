import { Pencil } from 'lucide-react';
import { DesignResultPreview } from '@/features/templates/sub_generated';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { PersonaWithDetails, DbPersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface DesignPhasePanelSavedProps {
  savedDesignResult: DesignAnalysisResult;
  selectedPersona: PersonaWithDetails;
  toolDefinitions: DbPersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  instruction: string;
  onInstructionChange: (value: string) => void;
  onStartAnalysis: () => void;
}

export function DesignPhasePanelSaved({
  savedDesignResult,
  selectedPersona,
  toolDefinitions,
  currentToolNames,
  credentials,
  connectorDefinitions,
  instruction,
  onInstructionChange,
  onStartAnalysis,
}: DesignPhasePanelSavedProps) {
  return (
    <>
      {/* Read-only overview of saved design */}
      <DesignResultPreview
        result={savedDesignResult}
        allToolDefs={toolDefinitions}
        currentToolNames={currentToolNames}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        selectedTools={new Set(savedDesignResult.suggested_tools)}
        selectedTriggerIndices={new Set(savedDesignResult.suggested_triggers.map((_: unknown, i: number) => i))}
        selectedChannelIndices={new Set((savedDesignResult.suggested_notification_channels || []).map((_: unknown, i: number) => i))}
        suggestedSubscriptions={savedDesignResult.suggested_event_subscriptions}
        selectedSubscriptionIndices={new Set((savedDesignResult.suggested_event_subscriptions || []).map((_: unknown, i: number) => i))}
        onToolToggle={() => {}}
        onTriggerToggle={() => {}}
        onChannelToggle={() => {}}
        onConnectorClick={() => {}}
        readOnly
        actualTriggers={selectedPersona.triggers || []}
        feasibility={savedDesignResult.feasibility}
      />

      {/* Chat input for modifications */}
      <div className="pt-2 border-t border-primary/10 space-y-2">
        <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground/90">
          <Pencil className="w-3 h-3 shrink-0" />
          <span>Current configuration will be preserved. Describe what to change.</span>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={instruction}
            onChange={(e) => onInstructionChange(e.target.value)}
            placeholder="Describe changes to this design..."
            className="flex-1 min-h-[60px] max-h-[120px] bg-background/50 border border-primary/15 rounded-xl px-3 py-2 text-sm text-foreground font-sans resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (instruction.trim()) onStartAnalysis();
              }
            }}
          />
          <button
            onClick={onStartAnalysis}
            disabled={!instruction.trim()}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              !instruction.trim()
                ? 'bg-secondary/40 text-muted-foreground/80 cursor-not-allowed'
                : 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            Update Design
          </button>
        </div>
      </div>
    </>
  );
}
