/**
 * MatrixCreator — "Matrix" mode for persona creation.
 *
 * Renders PersonaMatrix in edit mode with AI generation via useMatrixOrchestration.
 * The center command-cell acts as intent input / generate / completeness hub.
 */
import { useMemo, useState, useCallback, type Dispatch } from 'react';
import { PersonaMatrix } from '@/features/templates/sub_generated/gallery/matrix/PersonaMatrix';
import { usePersonaStore } from '@/stores/personaStore';
import { getArchitectureComponent } from '@/lib/credentials/connectorRoles';
import type { AgentIR } from '@/lib/types/designTypes';
import type { RequiredConnector } from '@/features/templates/sub_generated/adoption/steps/connect/ConnectStep';
import type { MatrixEditState, MatrixEditCallbacks } from '@/features/templates/sub_generated/gallery/matrix/matrixEditTypes';
import type { BuilderState, TriggerPreset } from './builder/types';
import type { BuilderAction } from './builder/builderReducer';
import { useMatrixOrchestration } from './builder/useMatrixOrchestration';

const BUILTIN = new Set(['personas_messages', 'personas_database', 'in-app-messaging']);

interface MatrixCreatorProps {
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  onContinue: () => void;
  onCancel?: () => void;
  draftPersonaId: string | null;
  setDraftPersonaId: (id: string | null) => void;
}

function triggerToSuggested(preset: TriggerPreset) {
  return {
    trigger_type: preset.type as 'schedule' | 'webhook' | 'manual',
    config: preset.cron ? { cron: preset.cron } : {},
    description: preset.label,
  };
}

