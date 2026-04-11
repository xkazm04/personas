import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

interface UseCaseModelOverrideFormProps {
  visible: boolean;
  customConfig: ModelProfile;
  onFieldChange: (field: keyof ModelProfile, value: string) => void;
}

export function UseCaseModelOverrideForm({ visible, customConfig, onFieldChange }: UseCaseModelOverrideFormProps) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  return (
    <>
      {visible && (
        <div
          className="animate-fade-slide-in overflow-hidden"
        >
          <div className="bg-secondary/30 border border-primary/10 rounded-xl p-3 space-y-2">
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">{mc.provider}</label>
              <ThemedSelect
                value={customConfig.provider || 'anthropic'}
                onChange={(e) => onFieldChange('provider', e.target.value)}
                className="py-1.5"
              >
                <option value="anthropic">{mc.provider_anthropic}</option>
                <option value="ollama">{mc.provider_ollama}</option>
                <option value="litellm">{mc.provider_litellm}</option>
                <option value="custom">{mc.provider_custom}</option>
              </ThemedSelect>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">{mc.model_name}</label>
              <input
                type="text"
                value={customConfig.model || ''}
                onChange={(e) => onFieldChange('model', e.target.value)}
                placeholder="e.g. claude-sonnet-4-20250514"
                className={INPUT_FIELD}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">{mc.base_url}</label>
              <input
                type="text"
                value={customConfig.base_url || ''}
                onChange={(e) => onFieldChange('base_url', e.target.value)}
                placeholder="http://localhost:11434"
                className={INPUT_FIELD}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">{mc.auth_token}</label>
              <input
                type="password"
                value={customConfig.auth_token || ''}
                onChange={(e) => onFieldChange('auth_token', e.target.value)}
                placeholder="Bearer token"
                className={INPUT_FIELD}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
