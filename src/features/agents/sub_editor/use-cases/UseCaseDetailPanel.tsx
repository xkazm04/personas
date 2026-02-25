import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Cpu, Bell, ChevronDown, Check, Play, Square, Loader2, ArrowRight, Hash, Send, Mail } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useEditorDirty } from '@/features/agents/sub_editor/EditorDirtyContext';
import { getUseCaseById, updateUseCaseInContext } from '@/features/agents/sub_editor/use-cases/useCaseHelpers';
import { Listbox } from '@/features/shared/components/Listbox';
import type { UseCaseItem } from '@/features/shared/components/UseCasesList';
import type { NotificationChannel, NotificationChannelType, ModelProfile, ModelProvider } from '@/lib/types/frontendTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { ModelTestConfig } from '@/api/tests';
import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';

// ── Model helpers ───────────────────────────────────────────────────

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  model?: string;
  base_url?: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  { id: '__default__', label: 'Default', provider: '' },
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'haiku' },
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', model: 'sonnet' },
  { id: 'opus', label: 'Opus', provider: 'anthropic' },
  ...OLLAMA_CLOUD_PRESETS.map((p) => ({
    id: p.value,
    label: p.label.split(' (')[0] ?? p.label,
    provider: 'ollama',
    model: p.modelId,
    base_url: OLLAMA_CLOUD_BASE_URL,
  })),
];

function profileToOptionId(mp: ModelProfile | undefined): string {
  if (!mp) return '__default__';
  const match = MODEL_OPTIONS.find(
    (o) => o.id !== '__default__' && o.model === mp.model && (o.provider === mp.provider || (!mp.provider && o.provider === 'anthropic')),
  );
  return match?.id ?? '__default__';
}

function profileToLabel(mp: ModelProfile | undefined): string {
  if (!mp) return 'Default';
  const opt = MODEL_OPTIONS.find(
    (o) => o.id !== '__default__' && o.model === mp.model && (o.provider === mp.provider || (!mp.provider && o.provider === 'anthropic')),
  );
  return opt?.label ?? mp.model ?? 'Custom';
}

function profileToModelConfig(mp: ModelProfile): ModelTestConfig | null {
  if (!mp.model && !mp.provider) return null;
  if (!mp.provider || mp.provider === 'anthropic') {
    return { id: mp.model || 'sonnet', provider: 'anthropic', model: mp.model };
  }
  if (mp.provider === 'ollama') {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.modelId === mp.model);
    return { id: preset?.value || mp.model || 'ollama', provider: 'ollama', model: mp.model, base_url: mp.base_url || OLLAMA_CLOUD_BASE_URL, auth_token: mp.auth_token };
  }
  return { id: mp.model || 'custom', provider: mp.provider, model: mp.model, base_url: mp.base_url, auth_token: mp.auth_token };
}

// ── Channel helpers ─────────────────────────────────────────────────

const CHANNEL_TYPES: { type: NotificationChannelType; label: string; Icon: typeof Hash }[] = [
  { type: 'slack', label: 'Slack', Icon: Hash },
  { type: 'telegram', label: 'Telegram', Icon: Send },
  { type: 'email', label: 'Email', Icon: Mail },
];

function channelSummary(channels: NotificationChannel[]): string {
  const enabled = channels.filter((c) => c.enabled);
  if (enabled.length === 0) return 'None';
  return enabled.map((c) => c.type.charAt(0).toUpperCase() + c.type.slice(1)).join(', ');
}

// ── Component ───────────────────────────────────────────────────────

interface UseCaseDetailPanelProps {
  useCaseId: string;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

export function UseCaseDetailPanel({ useCaseId, credentials: _credentials, connectorDefinitions: _connectorDefinitions }: UseCaseDetailPanelProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const updatePersona = usePersonaStore((s) => s.updatePersona);
  const isTestRunning = usePersonaStore((s) => s.isTestRunning);
  const testRunProgress = usePersonaStore((s) => s.testRunProgress);
  const startTest = usePersonaStore((s) => s.startTest);
  const cancelTest = usePersonaStore((s) => s.cancelTest);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);

  const useCase = getUseCaseById(selectedPersona?.design_context, useCaseId);
  const [isDirty, setIsDirty] = useState(false);

  // Persist changes to design_context
  const handleUpdate = useCallback(
    async (partial: Partial<UseCaseItem>) => {
      if (!selectedPersona) return;
      const newContext = updateUseCaseInContext(
        selectedPersona.design_context,
        useCaseId,
        (uc) => ({ ...uc, ...partial }),
      );
      setIsDirty(true);
      await updatePersona(selectedPersona.id, { design_context: newContext });
      setIsDirty(false);
    },
    [selectedPersona, useCaseId, updatePersona],
  );

