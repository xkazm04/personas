import { useState, useEffect, useCallback } from 'react';
import { CloudUpload, RefreshCw } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useToastStore } from '@/stores/toastStore';
import { getCloudSyncStatus, setCloudSyncEnabled, cloudSyncNow } from '@/api/cloudSync';
import type { CloudSyncStatus } from '@/lib/bindings/CloudSyncStatus';

/**
 * Cloud dashboard sync toggle. Rendered only when the user is signed in with
 * Google (the synced data lands in their own Supabase tenant under their JWT).
 */
export default function CloudSyncCard() {
  const { t } = useTranslation();
  const s = t.settings.account;
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getCloudSyncStatus());
    } catch (e) {
      toastCatch('CloudSyncCard:status')(e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enabled = status?.enabled ?? false;

  const onToggle = async () => {
    const next = !enabled;
    setBusy(true);
    setStatus((prev) => (prev ? { ...prev, enabled: next } : prev));
    try {
      await setCloudSyncEnabled(next);
      await refresh();
    } catch (e) {
      setStatus((prev) => (prev ? { ...prev, enabled: !next } : prev));
      toastCatch('CloudSyncCard:setEnabled', s.cloud_sync_enable_failed)(e);
    } finally {
      setBusy(false);
    }
  };

  const onSyncNow = async () => {
    setSyncing(true);
    try {
      const count = await cloudSyncNow();
      useToastStore
        .getState()
        .addToast(interpolate(s.cloud_sync_now_done, { count }), 'success');
      await refresh();
    } catch (e) {
      toastCatch('CloudSyncCard:syncNow', s.cloud_sync_now_failed)(e);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title={s.cloud_sync_title} icon={<CloudUpload className="text-sky-400" />} />
      <p className="typo-body text-foreground leading-relaxed">{s.cloud_sync_description}</p>

      <div className="flex items-center justify-between gap-4 rounded-card bg-secondary/20 border border-primary/8 p-4">
        <div className="min-w-0">
          <p className="typo-body font-medium text-foreground/85">{s.cloud_sync_toggle}</p>
          <p className="typo-caption text-foreground mt-0.5">
            {enabled ? s.cloud_sync_on : s.cloud_sync_off}
          </p>
        </div>
        <AccessibleToggle
          checked={enabled}
          onChange={() => {
            void onToggle();
          }}
          disabled={busy}
          label={s.cloud_sync_toggle_aria}
        />
      </div>

      {enabled && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            icon={<RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />}
            onClick={() => {
              void onSyncNow();
            }}
            disabled={syncing}
          >
            {syncing ? s.cloud_sync_syncing : s.cloud_sync_now}
          </Button>
          <span className="typo-caption text-foreground">
            {status?.lastSyncAt
              ? interpolate(s.cloud_sync_last, { time: formatRelativeTime(status.lastSyncAt) })
              : s.cloud_sync_never}
          </span>
        </div>
      )}

      {status?.lastError && (
        <p className="typo-caption text-red-400/80">
          {interpolate(s.cloud_sync_error, { error: status.lastError })}
        </p>
      )}
    </div>
  );
}
