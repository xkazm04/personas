/**
 * MatrixCreator — "Matrix" mode for persona creation.
 *
 * Renders PersonaMatrix in edit mode with default boilerplate values
 * derived from the current BuilderState. No template connection required.
 */
import { useMemo, useState, useCallback, type Dispatch } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { PersonaMatrix } from '@/features/templates/sub_generated/gallery/matrix/PersonaMatrix';
import { usePersonaStore } from '@/stores/personaStore';
import { getArchitectureComponent } from '@/lib/credentials/connectorRoles';
import type { AgentIR } from '@/lib/types/designTypes';
import type { RequiredConnector } from '@/features/templates/sub_generated/adoption/steps/connect/ConnectStep';
import type { MatrixEditState, MatrixEditCallbacks } from '@/features/templates/sub_generated/gallery/matrix/matrixEditTypes';
import type { BuilderState, TriggerPreset } from './builder/types';
import type { BuilderAction } from './builder/builderReducer';

const BUILTIN = new Set(['personas_messages', 'personas_database', 'in-app-messaging']);

interface MatrixCreatorProps {
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  onContinue: () => void;
  onCancel?: () => void;
}

function triggerToSuggested(preset: TriggerPreset) {
  return {
    trigger_type: preset.type as 'schedule' | 'webhook' | 'manual',
    config: preset.cron ? { cron: preset.cron } : {},
    description: preset.label,
  };
}

export function MatrixCreator({ state, dispatch, onContinue, onCancel }: MatrixCreatorProps) {
  const credentials = usePersonaStore((s) => s.credentials);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);

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
  }), [connectorCredentialMap, connectorSwaps, triggerConfigs, requireApproval, autoApproveSeverity, reviewTimeout, memoryEnabled, memoryScope, messagePreset, databaseMode]);

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
  }), [state.components, dispatch]);

  const handleNavigateCatalog = useCallback(() => {
    setSidebarSection('credentials');
  }, [setSidebarSection]);

  // ── Check readiness ──────────────────────────────────────────────

  const externalConnectors = requiredConnectors.filter((rc) => !BUILTIN.has(rc.activeName));
  const allMatched = externalConnectors.every((rc) => !!connectorCredentialMap[rc.activeName]);
  const canContinue = state.components.length > 0 || state.useCases.length > 0;

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
          launchLabel="Continue"
          launchDisabled={!canContinue}
          onLaunch={onContinue}
          onNavigateCatalog={handleNavigateCatalog}
        />
      </div>

      {/* Footer with action buttons */}
      <div className="flex items-center justify-between pt-3 border-t border-primary/10 flex-shrink-0">
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-muted-foreground/60">
            Cancel
          </Button>
        ) : <span />}
        <Button
          variant="primary"
          size="sm"
          onClick={onContinue}
          disabled={!canContinue}
          iconRight={<ArrowRight className="w-3.5 h-3.5" />}
        >
          Continue to Identity
        </Button>
      </div>
    </div>
  );
}
