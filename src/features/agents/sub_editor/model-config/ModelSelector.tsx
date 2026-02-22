import { Cpu, DollarSign, Check, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ModelProvider } from '@/lib/types/frontendTypes';
import type { PersonaDraft } from '@/features/agents/sub_editor/PersonaDraft';
import { OLLAMA_CLOUD_PRESETS, isOllamaCloudValue } from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';
import { OllamaApiKeyField } from '@/features/agents/sub_editor/model-config/OllamaApiKeyField';
import { LiteLLMConfigField } from '@/features/agents/sub_editor/model-config/LiteLLMConfigField';

// ── Provider brand colors ─────────────────────────────────────────────
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#D97706',
  ollama: '#10B981',
  custom: '#3B82F6',
};

// ── Model card definitions ────────────────────────────────────────────
interface ModelCardDef {
  value: string;
  name: string;
  provider: string;
  /** 0 = fast, 1 = quality */
  quality: number;
  cost: string;
  description: string;
}

const ANTHROPIC_CARDS: ModelCardDef[] = [
  { value: 'haiku', name: 'Haiku', provider: 'Anthropic', quality: 0.15, cost: '$', description: 'Fast & affordable for simple tasks' },
  { value: 'sonnet', name: 'Sonnet', provider: 'Anthropic', quality: 0.55, cost: '$$', description: 'Balanced speed and intelligence' },
  { value: '', name: 'Opus', provider: 'Anthropic', quality: 1.0, cost: '$$$', description: 'Maximum quality reasoning (default)' },
];

const OLLAMA_CARDS: ModelCardDef[] = OLLAMA_CLOUD_PRESETS.map((p) => ({
  value: p.value,
  name: p.label.split(' (')[0] ?? p.label,
  provider: 'Ollama Cloud',
  quality: 0.5,
  cost: 'Free',
  description: 'Free via Ollama Cloud API',
}));

const CUSTOM_CARD: ModelCardDef = {
  value: 'custom',
  name: 'Custom',
  provider: 'Any Provider',
  quality: 0.5,
  cost: '—',
  description: 'Ollama, LiteLLM, or custom endpoint',
};

function getProviderColor(provider: string): string {
  if (provider === 'Anthropic') return PROVIDER_COLORS.anthropic!;
  if (provider.startsWith('Ollama')) return PROVIDER_COLORS.ollama!;
  return PROVIDER_COLORS.custom!;
}

// ── Spectrum Bar ──────────────────────────────────────────────────────
function SpectrumBar({ quality }: { quality: number }) {
  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      <span className="text-[9px] text-muted-foreground/30 w-7">Fast</span>
      <div className="flex-1 h-1 rounded-full bg-primary/8 relative overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400/70 to-violet-400/70"
          style={{ width: `${Math.max(quality * 100, 8)}%` }}
        />
      </div>
      <span className="text-[9px] text-muted-foreground/30 w-10 text-right">Quality</span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────
interface ModelSelectorProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
}

export function ModelSelector({ draft, patch, modelDirty }: ModelSelectorProps) {
  const allCards = [...ANTHROPIC_CARDS, ...OLLAMA_CARDS, CUSTOM_CARD];

  const handleSelectCard = (card: ModelCardDef) => {
    patch({ selectedModel: card.value });
  };

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <Cpu className="w-3.5 h-3.5" />
        Model &amp; Provider
      </h4>
      <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
        {/* Model Cards Grid */}
        <div className="grid grid-cols-2 gap-2">
          {allCards.map((card) => {
            const isSelected = draft.selectedModel === card.value;
            const brandColor = getProviderColor(card.provider);

            return (
              <button
                key={card.value || '__default__'}
                type="button"
                onClick={() => handleSelectCard(card)}
                className={`relative text-left p-3 rounded-xl border transition-all overflow-hidden ${
                  isSelected
                    ? 'border-primary/40 ring-2 ring-primary/25 bg-primary/8'
                    : 'border-primary/10 bg-background/30 hover:bg-secondary/40 hover:border-primary/20'
                }`}
                style={{ borderLeftWidth: 3, borderLeftColor: brandColor }}
              >
                {/* Selected checkmark */}
                {isSelected && (
                  <div className="absolute top-2 right-2 w-4.5 h-4.5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-3 h-3 text-foreground" />
                  </div>
                )}

                {/* Card content */}
                <div className="pr-5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {card.value === 'custom' && <Settings2 className="w-3 h-3 text-muted-foreground/50" />}
                    <span className="text-sm font-medium text-foreground/90">{card.name}</span>
                  </div>

                  {/* Provider badge + cost */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ color: brandColor, backgroundColor: brandColor + '15' }}
                    >
                      {card.provider}
                    </span>
                    <span className={`text-[10px] font-mono ${card.cost === 'Free' ? 'text-emerald-400/70' : 'text-muted-foreground/40'}`}>
                      {card.cost}
                    </span>
                  </div>

                  <p className="text-[11px] text-muted-foreground/40 leading-tight">{card.description}</p>

                  {card.value !== 'custom' && <SpectrumBar quality={card.quality} />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Ollama Cloud API key -- shown when an Ollama Cloud model is selected */}
        {isOllamaCloudValue(draft.selectedModel) && (
          <OllamaApiKeyField />
        )}

        {/* Custom model expanded config */}
        <AnimatePresence>
          {draft.selectedModel === 'custom' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="space-y-3 pt-1">
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

                {draft.selectedProvider !== 'anthropic' && (
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

                {/* LiteLLM global config */}
                {draft.selectedProvider === 'litellm' && (
                  <LiteLLMConfigField />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
