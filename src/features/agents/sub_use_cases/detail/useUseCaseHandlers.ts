import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useEditorDirty } from '@/features/agents/sub_editor/EditorDocument';
import { getUseCaseById } from '@/features/agents/sub_use_cases/useCaseHelpers';
import { mutateSingleUseCase } from '@/hooks/design/core/useDesignContextMutator';
import type { UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import type { NotificationChannelType, ModelProfile, ModelProvider, TestFixture } from '@/lib/types/frontendTypes';
import { resolveEffectiveModel, type ModelOption } from './useCaseDetailHelpers';

export function useUseCaseHandlers(useCaseId: string) {
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

  return {
    selectedPersona,
    isTestRunning,
    testRunProgress,
    setEditorTab,
    useCase,
    saveError,
    setSaveError,
    selectedFixtureId,
    setSelectedFixtureId,
    fixtures,
    selectedFixture,
    modelConfig,
    hasOverride,
    hasPrompt,
    personaDefaultLabel,
    modelLabel,
    handleRunTest,
    handleCancelTest,
    handleModelSelect,
    handleSaveFixture,
    handleDeleteFixture,
    handleUpdateFixture,
    handleChannelToggle,
  };
}
