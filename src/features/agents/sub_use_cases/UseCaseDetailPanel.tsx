import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Play, Square, Loader2, ArrowRight } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useEditorDirty } from '@/features/agents/sub_editor/EditorDocument';
import { getUseCaseById, updateUseCaseInContext, applyDesignContextMutation } from '@/features/agents/sub_use_cases/useCaseHelpers';
import type { UseCaseItem } from '@/features/shared/components/UseCasesList';
import type { NotificationChannelType, ModelProfile, ModelProvider } from '@/lib/types/frontendTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { profileToLabel, profileToModelConfig, type ModelOption } from './useCaseDetailHelpers';
import { UseCaseModelDropdown } from './UseCaseModelDropdown';
import { UseCaseChannelDropdown } from './UseCaseChannelDropdown';

interface UseCaseDetailPanelProps {
  useCaseId: string;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

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

  const handleUpdate = useCallback(
    async (update: Partial<UseCaseItem> | ((uc: UseCaseItem) => Partial<UseCaseItem>)) => {
      if (!selectedPersona) return;
      setIsDirty(true);
      setSaveError(null);
      try {
        await applyDesignContextMutation(selectedPersona.id, (ctx) =>
          updateUseCaseInContext(ctx, useCaseId, (uc) => {
            const partial = typeof update === 'function' ? update(uc) : update;
            return { ...uc, ...partial };
          }),
        );
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

  const resolvedProfile = useMemo<ModelProfile>(() => {
    if (useCase?.model_override) return useCase.model_override;
    if (!selectedPersona?.model_profile) return { model: 'sonnet', provider: 'anthropic' };
    try {
      return JSON.parse(selectedPersona.model_profile) as ModelProfile;
    } catch {
      return { model: 'sonnet', provider: 'anthropic' };
    }
  }, [useCase?.model_override, selectedPersona?.model_profile]);

  const modelConfig = useMemo(() => profileToModelConfig(resolvedProfile), [resolvedProfile]);

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
  const hasOverride = !!useCase.model_override;
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;
  const personaDefaultLabel = useMemo(() => {
    if (!selectedPersona?.model_profile) return 'Sonnet';
    try {
      return profileToLabel(JSON.parse(selectedPersona.model_profile) as ModelProfile);
    } catch {
      return 'Sonnet';
    }
  }, [selectedPersona?.model_profile]);

  const modelLabel = hasOverride ? profileToLabel(useCase.model_override) : personaDefaultLabel;

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
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
      {/* Left cell: Model + Channel dropdowns */}
      <div className="flex items-center gap-2.5 min-w-0">
        <UseCaseModelDropdown
          hasOverride={hasOverride}
          modelLabel={modelLabel}
          personaDefaultLabel={personaDefaultLabel}
          useCase={useCase}
          onSelectModel={handleModelSelect}
        />
        <UseCaseChannelDropdown channels={channels} onToggle={handleChannelToggle} />
      </div>

      {/* Right cell: Test button + Tests link */}
      <div className="flex items-center gap-2.5">
        {isTestRunning ? (
          <button
            onClick={handleCancelTest}
            disabled={!canCancel}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={!canCancel ? 'Waiting for test to start...' : 'Stop test'}
          >
            <Square className="w-3.5 h-3.5" /> Stop
          </button>
        ) : (
          <button
            onClick={handleRunTest}
            disabled={!hasPrompt || !modelConfig}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

      {/* Full-width row: progress indicator and save error */}
      {(isTestRunning && testRunProgress || saveError) && (
        <div className="col-span-full flex items-center gap-2.5">
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
              className="text-xs text-red-400/80 cursor-pointer hover:text-red-400 transition-colors"
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