  // Register dirty state with editor context
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  saveRef.current = async () => { /* auto-saved on every change */ };
  const stableSave = useCallback(async () => { await saveRef.current(); }, []);
  useEditorDirty('use-cases', isDirty, stableSave);

  useEffect(() => { setIsDirty(false); }, [selectedPersona?.id]);

  // ── Model resolution ────────────────────────────────────────────
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

  // ── Test handler ────────────────────────────────────────────────
  const handleRunTest = useCallback(async () => {
    if (!selectedPersona || !modelConfig) return;
    await startTest(selectedPersona.id, [modelConfig], useCaseId);
  }, [selectedPersona, modelConfig, useCaseId, startTest]);

  const handleCancelTest = useCallback(async () => {
    if (testRunProgress) {
      await cancelTest(testRunProgress.runId ?? '');
    }
  }, [testRunProgress, cancelTest]);

  if (!useCase) {
    return (
      <div className="flex items-center justify-center py-2 text-sm text-muted-foreground/60">
        Use case not found.
      </div>
    );
  }

  const channels = useCase.notification_channels ?? [];
  const hasOverride = !!useCase.model_override;
  const modelLabel = hasOverride ? profileToLabel(useCase.model_override) : 'Default';
  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

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
    const existing = channels.find((c) => c.type === type);
    let next: NotificationChannel[];
    if (existing) {
      next = channels.filter((c) => c.type !== type);
    } else {
      next = [...channels, { type, config: {}, enabled: true }];
    }
    handleUpdate({ notification_channels: next.length > 0 ? next : undefined });
  };

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      {/* Model dropdown */}
      <Listbox
        ariaLabel="Select model"
        itemCount={MODEL_OPTIONS.length}
        onSelectFocused={(index) => handleModelSelect(MODEL_OPTIONS[index]!)}
        className="min-w-[150px]"
        renderTrigger={({ isOpen, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium border transition-all w-full ${
              hasOverride
                ? 'bg-primary/10 border-primary/25 text-primary'
                : 'bg-secondary/40 border-primary/10 text-muted-foreground/80 hover:border-primary/20'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1 text-left truncate">{modelLabel}</span>
            <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      >
        {({ close, focusIndex }) => (
          <div className="py-1 max-h-48 overflow-y-auto">
            {MODEL_OPTIONS.map((opt, i) => {
              const isActive = opt.id === '__default__' ? !hasOverride : (hasOverride && profileToOptionId(useCase.model_override) === opt.id);
              return (
                <button
                  key={opt.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => { handleModelSelect(opt); close(); }}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm transition-colors ${
                    focusIndex === i ? 'bg-secondary/60' : 'hover:bg-secondary/40'
                  } ${isActive ? 'text-primary' : 'text-foreground/80'}`}
                >
                  <span className="flex-1 text-left">{opt.label}</span>
                  {isActive && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </Listbox>

      {/* Channel multiselect dropdown */}
      <Listbox
        ariaLabel="Select notification channels"
        className="min-w-[150px]"
        renderTrigger={({ isOpen, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium border transition-all w-full ${
              channels.length > 0
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                : 'bg-secondary/40 border-primary/10 text-muted-foreground/80 hover:border-primary/20'
            }`}
          >
            <Bell className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1 text-left truncate">{channelSummary(channels)}</span>
            <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      >
        {() => (
          <div className="py-1">
            {CHANNEL_TYPES.map((ct) => {
              const isEnabled = channels.some((c) => c.type === ct.type);
              return (
                <button
                  key={ct.type}
                  role="option"
                  aria-selected={isEnabled}
                  onClick={() => handleChannelToggle(ct.type)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm transition-colors hover:bg-secondary/40 ${
                    isEnabled ? 'text-primary' : 'text-foreground/80'
                  }`}
                >
                  <ct.Icon className="w-3.5 h-3.5" />
                  <span className="flex-1 text-left">{ct.label}</span>
                  {isEnabled && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </Listbox>

      {/* Test button */}
      {isTestRunning ? (
        <button
          onClick={handleCancelTest}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors"
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

      {/* Test progress indicator */}
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

      {/* Link to full tests */}
      <button
        onClick={() => setEditorTab('tests')}
        className="flex items-center gap-1 text-sm text-muted-foreground/40 hover:text-primary/70 transition-colors ml-auto"
        title="View full test history"
      >
        Tests <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}