export function MatrixCreator({ state, dispatch, onContinue, onCancel, draftPersonaId, setDraftPersonaId }: MatrixCreatorProps) {
  const credentials = usePersonaStore((s) => s.credentials);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);

  // ── AI orchestration ──────────────────────────────────────────────
  const orchestration = useMatrixOrchestration({ state, dispatch, draftPersonaId, setDraftPersonaId });

  // ── Derive AgentIR from BuilderState ─────────────────────────────

  const designResult = useMemo<AgentIR>(() => {
    const connectors = state.components
      .filter((c) => !BUILTIN.has(c.connectorName))
      .map((c) => ({ name: c.connectorName, role: c.role }));

    const triggers = state.globalTrigger
      ? [triggerToSuggested(state.globalTrigger)]
      : [];

    const errorStrategy = state.errorStrategy;
    const reviewPolicy = state.reviewPolicy;

    const capabilities = [
      ...(reviewPolicy !== 'never'
        ? [{ type: 'manual_review' as const, context: reviewPolicy, source_node: '' }]
        : []),
      { type: 'agent_memory' as const, context: 'Persistent cross-run memory', source_node: '' },
    ];

    const channels = state.channels.map((ch) => ({
      type: ch.type as 'slack' | 'telegram' | 'email',
      description: ch.type,
      required_connector: ch.type,
      config_hints: ch.config ?? {},
    }));

    return {
      structured_prompt: {
        identity: state.intent || 'General-purpose AI agent',
        instructions: '',
        toolGuidance: '',
        examples: '',
        errorHandling: errorStrategy,
        customSections: [],
      },
      suggested_tools: connectors.map((c) => c.name),
      suggested_triggers: triggers,
      full_prompt_markdown: '',
      summary: state.intent || 'New agent',
      suggested_connectors: connectors,
      suggested_notification_channels: channels,
      protocol_capabilities: capabilities,
      suggested_event_subscriptions: [],
    };
  }, [state.components, state.globalTrigger, state.errorStrategy, state.reviewPolicy, state.channels, state.intent]);

  // ── Derive RequiredConnectors from components ────────────────────

  const requiredConnectors = useMemo<RequiredConnector[]>(() => {
    // Always include personas_database as builtin
    const result: RequiredConnector[] = [
      { name: 'personas_database', activeName: 'personas_database' },
    ];

    for (const comp of state.components) {
      if (BUILTIN.has(comp.connectorName)) continue;
      const arch = getArchitectureComponent(comp.connectorName);
      result.push({
        name: comp.connectorName,
        activeName: comp.connectorName,
        role: comp.role,
        roleLabel: arch?.label,
        roleMembers: arch?.members,
      });
    }
    return result;
  }, [state.components]);

  // ── Flows from use cases ─────────────────────────────────────────

  const flows = useMemo(() =>
    state.useCases
      .filter((uc) => uc.title.trim())
      .map((uc) => ({
        id: uc.id,
        name: uc.title,
        description: uc.description,
        category: uc.category || 'automation',
        steps: [],
      })),
    [state.useCases],
  );

  // ── Matrix edit state ────────────────────────────────────────────

  const [connectorCredentialMap, setConnectorCredentialMap] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const comp of state.components) {
      if (comp.credentialId) map[comp.connectorName] = comp.credentialId;
    }
    return map;
  });
  const [connectorSwaps, setConnectorSwaps] = useState<Record<string, string>>({});
  const [triggerConfigs, setTriggerConfigs] = useState<Record<number, Record<string, string>>>({});
  const [requireApproval, setRequireApproval] = useState(state.reviewPolicy !== 'never');
  const [autoApproveSeverity, setAutoApproveSeverity] = useState('info');
  const [reviewTimeout, setReviewTimeout] = useState('24h');
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memoryScope, setMemoryScope] = useState('all');
  const [messagePreset, setMessagePreset] = useState('updates');
  const [databaseMode, setDatabaseMode] = useState<'create' | 'existing'>('create');

  const useCasesForEdit = useMemo(() =>
    state.useCases.filter((uc) => uc.title.trim()).map((uc) => ({ id: uc.id, title: uc.title, category: uc.category || 'automation' })),
    [state.useCases],
  );

  const editState = useMemo<MatrixEditState>(() => ({
    connectorCredentialMap,
    connectorSwaps,
    triggerConfigs,
    requireApproval,
    autoApproveSeverity,
    reviewTimeout,
    memoryEnabled,
    memoryScope,
    messagePreset,
    databaseMode,
    errorStrategy: state.errorStrategy,
    useCases: useCasesForEdit,
  }), [connectorCredentialMap, connectorSwaps, triggerConfigs, requireApproval, autoApproveSeverity, reviewTimeout, memoryEnabled, memoryScope, messagePreset, databaseMode, state.errorStrategy, useCasesForEdit]);

  const editCallbacks = useMemo<MatrixEditCallbacks>(() => ({
    onCredentialSelect: (connectorName, credentialId) => {
      setConnectorCredentialMap((prev) => ({ ...prev, [connectorName]: credentialId }));
      // Sync to builder state
      const comp = state.components.find((c) => c.connectorName === connectorName);
      if (comp) {
        dispatch({ type: 'UPDATE_COMPONENT_CREDENTIAL', payload: { componentId: comp.id, credentialId } });
      }
    },
    onConnectorSwap: (originalName, replacementName) => {
      setConnectorSwaps((prev) => ({ ...prev, [originalName]: replacementName }));
    },
    onTriggerConfigChange: (index, config) => {
      setTriggerConfigs((prev) => ({ ...prev, [index]: config }));
    },
    onToggleApproval: (value) => {
      setRequireApproval(value);
      dispatch({ type: 'SET_REVIEW_POLICY', payload: value ? 'on-error' : 'never' });
    },
    onToggleMemory: (value) => {
      setMemoryEnabled(value);
    },
    onPreferenceChange: (key, value) => {
      if (key === 'messagePreset') setMessagePreset(value as string);
      else if (key === 'databaseMode') setDatabaseMode(value as 'create' | 'existing');
      else if (key === 'autoApproveSeverity') setAutoApproveSeverity(value as string);
      else if (key === 'reviewTimeout') setReviewTimeout(value as string);
      else if (key === 'memoryScope') setMemoryScope(value as string);
    },
    onErrorStrategyChange: (value) => {
      dispatch({ type: 'SET_ERROR_STRATEGY', payload: value });
    },
    onUseCaseAdd: (title) => {
      dispatch({ type: 'ADD_USE_CASE_WITH_DATA', payload: { title, description: '' } });
    },
    onUseCaseRemove: (id) => {
      dispatch({ type: 'REMOVE_USE_CASE', payload: id });
    },
    onUseCaseUpdate: (id, title) => {
      dispatch({ type: 'UPDATE_USE_CASE', payload: { id, updates: { title } } });
    },
  }), [state.components, dispatch]);

  const handleNavigateCatalog = useCallback(() => {
    setSidebarSection('credentials');
  }, [setSidebarSection]);

  return (
    <div className="flex flex-col gap-5 h-full">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <PersonaMatrix
          designResult={designResult}
          flows={flows}
          mode="edit"
          hideHeader
          editState={editState}
          editCallbacks={editCallbacks}
          requiredConnectors={requiredConnectors}
          credentials={credentials}
          onNavigateCatalog={handleNavigateCatalog}
          // Creation mode props
          variant="creation"
          intentText={state.intent}
          onIntentChange={(text) => dispatch({ type: 'SET_INTENT', payload: text })}
          onLaunch={orchestration.handleGenerate}
          launchDisabled={!orchestration.canGenerate}
          isRunning={orchestration.isGenerating}
          completeness={orchestration.completeness}
          hasDesignResult={orchestration.hasDesignResult}
          onContinue={onContinue}
          onRefine={orchestration.handleRefine}
        />
      </div>

      {/* Cancel link — continue is inside the command center */}
      {onCancel && (
        <div className="flex items-center justify-start pt-3 border-t border-primary/10 flex-shrink-0">
          <button type="button" onClick={onCancel} className="text-sm text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
