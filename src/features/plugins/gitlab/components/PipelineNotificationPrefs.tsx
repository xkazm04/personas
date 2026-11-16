import { useState, useCallback } from 'react';
import { Bell, BellOff, Volume2 } from 'lucide-react';
import {
  loadPipelineNotificationPrefs,
  savePipelineNotificationPrefs,
  type PipelineNotificationPrefs as Prefs,
} from '../hooks/usePipelineNotifications';
import { DEPLOYMENT_TOKENS } from '@/features/agents/sub_deployment/components/deploymentTokens';
import { useTranslation } from '@/i18n/useTranslation';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';

function Toggle({ checked, onChange, label }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <label className="flex items-center justify-between py-1.5 cursor-pointer group">
      <span className="typo-body text-ink-1 group-hover:text-ink-2 transition-colors">
        {label}
      </span>
      <AccessibleToggle checked={checked} onChange={() => onChange(!checked)} label={label} size="sm" />
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
        <AccessibleToggle checked={prefs.enabled} onChange={() => update({ enabled: !prefs.enabled })} label={t.gitlab.enable_pipeline_notifications} size="sm" />
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
            <label className="flex items-center justify-between py-1.5 cursor-pointer group">
              <span className="flex items-center gap-1.5 typo-body text-ink-1 group-hover:text-ink-2 transition-colors">
                <Volume2 className="w-3.5 h-3.5 text-ink-1" />
                {t.gitlab.play_sound}
              </span>
              <AccessibleToggle checked={prefs.sound} onChange={() => update({ sound: !prefs.sound })} label={t.gitlab.play_sound} size="sm" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
