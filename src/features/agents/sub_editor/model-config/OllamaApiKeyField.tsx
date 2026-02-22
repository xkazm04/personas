import { ExternalLink } from 'lucide-react';
import { useAppSetting } from '@/hooks/utility/useAppSetting';
import { OLLAMA_API_KEY_SETTING } from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';
import { SaveConfigButton } from './SaveConfigButton';

export function OllamaApiKeyField() {
  const apiKey = useAppSetting(OLLAMA_API_KEY_SETTING);

  if (!apiKey.loaded) return null;

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground/60 mb-1">
        Ollama API Key
        <span className="text-muted-foreground/40 font-normal ml-1">(global, shared across all personas)</span>
      </label>
      <div className="flex gap-2">
        <input
          type="password"
          value={apiKey.value}
          onChange={(e) => apiKey.setValue(e.target.value)}
          placeholder="Paste your key from ollama.com/settings"
          className="flex-1 px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <SaveConfigButton
          onClick={apiKey.save}
          disabled={!apiKey.value.trim()}
          saved={apiKey.saved}
          label="Save Key"
        />
      </div>
      <p className="text-xs text-muted-foreground/40">
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
      </p>
    </div>
  );
}
