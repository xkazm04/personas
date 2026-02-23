import { Sparkles, Pencil } from 'lucide-react';
import { motion } from 'framer-motion';
import { DesignResultPreview } from '@/features/templates/sub_generated/DesignResultPreview';
import { DesignInput } from '@/features/shared/components/DesignInput';

import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { DesignContext } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails, DbPersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

export interface DesignPhasePanelProps {
  savedDesignResult: DesignAnalysisResult | null;
  selectedPersona: PersonaWithDetails;
  toolDefinitions: DbPersonaToolDefinition[];
  currentToolNames: string[];
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  instruction: string;
  onInstructionChange: (value: string) => void;
  designContext: DesignContext;
  onDesignContextChange: (ctx: DesignContext) => void;
  phase: string;
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
  instruction,
  onInstructionChange,
  designContext,
  onDesignContextChange,
  phase,
  error,
  onStartAnalysis,
}: DesignPhasePanelProps) {
  return (
    <motion.div
      key="idle"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="space-y-4"
    >
      {savedDesignResult ? (
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
      ) : (
        <>
          <DesignInput
            instruction={instruction}
            onInstructionChange={onInstructionChange}
            designContext={designContext}
            onDesignContextChange={onDesignContextChange}
            disabled={phase !== 'idle'}
            onSubmit={onStartAnalysis}
          />

          <button
            onClick={onStartAnalysis}
            disabled={!instruction.trim()}
            className={`flex items-center justify-center gap-2.5 px-4 py-2 rounded-xl font-medium text-sm transition-all w-full ${
              !instruction.trim()
                ? 'bg-secondary/60 text-muted-foreground/80 cursor-not-allowed'
                : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Analyze &amp; Build
          </button>

          {error && (
            <p className="text-sm text-red-400 px-1">{error}</p>
          )}
        </>
      )}
    </motion.div>
  );
}
