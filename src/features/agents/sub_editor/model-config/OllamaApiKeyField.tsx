import { ExternalLink } from 'lucide-react';
import { OLLAMA_API_KEY_SETTING } from './OllamaCloudPresets';
import { ProviderCredentialField } from './ProviderCredentialField';

export function OllamaApiKeyField() {
  return (
    <ProviderCredentialField
      label="Ollama API Key"
      sublabel="(global, shared across all personas)"
      field1={{ settingKey: OLLAMA_API_KEY_SETTING, placeholder: 'Paste your key from ollama.com/settings', type: 'password' }}
      saveLabel="Save Key"
      description={
        <>
          Sign up free at{' '}
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary/60 hover:text-primary inline-flex items-center gap-0.5"
          >
            ollama.com <ExternalLink className="w-2.5 h-2.5" />
          </a>
          {' '}and copy your API key from Settings.
        </>
      }
    />
  );
}
