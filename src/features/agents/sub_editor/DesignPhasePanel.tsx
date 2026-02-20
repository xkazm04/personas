import { Sparkles, Pencil } from 'lucide-react';
import { motion } from 'framer-motion';
import { DesignResultPreview } from '@/features/templates/sub_generated/DesignResultPreview';
import { DesignInput } from '@/features/templates/sub_generated/DesignInput';
import { DesignChatInput } from '@/features/templates/sub_generated/DesignChatInput';
import { DesignWizard } from '@/features/agents/sub_editor/DesignWizard';
import { Wand2, FileText } from 'lucide-react';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { DesignContext } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails, DbPersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

type DesignMode = 'guided' | 'manual';

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
  designMode: DesignMode;
  onDesignModeChange: (mode: DesignMode) => void;
  phase: string;
  error: string | null;
  onStartAnalysis: () => void;
  onWizardComplete: (compiledInstruction: string) => void;
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
  designMode,
  onDesignModeChange,
  phase,
  error,
  onStartAnalysis,
  onWizardComplete,
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
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground/50">
              <Pencil className="w-3 h-3 shrink-0" />
              <span>Current configuration will be preserved. Describe what to change.</span>
            </div>
            <DesignChatInput
              value={instruction}
              onChange={onInstructionChange}
              onSubmit={onStartAnalysis}
              placeholder="Describe changes to this design..."
              buttonLabel="Update Design"
              buttonIcon={Pencil}
              variant="primary"
            />
          </div>
        </>
      ) : (
        <>
          {/* Mode toggle */}
          <div className="flex items-center gap-1 p-0.5 bg-secondary/30 rounded-lg border border-primary/10 w-fit">
            <button
              type="button"
              onClick={() => onDesignModeChange('guided')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                designMode === 'guided'
                  ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25 shadow-sm'
                  : 'text-muted-foreground/50 hover:text-muted-foreground/70'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              Guided
            </button>
            <button
              type="button"
              onClick={() => onDesignModeChange('manual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                designMode === 'manual'
                  ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25 shadow-sm'
                  : 'text-muted-foreground/50 hover:text-muted-foreground/70'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Manual
            </button>
          </div>

          {/* Guided mode: wizard */}
          {designMode === 'guided' && (
            <DesignWizard
              onComplete={onWizardComplete}
              onCancel={() => onDesignModeChange('manual')}
            />
          )}

          {/* Manual mode: freeform textarea */}
          {designMode === 'manual' && (
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
                    ? 'bg-secondary/60 text-muted-foreground/40 cursor-not-allowed'
                    : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                Analyze &amp; Build
              </button>
            </>
          )}

          {error && (
            <p className="text-sm text-red-400 px-1">{error}</p>
          )}
        </>
      )}
    </motion.div>
  );
}
