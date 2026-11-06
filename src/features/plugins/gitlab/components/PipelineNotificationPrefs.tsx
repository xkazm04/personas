import { useState, useCallback } from 'react';
import { Bell, BellOff, Volume2 } from 'lucide-react';
import {
  loadPipelineNotificationPrefs,
  savePipelineNotificationPrefs,
  type PipelineNotificationPrefs as Prefs,
} from '../hooks/usePipelineNotifications';
import { DEPLOYMENT_TOKENS } from '@/features/agents/sub_deployment/components/deploymentTokens';
import { useTranslation } from '@/i18n/useTranslation';

function Toggle({ checked, onChange, label, id }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <label htmlFor={id} className="flex items-center justify-between py-1.5 cursor-pointer group">
      <span className="typo-body text-ink-1 group-hover:text-ink-2 transition-colors">
        {label}
      </span>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-warning/40 ${
          checked
            ? 'bg-status-warning/20 border-status-warning/40'
            : 'bg-surface-2 border-hair'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-secondary shadow-elevation-1 transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

export function PipelineNotificationPrefs() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<Prefs>(loadPipelineNotificationPrefs);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePipelineNotificationPrefs(next);
      return next;
    });
  }, []);

  return (
    <div className={`p-4 ${DEPLOYMENT_TOKENS.cardRadius} bg-surface-1 border border-hair`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 typo-body text-ink-2">
          {prefs.enabled ? (
            <Bell className="w-4 h-4 text-status-warning" />
          ) : (
            <BellOff className="w-4 h-4 text-ink-1" />
          )}
          {t.gitlab.pipeline_notifications}
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.enabled}
          aria-label={t.gitlab.enable_pipeline_notifications}
          onClick={() => update({ enabled: !prefs.enabled })}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-warning/40 ${
            prefs.enabled
              ? 'bg-status-warning/20 border-status-warning/40'
              : 'bg-surface-2 border-hair'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-secondary shadow-elevation-1 transition-transform duration-200 ${
              prefs.enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {prefs.enabled && (
        <div className="space-y-0.5 pl-0.5">
          <p className="typo-caption text-ink-2 mb-2">
            {t.gitlab.notification_description}
          </p>
          <Toggle
            id="notif-success"
            label={t.gitlab.success_label}
            checked={prefs.onSuccess}
            onChange={(v) => update({ onSuccess: v })}
          />
          <Toggle
            id="notif-failed"
            label={t.gitlab.failed_label}
            checked={prefs.onFailed}
            onChange={(v) => update({ onFailed: v })}
          />
          <Toggle
            id="notif-canceled"
            label={t.gitlab.canceled_label}
            checked={prefs.onCanceled}
            onChange={(v) => update({ onCanceled: v })}
          />
          <div className="pt-1.5 mt-1.5 border-t border-hair">
            <label htmlFor="notif-sound" className="flex items-center justify-between py-1.5 cursor-pointer group">
              <span className="flex items-center gap-1.5 typo-body text-ink-1 group-hover:text-ink-2 transition-colors">
                <Volume2 className="w-3.5 h-3.5 text-ink-1" />
                {t.gitlab.play_sound}
              </span>
              <button
                type="button"
                id="notif-sound"
                role="switch"
                aria-checked={prefs.sound}
                onClick={() => update({ sound: !prefs.sound })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-warning/40 ${
                  prefs.sound
                    ? 'bg-status-warning/20 border-status-warning/40'
                    : 'bg-surface-2 border-hair'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-secondary shadow-elevation-1 transition-transform duration-200 ${
                    prefs.sound ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
