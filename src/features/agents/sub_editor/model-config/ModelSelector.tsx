import { Cpu, DollarSign } from 'lucide-react';
import type { ModelProvider } from '@/lib/types/frontendTypes';
import type { PersonaDraft } from '@/features/agents/sub_editor/PersonaDraft';
import { OLLAMA_CLOUD_PRESETS, isOllamaCloudValue } from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';
import { OllamaApiKeyField } from '@/features/agents/sub_editor/model-config/OllamaApiKeyField';
import { LiteLLMConfigField } from '@/features/agents/sub_editor/model-config/LiteLLMConfigField';

interface ModelSelectorProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
}

export function ModelSelector({ draft, patch, modelDirty }: ModelSelectorProps) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <Cpu className="w-3.5 h-3.5" />
        Model &amp; Provider
      </h4>
      <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
        <div>
          <label className="block text-sm font-medium text-foreground/60 mb-1">Model</label>
          <select
            value={draft.selectedModel}
            onChange={(e) => patch({ selectedModel: e.target.value })}
            className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
          >
            <option value="">Default (Opus)</option>
            <optgroup label="Anthropic">
              <option value="haiku">Haiku (fast/cheap)</option>
              <option value="sonnet">Sonnet (balanced)</option>
              <option value="opus">Opus (quality)</option>
            </optgroup>
            <optgroup label="Ollama Cloud (free)">
              {OLLAMA_CLOUD_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </optgroup>
            <option value="custom">Custom</option>
          </select>
        </div>

        {/* Ollama Cloud API key -- shown when an Ollama Cloud model is selected */}
        {isOllamaCloudValue(draft.selectedModel) && (
          <OllamaApiKeyField />
        )}

        {draft.selectedModel === 'custom' && (
          <div>
            <label className="block text-sm font-medium text-foreground/60 mb-1">Provider</label>
            <select
              value={draft.selectedProvider}
              onChange={(e) => patch({ selectedProvider: e.target.value as ModelProvider })}
              className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            >
              <option value="anthropic">Anthropic</option>
              <option value="ollama">Ollama (local)</option>
              <option value="litellm">LiteLLM (proxy)</option>
              <option value="custom">Custom URL</option>
            </select>
          </div>
        )}

        {draft.selectedModel === 'custom' && draft.selectedProvider !== 'anthropic' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground/60 mb-1">Model Name</label>
              <input
                type="text"
                value={draft.customModelName}
                onChange={(e) => patch({ customModelName: e.target.value })}
                placeholder={
                  draft.selectedProvider === 'litellm'
                    ? 'e.g. anthropic/claude-sonnet-4-20250514'
                    : draft.selectedProvider === 'ollama'
                      ? 'e.g. llama3.1:8b'
                      : 'Model identifier'
                }
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/60 mb-1">Base URL</label>
              <input
                type="text"
                value={draft.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder={
                  draft.selectedProvider === 'litellm'
                    ? 'http://localhost:4000'
                    : 'http://localhost:11434'
                }
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/60 mb-1">Auth Token</label>
              <input
                type="text"
                value={draft.authToken}
                onChange={(e) => patch({ authToken: e.target.value })}
                placeholder={
                  draft.selectedProvider === 'litellm'
                    ? 'LiteLLM master key (sk-...)'
                    : draft.selectedProvider === 'ollama'
                      ? 'ollama'
                      : 'Bearer token'
                }
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
          </div>
        )}

        {/* LiteLLM global config -- shown when LiteLLM provider is selected */}
        {draft.selectedModel === 'custom' && draft.selectedProvider === 'litellm' && (
          <LiteLLMConfigField />
        )}

        {/* Budget Controls */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-foreground/60 mb-1">
              <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> Max Budget (USD)</span>
            </label>
            <input
              type="number"
              value={draft.maxBudget}
              onChange={(e) => patch({ maxBudget: e.target.value === '' ? '' : parseFloat(e.target.value) })}
              placeholder="No limit"
              min={0}
              step={0.01}
              className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-foreground/60 mb-1">Max Turns</label>
            <input
              type="number"
              value={draft.maxTurns}
              onChange={(e) => patch({ maxTurns: e.target.value === '' ? '' : parseInt(e.target.value, 10) })}
              placeholder="No limit"
              min={1}
              step={1}
              className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
        </div>

        {/* Model dirty indicator */}
        {modelDirty && (
          <div className="pt-1">
            <span className="flex items-center gap-1.5 text-xs text-amber-400/70">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Unsaved changes
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
