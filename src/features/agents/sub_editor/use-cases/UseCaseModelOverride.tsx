import { useState } from 'react';
import { Cpu, Check, ChevronDown, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Listbox } from '@/features/shared/components/Listbox';
import type { UseCaseItem } from '@/features/shared/components/UseCasesList';
import type { ModelProfile, ModelProvider } from '@/lib/types/frontendTypes';
import {
  OLLAMA_CLOUD_PRESETS,
  OLLAMA_CLOUD_BASE_URL,
} from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';

// ── Available model options ──────────────────────────────────────────

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  group: string;
  model?: string;
  base_url?: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  { id: 'haiku', label: 'Haiku', provider: 'anthropic', group: 'Anthropic', model: 'haiku' },
  { id: 'sonnet', label: 'Sonnet', provider: 'anthropic', group: 'Anthropic', model: 'sonnet' },
  { id: 'opus', label: 'Opus', provider: 'anthropic', group: 'Anthropic' },
  ...OLLAMA_CLOUD_PRESETS.map((p) => ({
    id: p.value,
    label: p.label.split(' (')[0] ?? p.label,
    provider: 'ollama',
    group: 'Ollama',
    model: p.modelId,
    base_url: OLLAMA_CLOUD_BASE_URL,
  })),
  { id: 'custom', label: 'Custom...', provider: 'custom', group: 'Custom' },
];

function profileToLabel(mp: ModelProfile | undefined): string {
  if (!mp) return 'None';
  if (mp.provider === 'ollama' && mp.model) {
    const preset = OLLAMA_CLOUD_PRESETS.find((p) => p.modelId === mp.model);
    if (preset) return preset.label.split(' (')[0] ?? preset.label;
    return mp.model;
  }
  if (!mp.provider || mp.provider === 'anthropic') {
    if (mp.model === 'haiku') return 'Haiku';
    if (mp.model === 'sonnet') return 'Sonnet';
    if (mp.model === 'opus') return 'Opus';
  }
  return mp.model || 'Custom';
}

function defaultProfileLabel(rawModelProfile: string | null): string {
  if (!rawModelProfile) return 'Not set';
  try {
    const mp = JSON.parse(rawModelProfile) as ModelProfile;
    return profileToLabel(mp);
  } catch {
    return 'Not set';
  }
}

// ── Component ────────────────────────────────────────────────────────

interface UseCaseModelOverrideProps {
  useCase: UseCaseItem;
  defaultModelProfile: string | null;
  onUpdate: (partial: Partial<UseCaseItem>) => void;
}

export function UseCaseModelOverride({ useCase, defaultModelProfile, onUpdate }: UseCaseModelOverrideProps) {
  const hasOverride = !!useCase.model_override;
  const [customExpanded, setCustomExpanded] = useState(false);
  const [customConfig, setCustomConfig] = useState<ModelProfile>(useCase.model_override ?? {});

  const handleUseDefault = () => {
    onUpdate({ model_override: undefined });
    setCustomExpanded(false);
  };

  const handleSelectModel = (opt: ModelOption) => {
    if (opt.id === 'custom') {
      setCustomExpanded(true);
      const profile: ModelProfile = customConfig.model ? customConfig : { provider: 'anthropic' };
      onUpdate({ model_override: profile });
      setCustomConfig(profile);
    } else {
      setCustomExpanded(false);
      const profile: ModelProfile = {
        model: opt.model,
        provider: opt.provider as ModelProvider,
        base_url: opt.base_url,
      };
      onUpdate({ model_override: profile });
      setCustomConfig(profile);
    }
  };

  const handleCustomFieldChange = (field: keyof ModelProfile, value: string) => {
    const updated = { ...customConfig, [field]: value || undefined };
    setCustomConfig(updated);
    onUpdate({ model_override: updated });
  };

  const selectedLabel = hasOverride ? profileToLabel(useCase.model_override) : null;

  return (
    <div className="space-y-2">
      <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
        <Cpu className="w-3.5 h-3.5" />
        Model
      </h5>

      <div className="flex items-center gap-2">
        {/* Use Default toggle */}
        <button
          onClick={handleUseDefault}
          className={`px-2.5 py-1.5 rounded-lg text-sm font-medium border transition-all ${
            !hasOverride
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'bg-background/30 border-primary/10 text-muted-foreground/80 hover:border-primary/20'
          }`}
        >
          Default ({defaultProfileLabel(defaultModelProfile)})
        </button>

        {/* Override dropdown */}
        <Listbox
          ariaLabel="Select model override"
          itemCount={MODEL_OPTIONS.length}
          onSelectFocused={(index) => handleSelectModel(MODEL_OPTIONS[index]!)}
          className="flex-1"
          renderTrigger={({ isOpen, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={isOpen}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                hasOverride
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-background/30 border-primary/10 text-muted-foreground/80 hover:border-primary/20'
              }`}
            >
              <span className="flex-1 text-left truncate">
                {hasOverride ? `Override: ${selectedLabel}` : 'Override...'}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
        >
          {({ close, focusIndex }) => {
            let lastGroup = '';
            return (
              <div className="py-1 max-h-64 overflow-y-auto">
                {MODEL_OPTIONS.map((opt, i) => {
                  const showGroup = opt.group !== lastGroup;
                  lastGroup = opt.group;
                  const isActive =
                    hasOverride &&
                    useCase.model_override?.model === opt.model &&
                    (useCase.model_override?.provider ?? 'anthropic') === opt.provider;

                  return (
                    <div key={opt.id}>
                      {showGroup && (
                        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                          {opt.group}
                        </div>
                      )}
                      <button
                        role="option"
                        aria-selected={isActive}
                        onClick={() => { handleSelectModel(opt); close(); }}
                        className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm transition-colors ${
                          focusIndex === i ? 'bg-secondary/60' : 'hover:bg-secondary/40'
                        } ${isActive ? 'text-primary' : 'text-foreground/80'}`}
                      >
                        {opt.id === 'custom' && <Settings2 className="w-3 h-3 text-muted-foreground/70" />}
                        <span className="flex-1 text-left">{opt.label}</span>
                        {isActive && <Check className="w-3 h-3 text-primary flex-shrink-0" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          }}
        </Listbox>
      </div>

      {/* Custom model expanded config */}
      <AnimatePresence>
        {hasOverride && customExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="bg-secondary/30 border border-primary/10 rounded-xl p-3 space-y-2">
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Provider</label>
                <select
                  value={customConfig.provider || 'anthropic'}
                  onChange={(e) => handleCustomFieldChange('provider', e.target.value)}
                  className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="ollama">Ollama (local)</option>
                  <option value="litellm">LiteLLM (proxy)</option>
                  <option value="custom">Custom URL</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Model Name</label>
                <input
                  type="text"
                  value={customConfig.model || ''}
                  onChange={(e) => handleCustomFieldChange('model', e.target.value)}
                  placeholder="e.g. claude-sonnet-4-20250514"
                  className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Base URL</label>
                <input
                  type="text"
                  value={customConfig.base_url || ''}
                  onChange={(e) => handleCustomFieldChange('base_url', e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">Auth Token</label>
                <input
                  type="password"
                  value={customConfig.auth_token || ''}
                  onChange={(e) => handleCustomFieldChange('auth_token', e.target.value)}
                  placeholder="Bearer token"
                  className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
