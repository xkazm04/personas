import { Cpu, Check, Settings2 } from 'lucide-react';
import type { ModelProvider } from '@/lib/types/frontendTypes';
import { OLLAMA_CLOUD_PRESETS, isOllamaCloudValue } from '../libs/OllamaCloudPresets';
import { COPILOT_PRESETS, isCopilotValue } from '../libs/CopilotPresets';
import { OllamaApiKeyField } from './OllamaApiKeyField';
import { CopilotTokenField } from './CopilotTokenField';
import { CustomModelConfigForm } from './CustomModelConfigForm';
import { BudgetControls } from './BudgetControls';

// -- Provider brand colors --
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#D97706',
  ollama: '#10B981',
  copilot: '#6E40C9',
  custom: '#3B82F6',
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

const COPILOT_MODELS: ModelDef[] = COPILOT_PRESETS.map((p) => ({
  value: p.value,
  name: p.label.split(' (')[0] ?? p.label,
  cost: p.value === 'copilot:gpt-5-mini' ? 'Free' : p.value === 'copilot:gemini-3-flash' ? '~$0.10/1K' : '~$3/1K',
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
  { key: 'copilot', label: 'Copilot', color: PROVIDER_COLORS.copilot!, models: COPILOT_MODELS },
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
  const showCopilotTokenField = isCopilotValue(selectedModel);
  const CopilotTokenFieldComponent = CopilotTokenField;

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
        <div className="grid grid-cols-4 gap-2">
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
                    key={model.value}
                    type="button"
                    onClick={() => onSelectModel(model.value)}
                    className={`w-full flex items-center gap-1.5 py-1.5 pr-2 rounded-lg border transition-all transition-shadow duration-300 text-left ${
                      isSelected
                        ? 'pl-2.5 border-primary/35 bg-primary/8'
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

        {/* Provider credential fields */}
        {isOllamaCloudValue(selectedModel) && <OllamaApiKeyField />}
        {showCopilotTokenField && <CopilotTokenFieldComponent />}

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
