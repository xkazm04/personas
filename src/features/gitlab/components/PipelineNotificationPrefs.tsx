import { useState, useCallback } from 'react';
import { Bell, BellOff, Volume2 } from 'lucide-react';
import {
  loadPipelineNotificationPrefs,
  savePipelineNotificationPrefs,
  type PipelineNotificationPrefs as Prefs,
} from '../hooks/usePipelineNotifications';
import { DEPLOYMENT_TOKENS } from '@/features/deployment/components/deploymentTokens';
import { useTranslation } from '@/i18n/useTranslation';

function Toggle({ checked, onChange, label, id }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <label htmlFor={id} className="flex items-center justify-between py-1.5 cursor-pointer group">
      <span className="text-sm text-foreground/80 group-hover:text-foreground/95 transition-colors">
        {label}
      </span>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 ${
          checked
            ? 'bg-orange-500/80 border-orange-500/40'
            : 'bg-secondary/60 border-primary/10'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-elevation-1 transition-transform duration-200 ${
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
    <div className={`p-4 ${DEPLOYMENT_TOKENS.cardRadius} bg-secondary/30 border border-primary/10`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground/90">
          {prefs.enabled ? (
            <Bell className="w-4 h-4 text-orange-400" />
          ) : (
            <BellOff className="w-4 h-4 text-muted-foreground/50" />
          )}
          {t.gitlab.pipeline_notifications}
        </h3>
        <button
          role="switch"
          aria-checked={prefs.enabled}
          aria-label={t.gitlab.enable_pipeline_notifications}
          onClick={() => update({ enabled: !prefs.enabled })}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 ${
            prefs.enabled
              ? 'bg-orange-500/80 border-orange-500/40'
              : 'bg-secondary/60 border-primary/10'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-elevation-1 transition-transform duration-200 ${
              prefs.enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {prefs.enabled && (
        <div className="space-y-0.5 pl-0.5">
          <p className="text-xs text-muted-foreground/50 mb-2">
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
          <div className="pt-1.5 mt-1.5 border-t border-primary/5">
            <label htmlFor="notif-sound" className="flex items-center justify-between py-1.5 cursor-pointer group">
              <span className="flex items-center gap-1.5 text-sm text-foreground/80 group-hover:text-foreground/95 transition-colors">
                <Volume2 className="w-3.5 h-3.5 text-muted-foreground/50" />
                {t.gitlab.play_sound}
              </span>
              <button
                id="notif-sound"
                role="switch"
                aria-checked={prefs.sound}
                onClick={() => update({ sound: !prefs.sound })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 ${
                  prefs.sound
                    ? 'bg-orange-500/80 border-orange-500/40'
                    : 'bg-secondary/60 border-primary/10'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-elevation-1 transition-transform duration-200 ${
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
