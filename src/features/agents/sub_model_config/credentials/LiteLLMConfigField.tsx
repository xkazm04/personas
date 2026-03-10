import { ProviderCredentialField } from './ProviderCredentialField';

export function LiteLLMConfigField() {
  return (
    <ProviderCredentialField
      label="LiteLLM Proxy Settings"
      sublabel="(global, shared across all agents)"
      field1={{ settingKey: 'litellm_base_url', placeholder: 'Proxy Base URL (http://localhost:4000)', type: 'text' }}
      field2={{ settingKey: 'litellm_master_key', placeholder: 'Master Key (sk-...)', type: 'password' }}
      saveLabel="Save Global Config"
      description="These global settings are used as defaults for all agents using the LiteLLM provider. Per-agent overrides above take precedence."
      containerClassName="bg-sky-500/5 border border-sky-500/15 rounded-lg p-3"
    />
  );
}
