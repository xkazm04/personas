import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Key } from 'lucide-react';
import { getAppSetting, setAppSetting } from '@/api/tauriApi';

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
  /** Accent color name — used for ring, button, and icon styling */
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
    ring: 'focus:ring-emerald-500/40',
    icon: 'text-emerald-400',
    button: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25',
  },
  sky: {
    ring: 'focus:ring-sky-500/40',
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
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, '']))
  );
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
        console.error('Failed to load config settings:', err);
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
      // keep popup open on error
    } finally {
      setSaving(false);
    }
  };

  const styles = ACCENT_STYLES[accent];
  const hasAnyValue = fields.some((f) => values[f.key]?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-background border border-primary/15 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-primary/10">
          <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
            <Key className={`w-4 h-4 ${styles.icon}`} />
            {title}
          </h3>
          <p className="text-sm text-muted-foreground/90 mt-1">{subtitle}</p>
        </div>

        <div className="px-5 py-4 space-y-3">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">
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
                className={`w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 ${styles.ring} transition-all disabled:opacity-50`}
              />
            </div>
          ))}
          {footerText && (
            <p className="text-sm text-muted-foreground/80 leading-relaxed">
              {footerText}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-primary/10 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium rounded-lg text-muted-foreground/80 hover:bg-secondary/60 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasAnyValue || saving}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg ${styles.button} transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {saving ? 'Saving\u2026' : saveLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
