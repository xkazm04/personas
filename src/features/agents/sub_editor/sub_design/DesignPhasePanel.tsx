import { Sparkles, Pencil, Wand2 } from 'lucide-react';
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
  intentMode?: boolean;
  onIntentModeChange?: (v: boolean) => void;
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
  intentMode,
  onIntentModeChange,
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
          {/* Intent mode toggle */}
          {onIntentModeChange && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => onIntentModeChange(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                  !intentMode
                    ? 'bg-primary/10 text-primary border-primary/25'
                    : 'bg-transparent text-muted-foreground/70 border-transparent hover:text-foreground/80'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Design
              </button>
              <button
                onClick={() => onIntentModeChange(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                  intentMode
                    ? 'bg-violet-500/10 text-violet-400 border-violet-500/25'
                    : 'bg-transparent text-muted-foreground/70 border-transparent hover:text-foreground/80'
                }`}
              >
                <Wand2 className="w-3.5 h-3.5" />
                Intent Compiler
              </button>
            </div>
          )}

          {intentMode ? (
            <>
              {/* Intent compiler input — single textarea, no design files */}
              <div className="space-y-2">
                <textarea
                  value={instruction}
                  onChange={(e) => onInstructionChange(e.target.value)}
                  placeholder="Describe what you want this agent to do in plain language...&#10;&#10;e.g. &quot;Monitor our Stripe account for failed payments over $100 and notify the finance team on Slack with a summary&quot;"
                  className="w-full min-h-[100px] max-h-[200px] bg-background/50 border border-violet-500/15 rounded-xl px-3 py-2.5 text-sm text-foreground font-sans resize-y focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/40 transition-all placeholder-muted-foreground/30"
                  disabled={phase !== 'idle'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      if (instruction.trim()) onStartAnalysis();
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground/50 px-1">
                  The compiler will generate a complete configuration: prompt, tools, triggers, use cases, model recommendation, and test scenarios.
                </p>
              </div>
              <button
                onClick={onStartAnalysis}
                disabled={!instruction.trim()}
                className={`flex items-center justify-center gap-2.5 px-4 py-2 rounded-xl font-medium text-sm transition-all w-full ${
                  !instruction.trim()
                    ? 'bg-secondary/60 text-muted-foreground/80 cursor-not-allowed'
                    : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-500/90 hover:to-fuchsia-500/90 text-white shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 hover:scale-[1.01] active:scale-[0.99]'
                }`}
              >
                <Wand2 className="w-4 h-4" />
                Compile Intent
              </button>
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
