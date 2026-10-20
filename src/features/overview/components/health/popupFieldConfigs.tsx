import { ExternalLink } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import type { ConfigField } from '@/features/overview/components/health/ConfigurationPopup';

type PopupFieldStrings = Translations['overview']['popup_fields'];

export const ollamaFields = (p: PopupFieldStrings): ConfigField[] => [
  { key: 'ollama_api_key', label: p.api_key_label, type: 'password', placeholder: p.ollama_key_placeholder, autoFocus: true },
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

export const litellmFields = (p: PopupFieldStrings): ConfigField[] => [
  { key: 'litellm_base_url', label: p.litellm_base_url_label, type: 'text', placeholder: 'http://localhost:4000', autoFocus: true },
  { key: 'litellm_master_key', label: p.litellm_master_key_label, type: 'password', placeholder: 'sk-...' },
];