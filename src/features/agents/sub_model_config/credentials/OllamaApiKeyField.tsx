import { ExternalLink } from 'lucide-react';
import { OLLAMA_API_KEY_SETTING } from '../OllamaCloudPresets';
import { ProviderCredentialField } from './ProviderCredentialField';
import { useTranslation } from '@/i18n/useTranslation';

export function OllamaApiKeyField() {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  return (
    <ProviderCredentialField
      label={mc.ollama_label}
      sublabel={mc.ollama_sublabel}
      field1={{ settingKey: OLLAMA_API_KEY_SETTING, placeholder: mc.ollama_placeholder, type: 'password' }}
      saveLabel={mc.ollama_save_label}
      description={
        <>
          {mc.ollama_signup}{' '}
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary/60 hover:text-primary inline-flex items-center gap-0.5"
          >
            ollama.com <ExternalLink className="w-2.5 h-2.5" />
          </a>
          {' '}{mc.ollama_copy_key}
        </>
      }
    />
  );
}
