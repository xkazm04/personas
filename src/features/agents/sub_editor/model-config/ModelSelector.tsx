import { Cpu, DollarSign, Check, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ModelProvider } from '@/lib/types/frontendTypes';
import { OLLAMA_CLOUD_PRESETS, isOllamaCloudValue } from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';
import { OllamaApiKeyField } from '@/features/agents/sub_editor/model-config/OllamaApiKeyField';
import { LiteLLMConfigField } from '@/features/agents/sub_editor/model-config/LiteLLMConfigField';
import { FieldHint } from '@/features/shared/components/FieldHint';

// ── Provider brand colors ─────────────────────────────────────────────
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#D97706',
  ollama: '#10B981',
  custom: '#3B82F6',
};

// ── Model definitions ─────────────────────────────────────────────────
interface ModelDef {
  value: string;
  name: string;
  cost: string;
}

const ANTHROPIC_MODELS: ModelDef[] = [
  { value: 'haiku', name: 'Haiku', cost: '~$0.25/1K' },
  { value: 'sonnet', name: 'Sonnet', cost: '~$3/1K' },
  { value: '', name: 'Opus', cost: '~$15/1K' },
];

const OLLAMA_MODELS: ModelDef[] = OLLAMA_CLOUD_PRESETS.map((p) => ({
  value: p.value,
  name: p.label.split(' (')[0] ?? p.label,
  cost: 'Free',
}));

const CUSTOM_MODELS: ModelDef[] = [
  { value: 'custom', name: 'Custom', cost: '\u2014' },
];

interface ProviderColumn {
  key: string;
  label: string;
  color: string;
  models: ModelDef[];
}

const COLUMNS: ProviderColumn[] = [
  { key: 'anthropic', label: 'Anthropic', color: PROVIDER_COLORS.anthropic!, models: ANTHROPIC_MODELS },
  { key: 'ollama', label: 'Ollama', color: PROVIDER_COLORS.ollama!, models: OLLAMA_MODELS },
  { key: 'custom', label: 'Custom', color: PROVIDER_COLORS.custom!, models: CUSTOM_MODELS },
];

// ── Custom model config props ─────────────────────────────────────────
export interface CustomModelConfig {
  selectedProvider: ModelProvider;
  customModelName: string;
  baseUrl: string;
  authToken: string;
  onProviderChange: (p: ModelProvider) => void;
  onCustomModelNameChange: (n: string) => void;
  onBaseUrlChange: (u: string) => void;
  onAuthTokenChange: (t: string) => void;
}

// ── Main Component ────────────────────────────────────────────────────
interface ModelSelectorProps {
  selectedModel: string;
  onSelectModel: (value: string) => void;
  /** Custom model expanded config — only needed in agent editor */
  customConfig?: CustomModelConfig;
  /** Budget controls */
  maxBudget?: number | null | '';
  maxTurns?: number | null | '';
  onMaxBudgetChange?: (v: number | null | '') => void;
  onMaxTurnsChange?: (v: number | null | '') => void;
  /** Show unsaved indicator */
  dirty?: boolean;
  /** Hide the section header (when embedded inside another card) */
  hideHeader?: boolean;
}

