import { useState, useEffect, useId } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { Key } from 'lucide-react';
import { deleteAppSetting, getAppSettingsBulk, setAppSetting } from "@/api/system/settings";
import { useToastStore } from '@/stores/toastStore';
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import { silentCatch } from '@/lib/silentCatch';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';

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
    ring: 'focus-visible:ring-status-success/40',
    icon: 'text-status-success',
  },
  sky: {
    ring: 'focus-visible:ring-role-external/40',
    icon: 'text-role-external',
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
  const idBase = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, '']))
  );
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The keys the read found a value for: a blank field only means "remove it" for
  // one of these, so a failed read can never turn an unread key into a delete.
  const [storedKeys, setStoredKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // Single bulk read instead of one IPC per field (fields is small, but the
    // fan-out is gratuitous when a bulk reader exists). See architect perf scan.
    getAppSettingsBulk(fields.map((f) => f.key))
      .then((map) => {
        const updated: Record<string, string> = {};
        fields.forEach((f) => {
          const v = map[f.key];
          if (v) updated[f.key] = v;
        });
        setValues((prev) => ({ ...prev, ...updated }));
        setStoredKeys(new Set(Object.keys(updated)));
      })
      .catch((err) => {
        silentCatch('ConfigurationPopup:loadSettings')(err);
        setLoadError(true);
      })
      .finally(() => setLoaded(true));
  }, [fields]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        fields.map((f) => {
          const v = values[f.key]?.trim();
          if (v) return setAppSetting(f.key, v);
          return storedKeys.has(f.key) ? deleteAppSetting(f.key) : Promise.resolve();
        })
      );
      onSaved();
    } catch (err) {
      // IPC errors can echo the rejected payload (an API key) in their message, so
      // log only the settings keys and the error class - never the error object.
      logger.warn('Failed to save configuration settings', {
        keys: fields.map((f) => f.key),
        code: err instanceof Error ? err.name : typeof err,
      });
      useToastStore.getState().addToast(t.agents.config_popup.failed_to_save, 'error');
    } finally {
      setSaving(false);
    }
  };

  const styles = ACCENT_STYLES[accent];
  // Something to write: a typed value, or a stored one the person has cleared.
  const canSave = fields.some((f) => values[f.key]?.trim() || storedKeys.has(f.key));
  // Saving deletes these, and a deleted key cannot be got back: Save asks first.
  const clearsStoredKey = fields.some((f) => storedKeys.has(f.key) && !values[f.key]?.trim());

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="configuration-popup-title"
      size="sm"
    >
      <div className="bg-background border border-hair rounded-card shadow-elevation-4 overflow-hidden">
        <div className="px-4 py-4 border-b border-hair">
          <h3 id="configuration-popup-title" className="typo-heading text-ink-2 flex items-center gap-2">
            <Key className={`w-4 h-4 ${styles.icon}`} />
            {title}
          </h3>
          <p className="typo-body text-foreground mt-1">{subtitle}</p>
        </div>

        <div className="px-4 py-4 space-y-3">
          {loadError && (
            <p className="typo-caption text-status-warning bg-status-warning/10 border border-status-warning/20 rounded-card px-3 py-2">
              {t.agents.config_popup.load_error}
            </p>
          )}
          {fields.map((field) => (
            <div key={field.key}>
              <label htmlFor={`${idBase}-${field.key}`} className="block typo-body text-foreground mb-1.5">
                {field.label}
              </label>
              <input
                id={`${idBase}-${field.key}`}
                type={field.type}
                value={values[field.key] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={loaded ? field.placeholder : t.common.loading}
                disabled={!loaded}
                autoFocus={field.autoFocus}
                className={`w-full px-3 py-2 bg-surface-1 border border-hair rounded-modal typo-body text-ink-1 placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 ${styles.ring} transition-all disabled:is-disabled`}
              />
            </div>
          ))}
          {footerText && (
            <p className="typo-body text-foreground">
              {footerText}
            </p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-hair">
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={clearsStoredKey ? () => setConfirmingRemove(true) : handleSave}
              disabled={!canSave || saving}
            >
              {saving ? t.common.saving : saveLabel}
            </Button>
          </div>
          {confirmingRemove && (
            <ConfirmDialog
              danger
              title={t.settings.byom.remove_key}
              body={t.common.confirm_destructive_cannot_undo}
              confirmLabel={t.settings.byom.remove_key}
              onConfirm={async () => {
                await handleSave();
                setConfirmingRemove(false);
              }}
              onCancel={() => setConfirmingRemove(false)}
            />
          )}
          {!canSave && !saving && loaded && (
            <p
              className="animate-fade-slide-in text-ink-2 typo-caption mt-1.5 text-right"
            >
              {t.agents.config_popup.fill_hint}
            </p>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
