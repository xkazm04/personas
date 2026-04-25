import { useState, useCallback, useEffect, useMemo } from 'react';
import { Eye, EyeOff, Trash2, Check, X, Loader2 } from 'lucide-react';
import { getAppSetting, getAppSettingsBulk, setAppSetting, deleteAppSetting } from '@/api/system/settings';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useTranslation } from '@/i18n/useTranslation';

/** Definition of a provider API key entry that maps to a backend settings_key. */
interface ProviderKeyDef {
  /** The settings key used in the app_settings table. */
  settingsKey: string;
  /** Human-readable provider name. */
  label: string;
  /** Description shown below the label. */
  description: string;
  /** Whether this is a URL field rather than a secret key. */
  isUrl?: boolean;
  /** Placeholder text for the input. */
  placeholder: string;
}

const PROVIDER_KEYS: ProviderKeyDef[] = [
  {
    settingsKey: 'ollama_api_key',
    label: 'Ollama',
    description: 'Cloud API key for Ollama-hosted models (Qwen3, GLM-5, Kimi K2.5)',
    placeholder: 'sk-...',
  },
  {
    settingsKey: 'litellm_base_url',
    label: 'LiteLLM Base URL',
    description: 'Proxy base URL for LiteLLM-compatible endpoints',
    isUrl: true,
    placeholder: 'http://localhost:4000',
  },
  {
    settingsKey: 'litellm_master_key',
    label: 'LiteLLM Master Key',
    description: 'Authentication key for LiteLLM proxy',
    placeholder: 'sk-...',
  },
];

type ConnectionState = 'idle' | 'testing' | 'connected' | 'error';

interface KeyEntry {
  def: ProviderKeyDef;
  value: string;
  savedValue: string;
  revealed: boolean;
  editing: boolean;
  connectionState: ConnectionState;
  lastUsed: string | null;
}

function maskValue(value: string, isUrl?: boolean): string {
  if (!value) return '';
  if (isUrl) return value;
  if (value.length <= 8) return '*'.repeat(value.length);
  return value.slice(0, 4) + '*'.repeat(Math.min(value.length - 8, 20)) + value.slice(-4);
}

