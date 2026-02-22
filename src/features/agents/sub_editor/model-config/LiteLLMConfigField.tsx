import { useAppSetting } from '@/hooks/utility/useAppSetting';
import { SaveConfigButton } from './SaveConfigButton';

export function LiteLLMConfigField() {
  const baseUrl = useAppSetting('litellm_base_url');
  const masterKey = useAppSetting('litellm_master_key');

  if (!baseUrl.loaded || !masterKey.loaded) return null;

  const handleSave = async () => {
    await baseUrl.save();
    await masterKey.save();
  };

  const hasValue = baseUrl.value.trim() || masterKey.value.trim();
  const isSaved = baseUrl.saved && masterKey.saved;

  return (
    <div className="space-y-1.5 bg-sky-500/5 border border-sky-500/15 rounded-lg p-3">
      <label className="block text-sm font-medium text-foreground/80 mb-1">
        LiteLLM Proxy Settings
        <span className="text-muted-foreground/80 font-normal ml-1">(global, shared across all agents)</span>
      </label>
      <div className="space-y-2">
        <input
          type="text"
          value={baseUrl.value}
          onChange={(e) => baseUrl.setValue(e.target.value)}
          placeholder="Proxy Base URL (http://localhost:4000)"
          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <input
          type="password"
          value={masterKey.value}
          onChange={(e) => masterKey.setValue(e.target.value)}
          placeholder="Master Key (sk-...)"
          className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        <div className="flex items-center gap-2">
          <SaveConfigButton
            onClick={handleSave}
            disabled={!hasValue}
            saved={isSaved}
            label="Save Global Config"
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground/80">
        These global settings are used as defaults for all agents using the LiteLLM provider. Per-agent overrides above take precedence.
      </p>
    </div>
  );
}
