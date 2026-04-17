import { useState } from 'react';
import { Cpu, ChevronDown, DollarSign } from 'lucide-react';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import { ModelSelector } from '@/features/agents/sub_model_config';
import type { CustomModelConfig } from '@/features/agents/sub_model_config';
import type { ModelProvider, PromptCachePolicy } from '@/lib/types/frontendTypes';
import { isOllamaCloudValue, OLLAMA_CLOUD_PRESETS } from '@/features/agents/sub_model_config/OllamaCloudPresets';
import { useEffectiveConfig } from '@/features/agents/sub_model_config/hooks/useEffectiveConfig';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { useTranslation } from '@/i18n/useTranslation';

// -- Derive a human-readable label from the draft --------------------
function resolveModelLabel(draft: PersonaDraft): { label: string; provider: string } {
  const model = draft.selectedModel;
  if (!model || model === '') return { label: 'Opus', provider: 'Anthropic' };
  if (model === 'haiku') return { label: 'Haiku', provider: 'Anthropic' };
  if (model === 'sonnet') return { label: 'Sonnet', provider: 'Anthropic' };
  if (model === 'custom') return { label: draft.customModelName || 'Custom', provider: draft.selectedProvider || 'Custom' };
  if (isOllamaCloudValue(model)) {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.value === model);
    return { label: preset?.label.split(' (')[0] ?? model, provider: 'Ollama' };
  }
  return { label: model, provider: '' };
}

interface DefaultModelSectionProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  personaId?: string | null;
}

export function DefaultModelSection({ draft, patch, modelDirty, personaId }: DefaultModelSectionProps) {
  const { t } = useTranslation();
  const uc = t.agents.use_cases;
  const [expanded, setExpanded] = useState(false);
  const { label, provider } = resolveModelLabel(draft);
  const { config: effectiveConfig, loading: effectiveConfigLoading } = useEffectiveConfig(personaId);

  const budgetLabel = draft.maxBudget !== '' && draft.maxBudget != null
    ? `$${draft.maxBudget}`
    : null;
  const turnsLabel = draft.maxTurns !== '' && draft.maxTurns != null
    ? `${draft.maxTurns} turns`
    : null;
  const cacheLabel = draft.promptCachePolicy !== 'none'
    ? draft.promptCachePolicy === 'short' ? uc.cache_5m : uc.cache_1h
    : null;

  return (
    <div className="space-y-1.5">
      <SectionHeader icon={<Cpu className="w-3.5 h-3.5" />} label={uc.persona_default_model} />

      {/* Collapsed summary bar */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-modal border transition-all text-left ${
          expanded
            ? 'bg-primary/8 border-primary/30'
            : 'bg-secondary/40 border-primary/20 hover:border-primary/30 hover:bg-secondary/50'
        }`}
      >
        <Cpu className="w-3.5 h-3.5 text-muted-foreground/70 flex-shrink-0" />
        <span className="text-sm font-medium text-foreground/85 flex-1">
          {label}
          {provider && (
            <span className="text-muted-foreground/50 font-normal ml-1.5">{provider}</span>
          )}
        </span>

        {/* Budget & cache chips */}
        {(budgetLabel || turnsLabel || cacheLabel) && (
          <span className="flex items-center gap-1.5">
            {budgetLabel && (
              <span className="flex items-center gap-0.5 text-sm font-mono px-1.5 py-0.5 rounded-card bg-secondary/50 border border-primary/10 text-muted-foreground/60">
                <DollarSign className="w-2.5 h-2.5" />{budgetLabel.replace('$', '')}
              </span>
            )}
            {turnsLabel && (
              <span className="text-sm font-mono px-1.5 py-0.5 rounded-card bg-secondary/50 border border-primary/10 text-muted-foreground/60">
                {turnsLabel}
              </span>
            )}
            {cacheLabel && (
              <span className="text-sm font-mono px-1.5 py-0.5 rounded-card bg-emerald-500/10 border border-emerald-500/20 text-emerald-400/70">
                {cacheLabel}
              </span>
            )}
          </span>
        )}

        {modelDirty && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
        )}

        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Expandable full selector */}
      {expanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="pt-1">
              <p className="text-sm text-muted-foreground/70 mb-2 ml-[34px]">
                {uc.inherit_hint}
              </p>
              <ModelSelector
                selectedModel={draft.selectedModel}
                onSelectModel={(value) => patch({ selectedModel: value })}
                customConfig={{
                  selectedProvider: draft.selectedProvider,
                  customModelName: draft.customModelName,
                  baseUrl: draft.baseUrl,
                  authToken: draft.authToken,
                  onProviderChange: (p: ModelProvider) => patch({ selectedProvider: p }),
                  onCustomModelNameChange: (n) => patch({ customModelName: n }),
                  onBaseUrlChange: (u) => patch({ baseUrl: u }),
                  onAuthTokenChange: (t) => patch({ authToken: t }),
                } satisfies CustomModelConfig}
                maxBudget={draft.maxBudget}
                maxTurns={draft.maxTurns}
                onMaxBudgetChange={(v) => patch({ maxBudget: v as number | '' })}
                onMaxTurnsChange={(v) => patch({ maxTurns: v as number | '' })}
                promptCachePolicy={draft.promptCachePolicy}
                onPromptCachePolicyChange={(v: PromptCachePolicy) => patch({ promptCachePolicy: v })}
                dirty={modelDirty}
                hideHeader
                effectiveConfig={effectiveConfig}
                effectiveConfigLoading={effectiveConfigLoading}
              />
            </div>
          </div>
        )}
    </div>
  );
}
