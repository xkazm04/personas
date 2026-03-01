import { useCallback, useMemo } from 'react';
import { FlaskConical, Play, Square, Loader2, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import type { UseCaseItem } from '@/features/shared/components/UseCasesList';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import type { ModelTestConfig } from '@/api/tests';
import {
  OLLAMA_CLOUD_BASE_URL,
  OLLAMA_CLOUD_PRESETS,
} from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';

function profileToModelConfig(mp: ModelProfile): ModelTestConfig | null {
  if (!mp.model && !mp.provider) return null;

  // Anthropic shorthand models
  if (!mp.provider || mp.provider === 'anthropic') {
    return {
      id: mp.model || 'sonnet',
      provider: 'anthropic',
      model: mp.model,
    };
  }

  // Ollama cloud
  if (mp.provider === 'ollama') {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.modelId === mp.model);
    return {
      id: preset?.value || mp.model || 'ollama',
      provider: 'ollama',
      model: mp.model,
      base_url: mp.base_url || OLLAMA_CLOUD_BASE_URL,
      auth_token: mp.auth_token,
    };
  }

  // Custom / LiteLLM
  return {
    id: mp.model || 'custom',
    provider: mp.provider,
    model: mp.model,
    base_url: mp.base_url,
    auth_token: mp.auth_token,
  };
}

function modelLabel(mp: ModelProfile | undefined): string {
  if (!mp) return 'Persona default';
  if (!mp.provider || mp.provider === 'anthropic') {
    if (mp.model === 'haiku') return 'Haiku';
    if (mp.model === 'sonnet') return 'Sonnet';
    if (mp.model === 'opus') return 'Opus';
  }
  if (mp.provider === 'ollama') {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.modelId === mp.model);
    return preset?.label.split(' (')[0] ?? mp.model ?? 'Ollama';
  }
  return mp.model || 'Custom';
}

interface UseCaseTestRunnerProps {
  useCaseId: string;
  useCase: UseCaseItem;
  defaultModelProfile: string | null;
}

export function UseCaseTestRunner({ useCaseId, useCase, defaultModelProfile }: UseCaseTestRunnerProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const isTestRunning = usePersonaStore((s) => s.isTestRunning);
  const testRunProgress = usePersonaStore((s) => s.testRunProgress);
  const startTest = usePersonaStore((s) => s.startTest);
  const cancelTest = usePersonaStore((s) => s.cancelTest);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);

  // Determine which model to use
  const resolvedProfile = useMemo<ModelProfile>(() => {
    if (useCase.model_override) return useCase.model_override;
    if (!defaultModelProfile) return { model: 'sonnet', provider: 'anthropic' };
    try {
      return JSON.parse(defaultModelProfile) as ModelProfile;
    } catch {
      return { model: 'sonnet', provider: 'anthropic' };
    }
  }, [useCase.model_override, defaultModelProfile]);

  const modelConfig = useMemo(() => profileToModelConfig(resolvedProfile), [resolvedProfile]);

  const handleRun = useCallback(async () => {
    if (!selectedPersona || !modelConfig) return;
    await startTest(selectedPersona.id, [modelConfig], useCaseId);
  }, [selectedPersona, modelConfig, useCaseId, startTest]);

  const handleCancel = useCallback(async () => {
    if (testRunProgress?.runId) {
      await cancelTest(testRunProgress.runId);
    }
  }, [testRunProgress, cancelTest]);

  const canCancel = !!testRunProgress?.runId;

  const hasPrompt = !!selectedPersona?.structured_prompt || !!selectedPersona?.system_prompt;

  return (
    <div className="space-y-2">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <FlaskConical className="w-3.5 h-3.5" />
        Test
      </h5>

      <div className="bg-secondary/30 border border-primary/10 rounded-xl p-3 space-y-3">
        <p className="text-sm text-muted-foreground/70">
          Run a test for this use case using <span className="text-foreground/80 font-medium">{modelLabel(resolvedProfile)}</span>
        </p>

        {isTestRunning ? (
          <>
            <button
              onClick={handleCancel}
              disabled={!canCancel}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium text-sm bg-red-500/80 hover:bg-red-500 text-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={!canCancel ? 'Waiting for test to start...' : 'Cancel test'}
            >
              <Square className="w-3.5 h-3.5" /> Cancel
            </button>

            {/* Progress */}
            <AnimatePresence>
              {testRunProgress && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 text-sm text-foreground/70">
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                    <span className="capitalize">
                      {testRunProgress.phase === 'generating'
                        ? 'Generating scenarios...'
                        : testRunProgress.phase === 'executing'
                          ? `Testing ${testRunProgress.scenarioName ?? ''}...`
                          : testRunProgress.phase}
                    </span>
                  </div>
                  {testRunProgress.total && (
                    <div className="w-full h-1 rounded-full bg-secondary/50 overflow-hidden mt-2">
                      <motion.div
                        className="h-full rounded-full bg-primary/60"
                        animate={{ width: `${((testRunProgress.current ?? 0) / testRunProgress.total) * 100}%` }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <button
            onClick={handleRun}
            disabled={!hasPrompt || !modelConfig}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-medium text-sm bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5" /> Test Use Case
          </button>
        )}

        <button
          onClick={() => setEditorTab('lab')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-primary/80 transition-colors"
        >
          View full test history <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
