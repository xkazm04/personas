import { useState, useEffect, useCallback } from 'react';
import { Key } from 'lucide-react';
import { getAppSetting, setAppSetting } from "@/api/system/settings";
import { useToastStore } from '@/stores/toastStore';
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';

const logger = createLogger("configuration-popup");

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder: string;
  autoFocus?: boolean;
}

interface ConfigurationPopupProps {
  title: string;
  subtitle: string;
  /** Accent color name -- used for ring, button, and icon styling */
  accent: 'emerald' | 'sky';
  fields: ConfigField[];
  saveLabel: string;
  /** Optional footer text below the fields */
  footerText?: React.ReactNode;
  onClose: () => void;
  onSaved: () => void;
}

const ACCENT_STYLES = {
  emerald: {
    ring: 'focus-visible:ring-emerald-500/40',
    icon: 'text-emerald-400',
    button: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25',
  },
  sky: {
    ring: 'focus-visible:ring-sky-500/40',
    icon: 'text-sky-400',
    button: 'bg-sky-500/15 text-sky-300 border border-sky-500/25 hover:bg-sky-500/25',
  },
};

export function ConfigurationPopup({
  title,
  subtitle,
  accent,
  fields,
  saveLabel,
  footerText,
  onClose,
  onSaved,
}: ConfigurationPopupProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, '']))
  );
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    Promise.all(fields.map((f) => getAppSetting(f.key)))
      .then((results) => {
        const updated: Record<string, string> = {};
        fields.forEach((f, i) => {
          if (results[i]) updated[f.key] = results[i]!;
        });
        setValues((prev) => ({ ...prev, ...updated }));
      })
      .catch((err) => {
        logger.error('Failed to load config settings', { error: err });
        setLoadError(true);
      })
      .finally(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        fields.map((f) => {
          const v = values[f.key]?.trim();
          return v ? setAppSetting(f.key, v) : Promise.resolve();
        })
      );
      onSaved();
    } catch {
      useToastStore.getState().addToast('Failed to save configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const styles = ACCENT_STYLES[accent];
  const hasAnyValue = fields.some((f) => values[f.key]?.trim());

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="animate-fade-slide-in bg-background border border-primary/20 rounded-2xl shadow-elevation-4 w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="px-4 py-4 border-b border-primary/10">
          <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
            <Key className={`w-4 h-4 ${styles.icon}`} />
            {title}
          </h3>
          <p className="text-sm text-foreground mt-1">{subtitle}</p>
        </div>

        <div className="px-4 py-4 space-y-3">
          {loadError && (
            <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-card px-3 py-2">
              {t.agents.config_popup.load_error}
            </p>
          )}
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {field.label}
              </label>
              <input
                type={field.type}
                value={values[field.key] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={loaded ? field.placeholder : 'Loading\u2026'}
                disabled={!loaded}
                autoFocus={field.autoFocus}
                className={`w-full px-3 py-2 bg-secondary/40 border border-primary/20 rounded-modal text-sm text-foreground placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:ring-2 ${styles.ring} transition-all disabled:opacity-50`}
              />
            </div>
          ))}
          {footerText && (
            <p className="text-sm text-foreground leading-relaxed">
              {footerText}
            </p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-primary/10">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium rounded-modal text-foreground hover:bg-secondary/60 transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={!hasAnyValue || saving}
              className={`px-3 py-1.5 text-sm font-medium rounded-modal ${styles.button} transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {saving ? t.common.saving : saveLabel}
            </button>
          </div>
          {!hasAnyValue && !saving && loaded && (
            <p
              className="animate-fade-slide-in text-foreground text-xs mt-1.5 text-right"
            >
              {t.agents.config_popup.fill_hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
