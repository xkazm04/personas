import { useState, useEffect } from 'react';
import { getAppSetting, setAppSetting } from '@/api/tauriApi';

export function LiteLLMConfigField() {
  const [baseUrl, setBaseUrl] = useState('');
  const [masterKey, setMasterKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      getAppSetting('litellm_base_url'),
      getAppSetting('litellm_master_key'),
    ]).then(([url, key]) => {
      if (url) setBaseUrl(url);
      if (key) setMasterKey(key);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    if (baseUrl.trim()) await setAppSetting('litellm_base_url', baseUrl.trim());
    if (masterKey.trim()) await setAppSetting('litellm_master_key', masterKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!loaded) return null;

  return (
    <div className="space-y-1.5 bg-sky-500/5 border border-sky-500/15 rounded-lg p-3">
      <label className="block text-sm font-medium text-foreground/60 mb-1">
        LiteLLM Proxy Settings
        <span className="text-muted-foreground/40 font-normal ml-1">(global, shared across all agents)</span>
      </label>
      <div className="space-y-2">
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => { setBaseUrl(e.target.value); setSaved(false); }}
          placeholder="Proxy Base URL (http://localhost:4000)"
          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <input
          type="password"
          value={masterKey}
          onChange={(e) => { setMasterKey(e.target.value); setSaved(false); }}
          placeholder="Master Key (sk-...)"
          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={(!baseUrl.trim() && !masterKey.trim()) || saved}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              saved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : (baseUrl.trim() || masterKey.trim())
                  ? 'bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30'
                  : 'bg-secondary/40 text-muted-foreground/30 border border-primary/10 cursor-not-allowed'
            }`}
          >
            {saved ? 'Saved' : 'Save Global Config'}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground/40">
        These global settings are used as defaults for all agents using the LiteLLM provider. Per-agent overrides above take precedence.
      </p>
    </div>
  );
}
