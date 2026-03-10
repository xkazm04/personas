import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Play, Square, Loader2, ArrowRight, Radio, Zap, Clock, ChevronRight } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useEditorDirty } from '@/features/agents/sub_editor/EditorDocument';
import { getUseCaseById } from '@/features/agents/sub_use_cases/useCaseHelpers';
import { mutateSingleUseCase } from '@/hooks/design/core/useDesignContextMutator';
import type { UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import type { NotificationChannelType, ModelProfile, ModelProvider, TestFixture } from '@/lib/types/frontendTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { resolveEffectiveModel, type ModelOption } from './useCaseDetailHelpers';
import { UseCaseModelDropdown } from './UseCaseModelDropdown';
import { UseCaseChannelDropdown } from './UseCaseChannelDropdown';
import { UseCaseFixtureDropdown } from './UseCaseFixtureDropdown';

interface UseCaseDetailPanelProps {
  useCaseId: string;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

// ── Pipeline stage visual ─────────────────────────────────────────────

function PipelineArrow() {
  return (
    <div className="flex items-center justify-center px-0.5 flex-shrink-0">
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
    </div>
  );
}

function InputStageSummary({ useCase }: { useCase: UseCaseItem }) {
  const trigger = useCase.suggested_trigger;
  const subs = useCase.event_subscriptions?.filter((s) => s.enabled) ?? [];
  const hasTrigger = !!trigger;
  const hasSubscriptions = subs.length > 0;
  const hasAny = hasTrigger || hasSubscriptions;

  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-all min-w-0 ${
        hasAny
          ? 'bg-cyan-500/8 border-cyan-500/20 text-foreground/90'
          : 'bg-secondary/40 border-primary/10 text-muted-foreground/60'
      }`}
    >
      {hasTrigger ? (
        <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
      ) : (
        <Radio className={`w-3.5 h-3.5 flex-shrink-0 ${hasSubscriptions ? 'text-cyan-400' : 'text-muted-foreground/40'}`} />
      )}
      <span className="truncate flex-1 text-left">
        {!hasAny && 'No inputs'}
        {hasTrigger && !hasSubscriptions && (
          <>
            <Clock className="w-3 h-3 text-amber-400/70 inline mr-0.5" />
            {trigger.type}
            {trigger.cron && <span className="text-muted-foreground/50 text-sm ml-1">{trigger.cron}</span>}
          </>
        )}
        {!hasTrigger && hasSubscriptions && (
          `${subs.length} event${subs.length !== 1 ? 's' : ''}`
        )}
        {hasTrigger && hasSubscriptions && (
          <>
            <Clock className="w-3 h-3 text-amber-400/70 inline mr-0.5" />
            {trigger.type} + {subs.length} event{subs.length !== 1 ? 's' : ''}
          </>
        )}
      </span>
      {hasAny && (
        <span className="text-sm font-semibold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 flex-shrink-0">
          Input
        </span>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export function UseCaseDetailPanel({ useCaseId, credentials: _credentials, connectorDefinitions: _connectorDefinitions }: UseCaseDetailPanelProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const isTestRunning = usePersonaStore((s) => s.isTestRunning);
  const testRunProgress = usePersonaStore((s) => s.testRunProgress);
  const startTest = usePersonaStore((s) => s.startTest);
  const cancelTest = usePersonaStore((s) => s.cancelTest);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);

  const useCase = getUseCaseById(selectedPersona?.design_context, useCaseId);
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);

  const fixtures = useMemo(() => useCase?.test_fixtures ?? [], [useCase?.test_fixtures]);
  const selectedFixture = useMemo(
    () => fixtures.find((f) => f.id === selectedFixtureId) ?? null,
    [fixtures, selectedFixtureId],
  );

  const handleUpdate = useCallback(
    async (update: Partial<UseCaseItem> | ((uc: UseCaseItem) => Partial<UseCaseItem>)) => {
      if (!selectedPersona) return;
      setIsDirty(true);
      setSaveError(null);
      try {
        await mutateSingleUseCase(selectedPersona.id, useCaseId, (uc) => {
          const partial = typeof update === 'function' ? update(uc) : update;
          return { ...uc, ...partial };
        });
        setIsDirty(false);
      } catch (error) {
        console.error('Failed to update use case:', error);
        setSaveError(error instanceof Error ? error.message : 'Failed to save changes');
      }
    },
    [selectedPersona, useCaseId],
  );

  // Register dirty state with editor context
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  saveRef.current = async () => { /* auto-saved on every change */ };
  const stableSave = useCallback(async () => { await saveRef.current(); }, []);
  useEditorDirty('use-cases', isDirty, stableSave);
  useEffect(() => { setIsDirty(false); setSaveError(null); }, [selectedPersona?.id]);

  const resolved = useMemo(
    () => resolveEffectiveModel(useCase?.model_override, selectedPersona?.model_profile),
    [useCase?.model_override, selectedPersona?.model_profile],
  );
  const modelConfig = resolved.config;

  const handleRunTest = useCallback(async () => {
    if (!selectedPersona || !modelConfig) return;
    await startTest(selectedPersona.id, [modelConfig], useCaseId);
  }, [selectedPersona, modelConfig, useCaseId, startTest]);

  const handleCancelTest = useCallback(async () => {
    if (testRunProgress?.runId) {
      await cancelTest(testRunProgress.runId);
    }
  }, [testRunProgress, cancelTest]);

  if (!useCase) {
    return (
      <div className="flex items-center justify-center py-2 text-sm text-muted-foreground/60">
        Use case not found.
      </div>
    );
  }

  const canCancel = !!testRunProgress?.runId;
  const channels = useCase.notification_channels ?? [];
  const hasOverride = resolved.source === 'override';
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;
  const personaDefault = resolveEffectiveModel(undefined, selectedPersona?.model_profile);
  const personaDefaultLabel = personaDefault.label;
  const modelLabel = resolved.label;

  const handleModelSelect = (opt: ModelOption) => {
    if (opt.id === '__default__') {
      handleUpdate({ model_override: undefined });
    } else {
      const profile: ModelProfile = {
        model: opt.model,
        provider: opt.provider as ModelProvider,
        base_url: opt.base_url,
      };
      handleUpdate({ model_override: profile });
    }
  };

  const handleSaveFixture = useCallback(
    (name: string, description: string, inputs: Record<string, unknown>) => {
      if (!selectedPersona) return;
      const now = new Date().toISOString();
      const fixture: TestFixture = {
        id: `fixture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        description: description || undefined,
        inputs: Object.keys(inputs).length > 0 ? inputs : (useCase?.sample_input ?? {}),
        created_at: now,
        updated_at: now,
      };
      handleUpdate((uc) => ({
        test_fixtures: [...(uc.test_fixtures ?? []), fixture],
      }));
      setSelectedFixtureId(fixture.id);
    },
    [selectedPersona, useCase?.sample_input, handleUpdate],
  );

  const handleDeleteFixture = useCallback(
    (fixtureId: string) => {
      handleUpdate((uc) => ({
        test_fixtures: (uc.test_fixtures ?? []).filter((f) => f.id !== fixtureId),
      }));
      if (selectedFixtureId === fixtureId) setSelectedFixtureId(null);
    },
    [handleUpdate, selectedFixtureId],
  );

  const handleUpdateFixture = useCallback(
    (fixtureId: string, inputs: Record<string, unknown>) => {
      handleUpdate((uc) => ({
        test_fixtures: (uc.test_fixtures ?? []).map((f) =>
          f.id === fixtureId ? { ...f, inputs, updated_at: new Date().toISOString() } : f,
        ),
      }));
    },
    [handleUpdate],
  );

  const handleChannelToggle = (type: NotificationChannelType) => {
    handleUpdate((uc) => {
      const current = uc.notification_channels ?? [];
      const exists = current.some((c) => c.type === type);
      const next = exists
        ? current.filter((c) => c.type !== type)
        : [...current, { type, config: {}, enabled: true }];
      return { notification_channels: next.length > 0 ? next : undefined };
    });
  };

  return (
    <div className="space-y-1.5">
      {/* Pipeline: Input -> Transform -> Output + Test actions */}
      <div className="flex items-center gap-0.5">
        {/* Input Sources */}
        <div className="min-w-0 flex-1">
          <InputStageSummary useCase={useCase} />
        </div>

        <PipelineArrow />

        {/* Transform: Model Config */}
        <div className="min-w-0 flex-1">
          <UseCaseModelDropdown
            hasOverride={hasOverride}
            modelLabel={modelLabel}
            personaDefaultLabel={personaDefaultLabel}
            useCase={useCase}
            onSelectModel={handleModelSelect}
          />
        </div>

        <PipelineArrow />

        {/* Output Channels */}
        <div className="min-w-0 flex-1">
          <UseCaseChannelDropdown channels={channels} onToggle={handleChannelToggle} />
        </div>

        {/* Fixture + Test actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-1.5">
          <UseCaseFixtureDropdown
            fixtures={fixtures}
            selectedFixtureId={selectedFixtureId}
            onSelect={setSelectedFixtureId}
            onSave={handleSaveFixture}
            onDelete={handleDeleteFixture}
            onUpdate={handleUpdateFixture}
            currentInputs={selectedFixture?.inputs ?? useCase.sample_input ?? undefined}
          />
          {isTestRunning ? (
            <button
              onClick={handleCancelTest}
              disabled={!canCancel}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={!canCancel ? 'Waiting for test to start...' : 'Stop test'}
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          ) : (
            <button
              onClick={handleRunTest}
              disabled={!hasPrompt || !modelConfig}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={!hasPrompt ? 'No prompt configured' : 'Test this use case'}
            >
              <Play className="w-3.5 h-3.5" /> Test
            </button>
          )}
          <button
            onClick={() => setEditorTab('lab')}
            className="flex items-center gap-1 text-sm text-muted-foreground/40 hover:text-primary/70 transition-colors"
            title="View full test history"
          >
            Tests <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Pipeline stage labels */}
      <div className="flex items-center gap-0.5 px-1">
        <span className="flex-1 text-center text-sm text-muted-foreground/35 uppercase tracking-wider font-medium">Input</span>
        <div className="w-3.5 flex-shrink-0" />
        <span className="flex-1 text-center text-sm text-muted-foreground/35 uppercase tracking-wider font-medium">Transform</span>
        <div className="w-3.5 flex-shrink-0" />
        <span className="flex-1 text-center text-sm text-muted-foreground/35 uppercase tracking-wider font-medium">Output</span>
        {/* Spacer matching the test actions width */}
        <div className="flex-shrink-0 ml-1.5" style={{ width: 130 }} />
      </div>

      {/* Full-width row: progress indicator and save error */}
      {(isTestRunning && testRunProgress || saveError) && (
        <div className="flex items-center gap-2.5">
          {isTestRunning && testRunProgress && (
            <span className="flex items-center gap-1.5 text-muted-foreground/60">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              <span className="capitalize text-sm">
                {testRunProgress.phase === 'generating'
                  ? 'Generating...'
                  : testRunProgress.phase === 'executing'
                    ? 'Testing...'
                    : testRunProgress.phase}
              </span>
            </span>
          )}
          {saveError && (
            <span
              className="text-sm text-red-400/80 cursor-pointer hover:text-red-400 transition-colors"
              title={saveError}
              onClick={() => setSaveError(null)}
            >
              Save failed
            </span>
          )}
        </div>
      )}
    </div>
  );
}
