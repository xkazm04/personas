import { useMemo } from 'react';
import {
  FlaskConical, Play, Square, ChevronDown, Filter, AlertCircle,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { parseDesignContext, type UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from '@/features/agents/sub_model_config/OllamaCloudPresets';

// ── Available models for testing ──────────────────────────────────────

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  model?: string;
  base_url?: string;
}

export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', model: 'haiku' },
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', model: 'sonnet' },
  { id: 'opus', label: 'Opus', provider: 'anthropic', model: 'opus' },
];

export const OLLAMA_MODELS: ModelOption[] = OLLAMA_CLOUD_PRESETS.map((p) => ({
  id: p.value,
  label: p.label,
  provider: 'ollama',
  model: p.modelId,
  base_url: OLLAMA_CLOUD_BASE_URL,
}));

export const ALL_MODELS: ModelOption[] = [...ANTHROPIC_MODELS, ...OLLAMA_MODELS];

// ── Props ─────────────────────────────────────────────────────────────

interface TestRunnerConfigProps {
  selectedModels: Set<string>;
  onToggleModel: (id: string) => void;
  onStartTest: () => void;
  onCancelTest: () => void;
  isTestRunning: boolean;
  hasPrompt: boolean;
  selectedUseCaseId: string | null;
  onSelectedUseCaseIdChange: (id: string | null) => void;
}

export function TestRunnerConfig({
  selectedModels,
  onToggleModel,
  onStartTest,
  onCancelTest,
  isTestRunning,
  hasPrompt,
  selectedUseCaseId,
  onSelectedUseCaseIdChange,
}: TestRunnerConfigProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const hasTools = (selectedPersona?.tools?.length ?? 0) > 0;

  // Parse use cases from design_context
  const useCases: UseCaseItem[] = useMemo(() => {
    const ctx = parseDesignContext(selectedPersona?.design_context);
    return ctx.useCases ?? [];
  }, [selectedPersona?.design_context]);

  const selectedUseCase = useMemo(
    () => useCases.find((uc) => uc.id === selectedUseCaseId) ?? null,
    [useCases, selectedUseCaseId],
  );

  const useCaseOptions = useMemo(() => [
    { value: '__all__', label: 'All Use Cases' },
    ...useCases.map((uc) => ({ value: uc.id, label: uc.title })),
  ], [useCases]);

  return (
    <>
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          <FlaskConical className="w-3.5 h-3.5" />
          Sandbox Test Runner
        </h4>
        <p className="text-sm text-muted-foreground/80 -mt-1 ml-[38px]">
          Test your persona across multiple LLM models with auto-generated scenarios
        </p>
      </div>
      <div className="border border-primary/15 rounded-xl overflow-hidden backdrop-blur-sm bg-secondary/40">
        <div className="p-4 space-y-4">
          {/* Warnings */}
          {(!hasPrompt || !hasTools) && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-400/90">
                {!hasPrompt && <p>This persona has no prompt configured. Add a prompt first.</p>}
                {!hasTools && <p>This persona has no tools assigned. Add tools for richer testing.</p>}
              </div>
            </div>
          )}

          {/* Use case filter */}
          {useCases.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" />
                Focus on Use Case
              </label>
              <Listbox
                itemCount={useCaseOptions.length}
                onSelectFocused={(idx) => {
                  const opt = useCaseOptions[idx];
                  if (opt) onSelectedUseCaseIdChange(opt.value === '__all__' ? null : opt.value);
                }}
                ariaLabel="Filter by use case"
                renderTrigger={({ isOpen, toggle }) => (
                  <button
                    onClick={toggle}
                    disabled={isTestRunning}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${
                      isOpen
                        ? 'bg-primary/10 border-primary/30 text-foreground/90'
                        : 'bg-background/30 border-primary/10 text-muted-foreground/90 hover:border-primary/20'
                    } ${isTestRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span>{useCaseOptions.find((o) => o.value === (selectedUseCaseId ?? '__all__'))?.label ?? 'All Use Cases'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              >
                {({ close, focusIndex }) => (
                  <div className="py-1 bg-background border border-primary/15 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {useCaseOptions.map((opt, i) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          onSelectedUseCaseIdChange(opt.value === '__all__' ? null : opt.value);
                          close();
                        }}
                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                          focusIndex === i ? 'bg-primary/15 text-foreground' : ''
                        } ${
                          (selectedUseCaseId ?? '__all__') === opt.value
                            ? 'text-primary font-medium'
                            : 'text-muted-foreground/90 hover:bg-secondary/30'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </Listbox>
              {selectedUseCase && (
                <p className="text-sm text-muted-foreground/50 ml-1">
                  Scenarios will target: {selectedUseCase.description}
                </p>
              )}
            </div>
          )}

          {/* Model selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground/80">Select Models to Compare</label>
            <div className="space-y-2">
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">Anthropic</span>
                <div className="flex flex-wrap gap-2">
                  {ANTHROPIC_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => onToggleModel(m.id)}
                      disabled={isTestRunning}
                      className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                        selectedModels.has(m.id)
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'
                      } ${isTestRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {OLLAMA_MODELS.length > 0 && (
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">Ollama Cloud</span>
                  <div className="flex flex-wrap gap-2">
                    {OLLAMA_MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => onToggleModel(m.id)}
                        disabled={isTestRunning}
                        className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                          selectedModels.has(m.id)
                            ? 'bg-primary/15 text-primary border-primary/30'
                            : 'bg-background/30 text-muted-foreground/90 border-primary/10 hover:border-primary/20 hover:text-foreground/95'
                        } ${isTestRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Run / Cancel button */}
          {isTestRunning ? (
            <button
              onClick={onCancelTest}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20"
            >
              <Square className="w-4 h-4" />
              Cancel Test Run
            </button>
          ) : (
            <button
              onClick={onStartTest}
              disabled={selectedModels.size === 0 || !hasPrompt}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <Play className="w-4 h-4" />
              Run Test ({selectedModels.size} model{selectedModels.size !== 1 ? 's' : ''}{selectedUseCase ? ` — ${selectedUseCase.title}` : ''})
            </button>
          )}
        </div>
      </div>
    </>
  );
}
