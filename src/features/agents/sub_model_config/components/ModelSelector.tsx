import { Cpu, Check, Settings2 } from 'lucide-react';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { ModelProvider, PromptCachePolicy } from '@/lib/types/frontendTypes';
import type { EffectiveModelConfig } from '@/lib/bindings/EffectiveModelConfig';
import { OLLAMA_CLOUD_PRESETS, isOllamaCloudValue } from '../libs/OllamaCloudPresets';
import { OllamaApiKeyField } from './OllamaApiKeyField';
import { CustomModelConfigForm } from './CustomModelConfigForm';
import { BudgetControls } from './BudgetControls';
import { PromptCacheControls } from './PromptCacheControls';
import { EffectiveConfigPanel } from './EffectiveConfigPanel';
import { useTranslation } from '@/i18n/useTranslation';

// -- Provider brand colors --
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#D97706',
  ollama: '#10B981',
  custom: '#3B82F6',
};

// -- Provider logo SVGs (16x16) --
function AnthropicLogo({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="inline-block flex-shrink-0">
      <defs><linearGradient id="ms-anth" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor="#fff" stopOpacity="0.7" /></linearGradient></defs>
      <path d="M8 2L3 14h2.5l1.2-3.2h4.6L12.5 14H15L8 2zm-.5 7L8 5.8l.5 3.2H7.5z" fill="url(#ms-anth)" fillRule="evenodd" />
    </svg>
  );
}

function OllamaLogo({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="inline-block flex-shrink-0">
      <defs><linearGradient id="ms-oll" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor="#fff" stopOpacity="0.7" /></linearGradient></defs>
      <path d="M8 2C6 2 4.5 3 4 5c-.3 1.2 0 2.5.5 3.5L3 13c-.2.5.1 1 .6 1H6l.5-2h3l.5 2h2.4c.5 0 .8-.5.6-1l-1.5-4.5C12 7.5 12.3 6.2 12 5c-.5-2-2-3-4-3z" fill="url(#ms-oll)" />
      <circle cx="6.5" cy="5.5" r="0.7" fill="#fff" fillOpacity="0.8" />
      <circle cx="9.5" cy="5.5" r="0.7" fill="#fff" fillOpacity="0.8" />
    </svg>
  );
}

function CustomGearLogo({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="inline-block flex-shrink-0">
      <defs><linearGradient id="ms-cust" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor="#fff" stopOpacity="0.7" /></linearGradient></defs>
      <path d="M7.2 2h1.6l.3 1.3 1.2.5 1.1-.6 1.1 1.1-.6 1.1.5 1.2 1.3.3v1.6l-1.3.3-1.2.5.6 1.1-1.1 1.1-1.1-.6-1.2.5-.3 1.3H7.2l-.3-1.3-1.2-.5-1.1.6-1.1-1.1.6-1.1-.5-1.2L2.3 9.2V7.6l1.3-.3.5-1.2-.6-1.1 1.1-1.1 1.1.6 1.2-.5L7.2 2z" fill="url(#ms-cust)" />
      <circle cx="8" cy="8.4" r="1.8" fill="none" stroke="#fff" strokeWidth="1" strokeOpacity="0.8" />
      <path d="M12 2.5l.8 1.2" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="13.2" cy="2" r="0.8" fill={color} fillOpacity="0.5" />
    </svg>
  );
}

const PROVIDER_LOGOS: Record<string, (props: { color: string }) => ReturnType<typeof AnthropicLogo>> = {
  anthropic: AnthropicLogo,
  ollama: OllamaLogo,
  custom: CustomGearLogo,
};

// -- Model definitions --
interface ModelDef {
  value: string;
  name: string;
  cost: string;
}