export function ModelSelector({
  selectedModel,
  onSelectModel,
  customConfig,
  maxBudget,
  maxTurns,
  onMaxBudgetChange,
  onMaxTurnsChange,
  dirty,
  hideHeader,
}: ModelSelectorProps) {
  return (
    <div className="space-y-3">
      {!hideHeader && (
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          <Cpu className="w-3.5 h-3.5" />
          Model &amp; Provider
        </h4>
      )}
      <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
        {/* Three provider columns side by side */}
        <div className="grid grid-cols-3 gap-2">
          {COLUMNS.map((col) => (
            <div key={col.key} className="space-y-1">
              {/* Column header */}
              <div
                className="text-sm font-semibold uppercase tracking-wider px-2 py-1 rounded-lg text-center"
                style={{ color: col.color, backgroundColor: col.color + '12' }}
              >
                {col.label}
              </div>

              {/* Model rows */}
              {col.models.map((model) => {
                const isSelected = selectedModel === model.value;
                return (
                  <button
                    key={model.value || '__default__'}
                    type="button"
                    onClick={() => onSelectModel(model.value)}
                    className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all text-left ${
                      isSelected
                        ? 'border-primary/35 bg-primary/8'
                        : 'border-transparent hover:bg-secondary/40 hover:border-primary/10'
                    }`}
                    style={{ borderLeftWidth: 2, borderLeftColor: isSelected ? col.color : 'transparent' }}
                  >
                    {/* Radio indicator */}
                    {isSelected ? (
                      <div className="w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                        <Check className="w-2 h-2 text-foreground" />
                      </div>
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-primary/20 flex-shrink-0" />
                    )}
                    {/* Name */}
                    <span className="text-sm font-medium text-foreground/90 flex-1 truncate">
                      {model.value === 'custom' && <Settings2 className="w-3 h-3 inline mr-1 text-muted-foreground/80" />}
                      {model.name}
                    </span>
                    {/* Cost */}
                    <span className={`text-sm font-mono flex-shrink-0 ${model.cost === 'Free' ? 'text-emerald-400/80' : 'text-muted-foreground/70'}`}>
                      {model.cost}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Ollama Cloud API key */}
        {isOllamaCloudValue(selectedModel) && <OllamaApiKeyField />}

        {/* Custom model expanded config */}
        {customConfig && (
          <AnimatePresence>
            {selectedModel === 'custom' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-1">Provider</label>
                    <select
                      value={customConfig.selectedProvider}
                      onChange={(e) => customConfig.onProviderChange(e.target.value as ModelProvider)}
                      className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="ollama">Ollama (local)</option>
                      <option value="litellm">LiteLLM (proxy)</option>
                      <option value="custom">Custom URL</option>
                    </select>
                  </div>

                  {customConfig.selectedProvider !== 'anthropic' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-foreground/80 mb-1">Model Name</label>
                        <input
                          type="text"
                          value={customConfig.customModelName}
                          onChange={(e) => customConfig.onCustomModelNameChange(e.target.value)}
                          placeholder={
                            customConfig.selectedProvider === 'litellm'
                              ? 'e.g. anthropic/claude-sonnet-4-20250514'
                              : customConfig.selectedProvider === 'ollama'
                                ? 'e.g. llama3.1:8b'
                                : 'Model identifier'
                          }
                          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground/80 mb-1">
                          Base URL
                          <FieldHint
                            text="The API endpoint for your model provider. Must include protocol (http/https) and port if non-standard."
                            example="http://localhost:11434"
                          />
                        </label>
                        <input
                          type="text"
                          value={customConfig.baseUrl}
                          onChange={(e) => customConfig.onBaseUrlChange(e.target.value)}
                          placeholder={
                            customConfig.selectedProvider === 'litellm'
                              ? 'http://localhost:4000'
                              : 'http://localhost:11434'
                          }
                          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground/80 mb-1">
                          Auth Token
                          <FieldHint
                            text="Authentication token for the provider API. For Ollama local, use 'ollama'. For LiteLLM, use your master key."
                            example="sk-..."
                          />
                        </label>
                        <input
                          type="password"
                          autoComplete="off"
                          value={customConfig.authToken}
                          onChange={(e) => customConfig.onAuthTokenChange(e.target.value)}
                          placeholder={
                            customConfig.selectedProvider === 'litellm'
                              ? 'LiteLLM master key (sk-...)'
                              : customConfig.selectedProvider === 'ollama'
                                ? 'ollama'
                                : 'Bearer token'
                          }
                          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                        />
                      </div>
                    </div>
                  )}

                  {customConfig.selectedProvider === 'litellm' && <LiteLLMConfigField />}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* Budget Controls */}
        {onMaxBudgetChange && onMaxTurnsChange && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> Max Budget (USD)
                  <FieldHint
                    text="Maximum total spend for a single execution. The run will stop if this limit is reached."
                    range="$0.01 and up, or leave blank for no limit"
                    example="0.50"
                  />
                </span>
              </label>
              <input
                type="number"
                value={maxBudget ?? ''}
                onChange={(e) => {
                  if (e.target.value === '') { onMaxBudgetChange(''); return; }
                  const n = parseFloat(e.target.value);
                  onMaxBudgetChange(Number.isNaN(n) ? '' : n);
                }}
                placeholder="No limit"
                min={0}
                step={0.01}
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Max Turns
                <FieldHint
                  text="Maximum number of LLM round-trips per execution. Each turn is one prompt-response cycle with tool use."
                  range="1 and up, or leave blank for no limit"
                  example="5"
                />
              </label>
              <input
                type="number"
                value={maxTurns ?? ''}
                onChange={(e) => {
                  if (e.target.value === '') { onMaxTurnsChange(''); return; }
                  const n = parseInt(e.target.value, 10);
                  onMaxTurnsChange(Number.isNaN(n) ? '' : n);
                }}
                placeholder="No limit"
                min={1}
                step={1}
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
          </div>
        )}

        {/* Dirty indicator */}
        {dirty && (
          <div className="pt-1">
            <span className="flex items-center gap-1.5 text-sm text-amber-400/70">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Unsaved changes
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
