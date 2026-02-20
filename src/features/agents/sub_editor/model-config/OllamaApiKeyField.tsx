import { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { getAppSetting, setAppSetting } from '@/api/tauriApi';
import { OLLAMA_API_KEY_SETTING } from '@/features/agents/sub_editor/model-config/OllamaCloudPresets';

export function OllamaApiKeyField() {
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getAppSetting(OLLAMA_API_KEY_SETTING).then((val) => {
      if (val) setApiKey(val);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    if (apiKey.trim()) {
      await setAppSetting(OLLAMA_API_KEY_SETTING, apiKey.trim());
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!loaded) return null;

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground/60 mb-1">
        Ollama API Key
        <span className="text-muted-foreground/40 font-normal ml-1">(global, shared across all personas)</span>
      </label>
      <div className="flex gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setSaved(false); }}
          placeholder="Paste your key from ollama.com/settings"
          className="flex-1 px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <button
          onClick={handleSave}
          disabled={!apiKey.trim() || saved}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            saved
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : apiKey.trim()
                ? 'bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30'
                : 'bg-secondary/40 text-muted-foreground/30 border border-primary/10 cursor-not-allowed'
          }`}
        >
          {saved ? 'Saved' : 'Save Key'}
        </button>
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