const ANTHROPIC_MODELS: ModelDef[] = [
  { value: 'haiku', name: 'Haiku', cost: '~$0.25/1K' },
  { value: 'sonnet', name: 'Sonnet', cost: '~$3/1K' },
  { value: 'opus', name: 'Opus', cost: '~$15/1K' },
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

// -- Custom model config props --
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

// -- Main Component --
interface ModelSelectorProps {
  selectedModel: string;
  onSelectModel: (value: string) => void;
  /** Custom model expanded config -- only needed in agent editor */
  customConfig?: CustomModelConfig;
  /** Budget controls */
  maxBudget?: number | null | '';
  maxTurns?: number | null | '';
  onMaxBudgetChange?: (v: number | null | '') => void;
  onMaxTurnsChange?: (v: number | null | '') => void;
  /** Prompt caching controls */
  promptCachePolicy?: PromptCachePolicy;
  onPromptCachePolicyChange?: (v: PromptCachePolicy) => void;
  /** Show unsaved indicator */
  dirty?: boolean;
  /** Hide the section header (when embedded inside another card) */
  hideHeader?: boolean;
  /** Effective config with inheritance metadata -- shows cascade panel when provided */
  effectiveConfig?: EffectiveModelConfig | null;
  /** Whether the effective config is still loading */
  effectiveConfigLoading?: boolean;
}

export function ModelSelector({
  selectedModel,
  onSelectModel,
  customConfig,
  maxBudget,
  maxTurns,
  onMaxBudgetChange,
  onMaxTurnsChange,
  promptCachePolicy,
  onPromptCachePolicyChange,
  dirty,
  hideHeader,
  effectiveConfig,
  effectiveConfigLoading,
}: ModelSelectorProps) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  return (
    <div className="space-y-3">
      {!hideHeader && (
        <h4 className="flex items-center gap-2.5 typo-heading font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          <Cpu className="w-3.5 h-3.5" />
          {mc.model_and_provider}
        </h4>
      )}
      <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-3 space-y-3">
        {/* Three provider columns side by side */}
        <div className="grid grid-cols-3 gap-2">
          {COLUMNS.map((col) => {
            const Logo = PROVIDER_LOGOS[col.key];
            return (
            <div key={col.key} className="space-y-1 rounded-card" style={{ backgroundColor: colorWithAlpha(col.color, 0.03) }}>
              {/* Column header */}
              <div
                className="flex items-center justify-center gap-1.5 typo-heading font-semibold uppercase tracking-wider px-2 py-1.5 rounded-card"
                style={{ color: col.color, backgroundColor: colorWithAlpha(col.color, 0.07) }}
              >
                {Logo && <Logo color={col.color} />}
                {col.label}
              </div>

              {/* Model rows */}
              {col.models.map((model) => {
                const isSelected = selectedModel === model.value;
                return (
                  <button
                    key={model.value}
                    type="button"
                    onClick={() => onSelectModel(model.value)}
                    className={`w-full flex items-center gap-1.5 py-1.5 pr-2 rounded-card border transition-all transition-shadow duration-300 text-left ${
                      isSelected
                        ? 'pl-2.5 border-primary/30 bg-primary/8'
                        : 'pl-2 border-transparent hover:bg-secondary/40 hover:border-primary/10'
                    }`}
                    style={{
                      borderLeftWidth: 2,
                      borderLeftColor: isSelected ? col.color : 'transparent',
                      boxShadow: isSelected ? `0 0 12px ${col.color}15` : 'none',
                      transition: 'box-shadow 300ms ease',
                    }}
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
                    <span className="typo-body font-medium text-foreground/90 flex-1 truncate">
                      {model.value === 'custom' && <Settings2 className="w-3 h-3 inline mr-1 text-foreground" />}
                      {model.name}
                    </span>
                    {/* Cost */}
                    <span className={`typo-code font-mono flex-shrink-0 ${model.cost === 'Free' ? 'text-emerald-400/80' : 'text-foreground'}`}>
                      {model.cost}
                    </span>
                  </button>
                );
              })}
            </div>
          );
          })}
        </div>

        {/* Provider credential fields */}
        {isOllamaCloudValue(selectedModel) && <OllamaApiKeyField />}

        {customConfig && (
          <CustomModelConfigForm selectedModel={selectedModel} customConfig={customConfig} />
        )}

        {onMaxBudgetChange && onMaxTurnsChange && (
          <BudgetControls
            maxBudget={maxBudget}
            maxTurns={maxTurns}
            onMaxBudgetChange={onMaxBudgetChange}
            onMaxTurnsChange={onMaxTurnsChange}
          />
        )}

        {onPromptCachePolicyChange && (
          <PromptCacheControls
            value={promptCachePolicy ?? 'none'}
            onChange={onPromptCachePolicyChange}
          />
        )}

        {/* Effective config inheritance panel */}
        {(effectiveConfig || effectiveConfigLoading) && (
          <EffectiveConfigPanel config={effectiveConfig ?? null} loading={effectiveConfigLoading} />
        )}

        {/* Dirty indicator */}
        {dirty && (
          <div className="pt-1">
            <span className="flex items-center gap-1.5 typo-body text-amber-400/70">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {mc.unsaved_changes}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