export function ByomApiKeyManager() {
  const [entries, setEntries] = useState<KeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const s = t.settings.byom;

  // Load all key values in a single bulk IPC instead of N parallel invokes.
  const settingsKeys = useMemo(() => PROVIDER_KEYS.map((def) => def.settingsKey), []);
  useEffect(() => {
    let cancelled = false;
    getAppSettingsBulk(settingsKeys)
      .catch(() => ({} as Record<string, string | null>))
      .then((map) => {
        if (cancelled) return;
        const results: KeyEntry[] = PROVIDER_KEYS.map((def) => {
          const value = map[def.settingsKey] ?? null;
          return {
            def,
            value: value ?? '',
            savedValue: value ?? '',
            revealed: false,
            editing: false,
            connectionState: 'idle' as ConnectionState,
            lastUsed: null,
          };
        });
        setEntries(results);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [settingsKeys]);

  const updateEntry = useCallback((index: number, patch: Partial<KeyEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }, []);

  const handleSave = useCallback(async (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    const value = entry.value.trim();
    if (value) {
      await setAppSetting(entry.def.settingsKey, value);
    } else {
      await deleteAppSetting(entry.def.settingsKey);
    }
    updateEntry(index, { savedValue: value, value, editing: false });
  }, [entries, updateEntry]);

  const handleDelete = useCallback(async (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    await deleteAppSetting(entry.def.settingsKey);
    updateEntry(index, { value: '', savedValue: '', editing: false, connectionState: 'idle' });
  }, [entries, updateEntry]);

  const handleCancel = useCallback((index: number) => {
    const entry = entries[index];
    if (!entry) return;
    updateEntry(index, { value: entry.savedValue, editing: false });
  }, [entries, updateEntry]);

  const handleTest = useCallback(async (index: number) => {
    const entry = entries[index];
    if (!entry || !entry.savedValue) return;
    updateEntry(index, { connectionState: 'testing' });
    // Simple connectivity test: verify the key is stored and retrievable
    try {
      const stored = await getAppSetting(entry.def.settingsKey);
      updateEntry(index, {
        connectionState: stored ? 'connected' : 'error',
      });
    } catch {
      updateEntry(index, { connectionState: 'error' });
    }
    // Reset status after 4 seconds
    setTimeout(() => {
      updateEntry(index, { connectionState: 'idle' });
    }, 4000);
  }, [entries, updateEntry]);

  if (loading) {
    return (
      <div className="rounded-modal border border-primary/10 bg-card-bg p-8 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-modal border border-primary/10 bg-card-bg p-4 space-y-3">
        <SectionHeading title={s.api_key_title} />
        <p className="typo-body text-foreground">
          {s.api_key_hint}
        </p>

        <div className="space-y-3">
          {entries.map((entry, index) => (
            <KeyEntryRow
              key={entry.def.settingsKey}
              entry={entry}
              onToggleReveal={() => updateEntry(index, { revealed: !entry.revealed })}
              onStartEdit={() => updateEntry(index, { editing: true, revealed: true })}
              onChange={(value) => updateEntry(index, { value })}
              onSave={() => handleSave(index)}
              onCancel={() => handleCancel(index)}
              onDelete={() => handleDelete(index)}
              onTest={() => handleTest(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Key Entry Row
// =============================================================================

function KeyEntryRow({
  entry,
  onToggleReveal,
  onStartEdit,
  onChange,
  onSave,
  onCancel,
  onDelete,
  onTest,
}: {
  entry: KeyEntry;
  onToggleReveal: () => void;
  onStartEdit: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const hasValue = !!entry.savedValue;
  const isDirty = entry.value !== entry.savedValue;
  const { t } = useTranslation();
  const s = t.settings.byom;

  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="typo-body font-medium text-foreground">{entry.def.label}</span>
          <ConnectionBadge state={entry.connectionState} />
        </div>
        <div className="flex items-center gap-1.5">
          {hasValue && !entry.editing && (
            <button
              onClick={onTest}
              disabled={entry.connectionState === 'testing'}
              className="typo-caption px-2.5 py-1 rounded-input border border-primary/15 text-foreground
                hover:border-primary/30 hover:text-foreground transition-all disabled:opacity-50 disabled:cursor-wait"
            >
              {entry.connectionState === 'testing' ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Testing
                </span>
              ) : (
                s.verify
              )}
            </button>
          )}
          {hasValue && !entry.editing && (
            <button
              onClick={onDelete}
              className="typo-caption p-1.5 rounded-input text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all"
              title={s.remove_key}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <p className="typo-caption text-foreground">{entry.def.description}</p>

      {/* Value display / editor */}
      {entry.editing ? (
        <div className="flex items-center gap-2">
          <input
            type={entry.def.isUrl ? 'url' : 'text'}
            value={entry.value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={entry.def.placeholder}
            className="flex-1 px-3 py-1.5 typo-code rounded-card bg-secondary/50 border border-primary/15
              text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/40
              font-mono"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isDirty) onSave();
              if (e.key === 'Escape') onCancel();
            }}
          />
          <button
            onClick={onSave}
            disabled={!isDirty}
            className="p-1.5 rounded-input text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-30"
            title="Save"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-input text-foreground hover:text-foreground hover:bg-secondary/50 transition-all"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          onClick={onStartEdit}
          className="flex items-center gap-2 cursor-pointer group"
        >
          <div className="flex-1 px-3 py-1.5 typo-code rounded-card border border-primary/10 bg-secondary/30
            group-hover:border-primary/20 transition-all font-mono min-h-[32px] flex items-center">
            {hasValue ? (
              <span className="text-foreground">
                {entry.revealed ? entry.value : maskValue(entry.savedValue, entry.def.isUrl)}
              </span>
            ) : (
              <span className="text-foreground">{entry.def.placeholder}</span>
            )}
          </div>
          {hasValue && !entry.def.isUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleReveal();
              }}
              className="p-1.5 rounded-input text-foreground hover:text-foreground transition-all"
              title={entry.revealed ? 'Hide' : 'Reveal'}
            >
              {entry.revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Connection Status Badge
// =============================================================================

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const { t } = useTranslation();
  const s = t.settings.byom;
  if (state === 'idle') return null;

  if (state === 'testing') {
    return (
      <span className="flex items-center gap-1 typo-caption px-1.5 py-0.5 rounded-input bg-amber-500/10 border border-amber-500/20 text-amber-300">
        <Loader2 className="w-3 h-3 animate-spin" />
      </span>
    );
  }

  if (state === 'connected') {
    return (
      <span className="flex items-center gap-1 typo-caption px-1.5 py-0.5 rounded-input bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        {s.stored}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 typo-caption px-1.5 py-0.5 rounded-input bg-red-500/10 border border-red-500/20 text-red-400">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      {s.error}
    </span>
  );
}
