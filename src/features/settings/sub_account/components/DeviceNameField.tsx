import { useState } from 'react';
import { FormField } from '@/features/shared/components/forms/FormField';
import Button from '@/features/shared/components/buttons/Button';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { setCloudSyncDeviceName } from '@/api/cloudSync';
import type { CloudSyncStatus } from '@/lib/bindings/CloudSyncStatus';

/** Matches `settings_keys::CLOUD_SYNC_DEVICE_NAME_MAX`. */
const MAX_NAME = 64;

interface DeviceNameFieldProps {
  /** The saved name, or null when the heartbeat sends the platform label. */
  current: string | null;
  onSaved: (status: CloudSyncStatus) => void;
}

/**
 * The name this desktop sends in its cloud heartbeat, so a paired phone can say
 * "Open Personas on Studio PC" (PHASE2-SPEC 4.1, M1). Empty clears it back to
 * the operating system's name; the hostname is never sent.
 */
export default function DeviceNameField({ current, onSaved }: DeviceNameFieldProps) {
  const { t } = useTranslation();
  const s = t.settings.account;
  const [draft, setDraft] = useState(current ?? '');
  const [saving, setSaving] = useState(false);
  const trimmed = draft.trim();
  const dirty = trimmed !== (current ?? '');

  const save = async () => {
    setSaving(true);
    try {
      onSaved(await setCloudSyncDeviceName(trimmed === '' ? null : trimmed));
      useToastStore.getState().addToast(s.cloud_sync_device_name_saved, 'success');
    } catch (e) {
      toastCatch('DeviceNameField:save', s.cloud_sync_device_name_failed)(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <FormField label={s.cloud_sync_device_name_label} helpText={s.cloud_sync_device_name_hint}>
          {(inputProps) => (
            <input
              {...inputProps}
              type="text"
              value={draft}
              maxLength={MAX_NAME}
              placeholder={s.cloud_sync_device_name_placeholder}
              onChange={(e) => setDraft(e.target.value)}
              className={INPUT_FIELD}
              data-testid="cloud-sync-device-name"
            />
          )}
        </FormField>
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={saving}
        disabled={saving || !dirty}
        onClick={() => {
          void save();
        }}
      >
        {s.cloud_sync_device_name_save}
      </Button>
    </div>
  );
}
