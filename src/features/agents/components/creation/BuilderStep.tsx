import { useState, useEffect, useCallback, useRef, type Dispatch } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  ListChecks,
  Plug,
  Clock,
  Shield,
  Wand2,
  Loader2,
  X,
} from 'lucide-react';
import type { BuilderState } from './types';
import type { BuilderAction } from './builderReducer';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import { UseCaseBuilder } from './UseCaseBuilder';
import { ComponentsPicker } from './ComponentsPicker';
import { TriggerPresetPicker } from './TriggerPresetPicker';
import { PolicyPicker } from './PolicyPicker';
import { BuilderPreview } from './BuilderPreview';
import { useDesignAnalysis } from '@/hooks/design/useDesignAnalysis';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { useDryRun } from './useDryRun';

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
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div className="border border-primary/10 rounded-xl bg-secondary/15">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/65" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/65" />
        )}
        <span className="text-muted-foreground/80">{icon}</span>
        <span className="text-sm font-medium text-foreground/90 flex-1">{label}</span>
        {badge && (
          <span className="text-sm font-medium text-muted-foreground/65 bg-secondary/40 px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={contentRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
            onAnimationStart={() => {
              if (contentRef.current) contentRef.current.style.overflow = 'hidden';
            }}
            onAnimationComplete={() => {
              if (contentRef.current && isOpen) contentRef.current.style.overflow = 'visible';
            }}
          >
            <div className="px-3.5 pb-3.5 border-t border-primary/12 pt-3">
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
  const createGroup = usePersonaStore((s) => s.createGroup);
  const movePersonaToGroup = usePersonaStore((s) => s.movePersonaToGroup);
  const design = useDesignAnalysis();
  const [isGenerating, setIsGenerating] = useState(false);
  const isCreatingRef = useRef(false);
  const dryRun = useDryRun();
  const [autoTestGen, setAutoTestGen] = useState(0);
  const [logDismissed, setLogDismissed] = useState(false);

  const toggleSection = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filledUseCases = state.useCases.filter((uc) => uc.title.trim()).length;
  const hasIntent = state.intent.trim().length > 0;
  const hasContent = hasIntent || filledUseCases > 0 || state.components.length > 0;
  const canGenerate = hasIntent && !isGenerating;

  // Watch for design result and apply to builder
  useEffect(() => {
    if (design.phase === 'preview' && design.result && isGenerating) {
      dispatch({ type: 'APPLY_DESIGN_RESULT', payload: design.result });
      // Auto-match credentials from vault
      const creds = usePersonaStore.getState().credentials;
      dispatch({ type: 'AUTO_MATCH_CREDENTIALS', payload: { credentials: creds.map((c) => ({ id: c.id, service_type: c.service_type })) } });
      setIsGenerating(false);
      // Expand all sections so the user sees what was filled
      setExpanded(new Set(['intent', 'useCases', 'triggers', 'channels', 'policies']));
      // Trigger silent dry run + auto-fix
      setAutoTestGen((g) => g + 1);
    }
    if (design.error && isGenerating) {
      setIsGenerating(false);
    }
  }, [design.phase, design.result, design.error, isGenerating, dispatch]);

  // Auto-run dry run after generation to silently fix gaps
  useEffect(() => {
    if (autoTestGen > 0 && dryRun.phase === 'idle') {
      dryRun.runTest(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTestGen]);

  // Auto-apply all fixable proposals when dry run completes
  useEffect(() => {
    if (dryRun.phase === 'done' && dryRun.result) {
      for (const issue of dryRun.result.issues) {
        if (issue.proposal && !issue.resolved) {
          for (const action of issue.proposal.actions) {
            dispatch(action);
          }
          dryRun.markIssueResolved(issue.id);
        }
      }
    }
  }, [dryRun.phase, dryRun.result, dispatch, dryRun]);

  useEffect(() => {
    if (draftPersonaId) {
      isCreatingRef.current = false;
    }
  }, [draftPersonaId]);

  useEffect(() => {
    if (!isGenerating) {
      isCreatingRef.current = false;
    }
  }, [isGenerating]);

  const handleGenerate = useCallback(async () => {
    if (isCreatingRef.current) return;
    if (!canGenerate) return;
    isCreatingRef.current = true;
    setIsGenerating(true);
    setLogDismissed(false);

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

        // Move draft to a "Draft" group so it's visible but separated
        try {
          const groups = usePersonaStore.getState().groups;
          let draftGroup = groups.find((g) => g.name === 'Draft');
          if (!draftGroup) {
            draftGroup = await createGroup({ name: 'Draft', color: '#6B7280', description: 'Agents being designed' }) ?? undefined;
          }
          if (draftGroup) {
            await movePersonaToGroup(personaId, draftGroup.id);
          }
        } catch {
          // intentional: non-critical — draft still works without a group
        }
      }

      // Build enhanced intent with component names grouped by role
      let enhancedIntent = state.intent.trim();
      if (state.components.length > 0) {
        const byRole: Record<string, string[]> = {};
        for (const c of state.components) {
          (byRole[c.role] ??= []).push(c.connectorName);
        }
        const parts = Object.entries(byRole).map(([role, names]) => `${role}: ${names.join(', ')}`);
        enhancedIntent += `\nComponents: ${parts.join('; ')}`;
      }

      await design.startIntentCompilation(personaId, enhancedIntent);
    } catch {
      useToastStore.getState().addToast('Failed to generate agent — check your connection', 'error');
      isCreatingRef.current = false;
      setIsGenerating(false);
    }
  }, [canGenerate, draftPersonaId, state.intent, state.components, createPersona, createGroup, movePersonaToGroup, setDraftPersonaId, design]);

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
          badge={state.components.length > 0 ? `${state.components.length} component${state.components.length !== 1 ? 's' : ''}` : undefined}
          expanded={expanded}
          onToggle={toggleSection}
        >
          <div className="space-y-4">
            {/* Intent textarea */}
            <div className="space-y-1.5">
              <textarea
                value={state.intent}
                onChange={(e) => dispatch({ type: 'SET_INTENT', payload: e.target.value })}
                placeholder="Describe your agent's purpose..."
                rows={3}
                className="w-full px-3 py-2 bg-secondary/30 border border-primary/10 rounded-xl text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
              />
            </div>

            {/* Components subsection */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Plug className="w-3 h-3 text-muted-foreground/60" />
                <p className="text-sm font-medium text-muted-foreground/70">Components</p>
              </div>
              <ComponentsPicker
                components={state.components}
                onAdd={(payload) => dispatch({ type: 'ADD_COMPONENT', payload })}
                onRemove={(id) => dispatch({ type: 'REMOVE_COMPONENT', payload: id })}
                onSetWatchedTables={(componentId, tables) =>
                  dispatch({ type: 'SET_WATCHED_TABLES', payload: { componentId, tables } })
                }
              />
            </div>

          </div>
        </CollapsibleSection>

        {/* Streaming output — persists after error so user can read the log */}
        {!logDismissed && design.outputLines.length > 0 && (
          <div className="relative max-h-48 overflow-y-auto rounded-xl bg-background/50 border border-primary/10 p-3 font-mono text-sm text-muted-foreground/60 leading-relaxed">
            {/* Dismiss button (only when not actively generating) */}
            {!isGenerating && (
              <button
                type="button"
                onClick={() => setLogDismissed(true)}
                className="absolute top-2 right-2 p-1 rounded-lg hover:bg-secondary/40 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            {design.outputLines.slice(-30).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {/* Processing indicator */}
            {isGenerating && (
              <div className="flex items-center gap-1.5 mt-1 text-primary/60">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Processing...</span>
              </div>
            )}
            {/* Inline error after log lines */}
            {design.error && !isGenerating && (
              <div className="mt-2 pt-2 border-t border-red-400/20 text-red-400/80">
                Error: {design.error}
              </div>
            )}
          </div>
        )}

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
            onReorder={(fromIndex, toIndex) => dispatch({ type: 'REORDER_USE_CASES', payload: { fromIndex, toIndex } })}
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

        {/* D. Policies */}
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
        <div className="flex items-center justify-between pt-3">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground/80 transition-colors"
            >
              Cancel
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            {canGenerate && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="px-4 py-2.5 text-sm font-medium rounded-xl border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                {isGenerating ? 'Enhancing...' : 'Enhance with AI'}
              </button>
            )}
            <div className="flex flex-col items-end">
              <button
                type="button"
                onClick={onContinue}
                disabled={!hasIntent}
                className={`px-6 py-2.5 text-sm font-semibold rounded-xl transition-all flex items-center gap-2 ${
                  hasIntent
                    ? 'bg-btn-primary hover:bg-btn-primary/90 text-white shadow-md shadow-btn-primary/25 hover:shadow-btn-primary/35 hover:scale-[1.01] active:scale-[0.99]'
                    : 'bg-secondary/50 text-muted-foreground/50 cursor-not-allowed'
                }`}
              >
                Continue
              </button>
              {!hasIntent && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="text-muted-foreground text-xs mt-1.5"
                >
                  Describe what your agent should do
                </motion.p>
              )}
            </div>
          </div>
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
            <p className="text-sm text-muted-foreground/70 truncate">
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
              disabled={!hasIntent}
              className="btn-md font-medium bg-btn-primary text-white"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
