import { Sparkles, Wand2, FlaskConical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { DesignInput } from '@/features/shared/components/forms/DesignInput';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { DesignPhasePanelSaved } from './DesignPhasePanelSaved';
import { ExamplePairCollector } from '../wizard/ExamplePairCollector';

import type { AgentIR } from '@/lib/types/designTypes';
import type { DesignContext } from '@/lib/types/frontendTypes';
import type { PersonaWithDetails, PersonaToolDefinition, CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { ExamplePair } from '../wizard/ExamplePairCollector';
import type { DesignInputMode } from '../libs/useDesignTabState';

export interface DesignPhasePanelProps {
  savedDesignResult: AgentIR | null;
  selectedPersona: PersonaWithDetails;
  toolDefinitions: PersonaToolDefinition[];
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
  const { t } = useTranslation();
  const hasExamples = examplePairs.some((p) => p.input.trim() || p.output.trim());

  return (
    <div
      key="idle"
      className="animate-fade-slide-in space-y-4"
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium transition-all border ${
                  inputMode === 'design'
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-transparent text-foreground border-transparent hover:text-foreground/80'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t.agents.design.mode_design}
              </button>
              <button
                onClick={() => onInputModeChange('intent')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium transition-all border ${
                  inputMode === 'intent'
                    ? 'bg-violet-500/10 text-violet-400 border-violet-500/25'
                    : 'bg-transparent text-foreground border-transparent hover:text-foreground/80'
                }`}
              >
                <Wand2 className="w-3.5 h-3.5" />
                {t.agents.design.mode_intent}
              </button>
              <button
                onClick={() => onInputModeChange('example')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium transition-all border ${
                  inputMode === 'example'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    : 'bg-transparent text-foreground border-transparent hover:text-foreground/80'
                }`}
              >
                <FlaskConical className="w-3.5 h-3.5" />
                {t.agents.design.mode_example}
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
                placeholder={t.agents.design.example_context_placeholder}
                className="w-full min-h-[60px] max-h-[120px] bg-background/50 border border-emerald-500/10 rounded-modal px-3 py-2 text-sm text-foreground font-sans resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/30 transition-all placeholder-muted-foreground/25"
                disabled={phase !== 'idle'}
              />

              <button
                onClick={onStartAnalysis}
                disabled={!hasExamples}
                className={`flex items-center justify-center gap-2.5 px-4 py-2 rounded-modal font-medium text-sm transition-all w-full ${
                  !hasExamples
                    ? 'bg-secondary/60 text-foreground cursor-not-allowed'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-500/90 hover:to-teal-500/90 text-white shadow-elevation-3 shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]'
                }`}
              >
                <FlaskConical className="w-4 h-4" />
                {t.agents.design.compile_from_examples}
              </button>
            </>
          ) : intentMode ? (
            <>
              {/* Intent compiler input -- single textarea, no design files */}
              <div className="space-y-2">
                <textarea
                  value={instruction}
                  onChange={(e) => onInstructionChange(e.target.value)}
                  placeholder={t.agents.design.intent_placeholder}
                  className="w-full min-h-[100px] max-h-[200px] bg-background/50 border border-violet-500/15 rounded-modal px-3 py-2.5 text-sm text-foreground font-sans resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:border-violet-500/40 transition-all placeholder-muted-foreground/30"
                  disabled={phase !== 'idle'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (instruction.trim()) onStartAnalysis();
                    }
                  }}
                />
                <p className="text-sm text-foreground px-1">{t.agents.design.intent_submit_hint}</p>
                <p className="text-sm text-foreground px-1">
                  {t.agents.design.intent_detail}
                </p>
              </div>
              <button
                onClick={onStartAnalysis}
                disabled={!instruction.trim()}
                className={`flex items-center justify-center gap-2.5 px-4 py-2 rounded-modal font-medium text-sm transition-all w-full ${
                  !instruction.trim()
                    ? 'bg-secondary/60 text-foreground cursor-not-allowed'
                    : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-500/90 hover:to-fuchsia-500/90 text-white shadow-elevation-3 shadow-violet-500/20 hover:shadow-violet-500/30 hover:scale-[1.01] active:scale-[0.99]'
                }`}
              >
                <Wand2 className="w-4 h-4" />
                {t.agents.design.compile_intent}
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
                className={`flex items-center justify-center gap-2.5 px-4 py-2 rounded-modal font-medium text-sm transition-all w-full ${
                  !instruction.trim()
                    ? 'bg-secondary/60 text-foreground cursor-not-allowed'
                    : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-elevation-3 shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                {t.agents.design.analyze_build}
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
    </div>
  );
}
