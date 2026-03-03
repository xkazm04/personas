import { useState, useEffect, useCallback, type Dispatch } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  ListChecks,
  Plug,
  Clock,
  Bell,
  Shield,
  Wand2,
  Loader2,
} from 'lucide-react';
import type { BuilderState } from './types';
import type { BuilderAction } from './builderReducer';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import { UseCaseBuilder } from './UseCaseBuilder';
import { ComponentsPicker } from './ComponentsPicker';
import { TriggerPresetPicker } from './TriggerPresetPicker';
import { ChannelPicker } from './ChannelPicker';
import { PolicyPicker } from './PolicyPicker';
import { BuilderPreview } from './BuilderPreview';
import { useDesignAnalysis } from '@/hooks/design/useDesignAnalysis';
import { usePersonaStore } from '@/stores/personaStore';

interface BuilderStepProps {
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  onContinue: () => void;
  onCancel?: () => void;
  draftPersonaId: string | null;
  setDraftPersonaId: (id: string | null) => void;
}

interface CollapsibleSectionProps {
  id: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  defaultOpen?: boolean;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}

function CollapsibleSection({
  id,
  icon,
  label,
  badge,
  expanded,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const isOpen = expanded.has(id);
  return (
    <div className="border border-primary/10 rounded-xl overflow-hidden bg-secondary/15">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
        )}
        <span className="text-muted-foreground/70">{icon}</span>
        <span className="text-sm font-medium text-foreground/80 flex-1">{label}</span>
        {badge && (
          <span className="text-[10px] font-medium text-muted-foreground/50 bg-secondary/40 px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5 border-t border-primary/8 pt-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function BuilderStep({ state, dispatch, onContinue, onCancel, draftPersonaId, setDraftPersonaId }: BuilderStepProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(['intent', 'useCases']),
  );

  const createPersona = usePersonaStore((s) => s.createPersona);
  const design = useDesignAnalysis();
  const [isGenerating, setIsGenerating] = useState(false);

  const toggleSection = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filledUseCases = state.useCases.filter((uc) => uc.title.trim()).length;
  const hasContent = state.intent.trim().length > 0 || filledUseCases > 0 || state.components.length > 0;
  const canGenerate = (state.intent.trim().length > 0 || state.components.length > 0) && !isGenerating;

  // Watch for design result and apply to builder
  useEffect(() => {
    if (design.phase === 'preview' && design.result && isGenerating) {
      dispatch({ type: 'APPLY_DESIGN_RESULT', payload: design.result });
      setIsGenerating(false);
      // Expand all sections so the user sees what was filled
      setExpanded(new Set(['intent', 'useCases', 'triggers', 'channels', 'policies']));
    }
    if (design.error && isGenerating) {
      setIsGenerating(false);
    }
  }, [design.phase, design.result, design.error, isGenerating, dispatch]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setIsGenerating(true);

    try {
      // Create or reuse draft persona
      let personaId = draftPersonaId;
      if (!personaId) {
        const name = state.intent.trim().slice(0, 30) || 'Draft Agent';
        const persona = await createPersona({
          name,
          description: state.intent.trim().slice(0, 200) || undefined,
          system_prompt: 'You are a helpful AI assistant.',
        });
        personaId = persona.id;
        setDraftPersonaId(personaId);
      }

      // Build enhanced intent with component names
      let enhancedIntent = state.intent.trim();
      if (state.components.length > 0) {
        const names = state.components.map((c) => c.connectorName).join(', ');
        enhancedIntent += `\nConnectors: ${names}`;
      }

      await design.startIntentCompilation(personaId, enhancedIntent);
    } catch {
      setIsGenerating(false);
    }
  }, [canGenerate, draftPersonaId, state.intent, state.components, createPersona, setDraftPersonaId, design]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-6 w-full">
      {/* Left column: builder sections */}
      <div className="space-y-3 min-w-0" style={{ minWidth: 900 }}>
        <SectionHeader
          icon={<FileText className="w-3.5 h-3.5" />}
          label="Build your agent"
        />

        {/* A. Intent + Components + Wand */}
        <CollapsibleSection
          id="intent"
          icon={<FileText className="w-3.5 h-3.5" />}
          label="Intent & Components"
          badge={state.components.length > 0 ? `${state.components.length} component${state.components.length !== 1 ? 's' : ''}` : 'optional'}
          expanded={expanded}
          onToggle={toggleSection}
        >
          <div className="space-y-4">
            {/* Intent textarea */}
            <div className="space-y-1.5">
              <textarea
                value={state.intent}
                onChange={(e) => dispatch({ type: 'SET_INTENT', payload: e.target.value })}
                placeholder="Describe your agent's purpose... (optional — helps AI enhance your agent later)"
                rows={3}
                className="w-full px-3 py-2 bg-secondary/30 border border-primary/10 rounded-xl text-sm text-foreground placeholder-muted-foreground/25 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
              />
            </div>

            {/* Components subsection */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Plug className="w-3 h-3 text-muted-foreground/50" />
                <p className="text-xs font-medium text-muted-foreground/60">Components</p>
              </div>
              <ComponentsPicker
                components={state.components}
                onAdd={(name) => dispatch({ type: 'ADD_COMPONENT', payload: name })}
                onRemove={(name) => dispatch({ type: 'REMOVE_COMPONENT', payload: name })}
                onSetCredential={(name, credId) =>
                  dispatch({ type: 'SET_COMPONENT_CREDENTIAL', payload: { connectorName: name, credentialId: credId } })
                }
              />
            </div>

            {/* AI Wand button */}
            {canGenerate && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-xl border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                {isGenerating ? 'Generating...' : 'Generate with AI'}
              </button>
            )}

            {/* Streaming output during generation */}
            {isGenerating && design.outputLines.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-lg bg-background/50 border border-primary/10 p-2 font-mono text-[10px] text-muted-foreground/50 leading-relaxed">
                {design.outputLines.slice(-10).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}

            {/* Generation error */}
            {design.error && !isGenerating && (
              <p className="text-xs text-red-400/80">{design.error}</p>
            )}
          </div>
        </CollapsibleSection>

        {/* B. Use Cases */}
        <CollapsibleSection
          id="useCases"
          icon={<ListChecks className="w-3.5 h-3.5" />}
          label="Use Cases"
          badge={filledUseCases > 0 ? `${filledUseCases}` : undefined}
          expanded={expanded}
          onToggle={toggleSection}
        >
          <UseCaseBuilder
            useCases={state.useCases}
            onAdd={() => dispatch({ type: 'ADD_USE_CASE' })}
            onUpdate={(id, updates) => dispatch({ type: 'UPDATE_USE_CASE', payload: { id, updates } })}
            onRemove={(id) => dispatch({ type: 'REMOVE_USE_CASE', payload: id })}
          />
        </CollapsibleSection>

        {/* C. Scheduling */}
        <CollapsibleSection
          id="triggers"
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Schedule"
          badge={state.globalTrigger?.label}
          expanded={expanded}
          onToggle={toggleSection}
        >
          <TriggerPresetPicker
            value={state.globalTrigger}
            onChange={(preset) => dispatch({ type: 'SET_GLOBAL_TRIGGER', payload: preset })}
          />
        </CollapsibleSection>

        {/* D. Notifications */}
        <CollapsibleSection
          id="channels"
          icon={<Bell className="w-3.5 h-3.5" />}
          label="Notifications"
          badge={state.channels.length > 0 ? `${state.channels.length}` : undefined}
          expanded={expanded}
          onToggle={toggleSection}
        >
          <ChannelPicker
            channels={state.channels}
            onToggle={(channel) => dispatch({ type: 'TOGGLE_CHANNEL', payload: channel })}
          />
        </CollapsibleSection>

        {/* E. Policies */}
        <CollapsibleSection
          id="policies"
          icon={<Shield className="w-3.5 h-3.5" />}
          label="Policies"
          expanded={expanded}
          onToggle={toggleSection}
        >
          <PolicyPicker
            errorStrategy={state.errorStrategy}
            reviewPolicy={state.reviewPolicy}
            onErrorStrategyChange={(v) => dispatch({ type: 'SET_ERROR_STRATEGY', payload: v })}
            onReviewPolicyChange={(v) => dispatch({ type: 'SET_REVIEW_POLICY', payload: v })}
          />
        </CollapsibleSection>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              Cancel
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onContinue}
            disabled={!hasContent}
            className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 ${
              hasContent
                ? 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
                : 'bg-secondary/40 text-muted-foreground/50 cursor-not-allowed'
            }`}
          >
            Continue
          </button>
        </div>
      </div>

      {/* Right column: preview */}
      <div className="hidden xl:block">
        <BuilderPreview state={state} />
      </div>

      {/* Mobile summary bar */}
      {hasContent && (
        <div className="xl:hidden fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-lg border-t border-primary/10 px-4 py-2.5 z-40">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground/60 truncate">
              {[
                filledUseCases > 0 && `${filledUseCases} use case${filledUseCases !== 1 ? 's' : ''}`,
                state.components.length > 0 && `${state.components.length} component${state.components.length !== 1 ? 's' : ''}`,
                state.globalTrigger?.label,
              ]
                .filter(Boolean)
                .join(' · ') || 'Building...'}
            </p>
            <button
              type="button"
              onClick={onContinue}
              disabled={!hasContent}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-primary text-foreground"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
