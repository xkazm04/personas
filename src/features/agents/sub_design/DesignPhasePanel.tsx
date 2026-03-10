import { Sparkles, Wand2, FlaskConical } from 'lucide-react';
import { motion } from 'framer-motion';
import { DesignInput } from '@/features/shared/components/DesignInput';
import { ErrorBanner } from '@/features/shared/components/ErrorBanner';
import { DesignPhasePanelSaved } from './DesignPhasePanelSaved';
import { ExamplePairCollector } from './ExamplePairCollector';

import type { AgentIR } from '@/lib/types/designTypes';
import type { DesignContext } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails, DbPersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { ExamplePair } from './ExamplePairCollector';
import type { DesignInputMode } from './libs/useDesignTabState';

export interface DesignPhasePanelProps {
  savedDesignResult: AgentIR | null;
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
  inputMode?: DesignInputMode;
  onInputModeChange?: (mode: DesignInputMode) => void;
  examplePairs?: ExamplePair[];
  onExamplePairsChange?: (pairs: ExamplePair[]) => void;
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
  inputMode = 'design',
  onInputModeChange,
  examplePairs = [],
  onExamplePairsChange,
}: DesignPhasePanelProps) {
  const hasExamples = examplePairs.some((p) => p.input.trim() || p.output.trim());

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
        <DesignPhasePanelSaved
          savedDesignResult={savedDesignResult}
          selectedPersona={selectedPersona}
          toolDefinitions={toolDefinitions}
          currentToolNames={currentToolNames}
          credentials={credentials}
          connectorDefinitions={connectorDefinitions}
          instruction={instruction}
          onInstructionChange={onInstructionChange}
          onStartAnalysis={onStartAnalysis}
        />
      ) : (
        <>
          {/* Mode toggle */}
          {onInputModeChange && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => onInputModeChange('design')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all border ${
                  inputMode === 'design'
                    ? 'bg-primary/10 text-primary border-primary/25'
                    : 'bg-transparent text-muted-foreground/70 border-transparent hover:text-foreground/80'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Design
              </button>
              <button
                onClick={() => onInputModeChange('intent')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all border ${
                  inputMode === 'intent'
                    ? 'bg-violet-500/10 text-violet-400 border-violet-500/25'
                    : 'bg-transparent text-muted-foreground/70 border-transparent hover:text-foreground/80'
                }`}
              >
                <Wand2 className="w-3.5 h-3.5" />
                Intent Compiler
              </button>
              <button
                onClick={() => onInputModeChange('example')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all border ${
                  inputMode === 'example'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    : 'bg-transparent text-muted-foreground/70 border-transparent hover:text-foreground/80'
                }`}
              >
                <FlaskConical className="w-3.5 h-3.5" />
                Show by Example
              </button>
            </div>
          )}

          {inputMode === 'example' ? (
            <>
              <ExamplePairCollector
                pairs={examplePairs}
                onPairsChange={onExamplePairsChange ?? (() => {})}
                disabled={phase !== 'idle'}
              />

              {/* Optional supplementary note */}
              <textarea
                value={instruction}
                onChange={(e) => onInstructionChange(e.target.value)}
                placeholder="Optional: add context or constraints (e.g. &quot;always prioritize P1 tickets&quot;, &quot;post to #alerts channel&quot;)"
                className="w-full min-h-[60px] max-h-[120px] bg-background/50 border border-emerald-500/10 rounded-xl px-3 py-2 text-sm text-foreground font-sans resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 transition-all placeholder-muted-foreground/25"
                disabled={phase !== 'idle'}
              />

              <button
                onClick={onStartAnalysis}
                disabled={!hasExamples}
                className={`flex items-center justify-center gap-2.5 px-4 py-2 rounded-xl font-medium text-sm transition-all w-full ${
                  !hasExamples
                    ? 'bg-secondary/60 text-muted-foreground/80 cursor-not-allowed'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-500/90 hover:to-teal-500/90 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]'
                }`}
              >
                <FlaskConical className="w-4 h-4" />
                Compile from Examples
              </button>
            </>
          ) : intentMode ? (
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
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (instruction.trim()) onStartAnalysis();
                    }
                  }}
                />
                <p className="text-sm text-muted-foreground/60 px-1">Press Enter to submit, Shift+Enter for new line.</p>
                <p className="text-sm text-muted-foreground/50 px-1">
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
            <ErrorBanner
              message={error}
              variant="inline"
              onRetry={onStartAnalysis}
            />
          )}
        </>
      )}
    </motion.div>
  );
}
