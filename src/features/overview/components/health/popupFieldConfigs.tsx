import { ExternalLink } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ConfigField } from '@/features/agents/components/onboarding/ConfigurationPopup';

export const OLLAMA_FIELDS: ConfigField[] = [
  { key: 'ollama_api_key', label: 'API Key', type: 'password', placeholder: 'Paste your key from ollama.com/settings', autoFocus: true },
];

export function OllamaFooter() {
  const { t } = useTranslation();
  return (
    <>
      {t.overview.popup_fields.sign_up_free_at}{' '}
      <a
        href="https://ollama.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-400/70 hover:text-emerald-400 inline-flex items-center gap-0.5"
      >
        {t.overview.popup_fields.ollama_domain} <ExternalLink className="w-2.5 h-2.5" />
      </a>
      {t.overview.popup_fields.ollama_key_instructions}
    </>
  );
}

export const LITELLM_FIELDS: ConfigField[] = [
  { key: 'litellm_base_url', label: 'Proxy Base URL', type: 'text', placeholder: 'http://localhost:4000', autoFocus: true },
  { key: 'litellm_master_key', label: 'Master Key', type: 'password', placeholder: 'sk-...' },
];