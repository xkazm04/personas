import { type Dispatch } from 'react';
import {
  FileText,
  ListChecks,
  Plug,
  Clock,
  Shield,
} from 'lucide-react';
import type { BuilderState } from './builder/types';
import type { BuilderAction } from './builder/builderReducer';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { UseCaseBuilder } from '../pickers/use_cases/UseCaseBuilder';
import { ComponentsPicker } from '../pickers/selectors/ComponentsPicker';
import { TriggerPresetPicker } from '../pickers/triggers/TriggerPresetPicker';
import { PolicyPicker } from '../pickers/selectors/PolicyPicker';
import { BuilderPreview } from './BuilderPreview';
import { CollapsibleSection } from './CollapsibleSection';
import { useBuilderOrchestration } from './builder/useBuilderOrchestration';
import { StreamingLogPanel, BuilderActionBar } from './BuilderActionComponents';

interface BuilderStepProps {
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  onContinue: () => void;
  onCancel?: () => void;
  draftPersonaId: string | null;
  setDraftPersonaId: (id: string | null) => void;
}

export function BuilderStep({ state, dispatch, onContinue, onCancel, draftPersonaId, setDraftPersonaId }: BuilderStepProps) {
  const {
    expanded,
    toggleSection,
    filledUseCases,
    hasIntent,
    hasContent,
    canGenerate,
    isGenerating,
    logDismissed,
    setLogDismissed,
    design,
    handleGenerate,
  } = useBuilderOrchestration({ state, dispatch, draftPersonaId, setDraftPersonaId });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] 3xl:grid-cols-[1fr_340px] 4xl:grid-cols-[1fr_400px] gap-6 w-full">
      {/* Left column: builder sections */}
      <div className="space-y-3 min-w-0" style={{ minWidth: 900 }}>
        <SectionHeader
          icon={<FileText className="w-3.5 h-3.5" />}
          label="Build your agent"
        />

        {/* A. Intent & Components */}
        <CollapsibleSection
          id="intent"
          icon={<FileText className="w-3.5 h-3.5" />}
          label="Intent & Components"
          badge={state.components.length > 0 ? `${state.components.length} component${state.components.length !== 1 ? 's' : ''}` : undefined}
          expanded={expanded}
          onToggle={toggleSection}
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <textarea
                value={state.intent}
                onChange={(e) => dispatch({ type: 'SET_INTENT', payload: e.target.value })}
                placeholder="Describe your agent's purpose..."
                rows={3}
                className="w-full px-3 py-2 bg-secondary/30 border border-primary/10 rounded-xl text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-y"
              />
            </div>
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

        {/* Streaming output */}
        {!logDismissed && design.outputLines.length > 0 && (
          <StreamingLogPanel
            outputLines={design.outputLines}
            isGenerating={isGenerating}
            error={design.error}
            onDismiss={() => setLogDismissed(true)}
          />
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
        <BuilderActionBar
          hasIntent={hasIntent}
          canGenerate={canGenerate}
          isGenerating={isGenerating}
          onGenerate={handleGenerate}
          onContinue={onContinue}
          onCancel={onCancel}
        />
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
                .join(' \u00B7 ') || 'Building...'}
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
