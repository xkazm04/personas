import type { ModelProvider } from '@/lib/types/frontendTypes';
import { LiteLLMConfigField } from './LiteLLMConfigField';
import { FieldHint } from '@/features/shared/components/display/FieldHint';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { CustomModelConfig } from './ModelSelector';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

export function CustomModelConfigForm({
  selectedModel,
  customConfig,
}: {
  selectedModel: string;
  customConfig: CustomModelConfig;
}) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  return (
    <>
      {selectedModel === 'custom' && (
        <div
          className="animate-fade-slide-in overflow-hidden"
        >
          <div className="space-y-3 pt-1">
            <div>
              <label className="block typo-body font-medium text-foreground mb-1">{mc.provider}</label>
              <ThemedSelect
                value={customConfig.selectedProvider}
                onChange={(e) => customConfig.onProviderChange(e.target.value as ModelProvider)}
                className="py-1.5"
              >
                <option value="anthropic">{mc.provider_anthropic}</option>
                <option value="ollama">{mc.provider_ollama}</option>
                <option value="litellm">{mc.provider_litellm}</option>
                <option value="custom">{mc.provider_custom}</option>
              </ThemedSelect>
            </div>

            {customConfig.selectedProvider !== 'anthropic' && (
              <div className="space-y-3">
                <div>
                  <label className="block typo-body font-medium text-foreground mb-1">{mc.model_name}</label>
                  <input
                    type="text"
                    value={customConfig.customModelName}
                    onChange={(e) => customConfig.onCustomModelNameChange(e.target.value)}
                    placeholder={
                      customConfig.selectedProvider === 'litellm'
                        ? mc.model_name_placeholder_litellm
                        : customConfig.selectedProvider === 'ollama'
                          ? mc.model_name_placeholder_ollama
                          : mc.model_name_placeholder_custom
                    }
                    className={INPUT_FIELD}
                  />
                </div>
                <div>
                  <label className="block typo-body font-medium text-foreground mb-1">
                    {mc.base_url}
                    <FieldHint
                      text={mc.base_url_hint}
                      example={mc.base_url_example}
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
                    className={INPUT_FIELD}
                  />
                </div>
                <div>
                  <label className="block typo-body font-medium text-foreground mb-1">
                    {mc.auth_token}
                    <FieldHint
                      text={mc.auth_token_hint}
                      example={mc.auth_token_example}
                    />
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={customConfig.authToken}
                    onChange={(e) => customConfig.onAuthTokenChange(e.target.value)}
                    placeholder={
                      customConfig.selectedProvider === 'litellm'
                        ? mc.auth_token_placeholder_litellm
                        : customConfig.selectedProvider === 'ollama'
                          ? mc.auth_token_placeholder_ollama
                          : mc.auth_token_placeholder_custom
                    }
                    className={INPUT_FIELD}
                  />
                </div>
              </div>
            )}

            {customConfig.selectedProvider === 'litellm' && <LiteLLMConfigField />}
          </div>
        </div>
      )}
    </>
  );
}
