import { ProviderCredentialField } from './ProviderCredentialField';
import { useTranslation } from '@/i18n/useTranslation';

export function LiteLLMConfigField() {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  return (
    <ProviderCredentialField
      label={mc.litellm_label}
      sublabel={mc.litellm_sublabel}
      field1={{ settingKey: 'litellm_base_url', placeholder: mc.litellm_base_url_placeholder, type: 'text' }}
      field2={{ settingKey: 'litellm_master_key', placeholder: mc.litellm_master_key_placeholder, type: 'password' }}
      saveLabel={mc.litellm_save_label}
      description={mc.litellm_description}
      containerClassName="bg-sky-500/5 border border-sky-500/15 rounded-lg p-3"
    />
  );
}
