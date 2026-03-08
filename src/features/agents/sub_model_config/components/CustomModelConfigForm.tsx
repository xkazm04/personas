import { motion, AnimatePresence } from 'framer-motion';
import type { ModelProvider } from '@/lib/types/frontendTypes';
import { LiteLLMConfigField } from './LiteLLMConfigField';
import { FieldHint } from '@/features/shared/components/FieldHint';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import type { CustomModelConfig } from './ModelSelector';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

export function CustomModelConfigForm({
  selectedModel,
  customConfig,
}: {
  selectedModel: string;
  customConfig: CustomModelConfig;
}) {
  return (
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
              <ThemedSelect
                value={customConfig.selectedProvider}
                onChange={(e) => customConfig.onProviderChange(e.target.value as ModelProvider)}
                className="py-1.5"
              >
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama (local)</option>
                <option value="litellm">LiteLLM (proxy)</option>
                <option value="custom">Custom URL</option>
              </ThemedSelect>
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
                    className={INPUT_FIELD}
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
                    className={INPUT_FIELD}
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
                    className={INPUT_FIELD}
                  />
                </div>
              </div>
            )}

            {customConfig.selectedProvider === 'litellm' && <LiteLLMConfigField />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
